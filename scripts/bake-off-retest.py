#!/usr/bin/env python3
"""
Bake-off retest: live test top 15 shortlist models through the orchestrator.
Reads shortlist.json and fleet-eval results.jsonl to find working servers.
Sends 5-prompt battery per model and writes results to retest-results.jsonl.
Idempotent: skips already-completed (model, prompt_id) pairs on rerun.
"""

import json
import os
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# ── Config ────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SHORTLIST_PATH = os.path.join(BASE_DIR, "../data/bake-off/shortlist.json")
EVAL_RESULTS_PATH = os.path.join(BASE_DIR, "../data/fleet-eval/results.jsonl")
OUTPUT_DIR = os.path.join(BASE_DIR, "../data/bake-off")
RESULTS_PATH = os.path.join(OUTPUT_DIR, "retest-results.jsonl")
UNROUTABLE_PATH = os.path.join(OUTPUT_DIR, "unroutable.jsonl")
ORCHESTRATOR_URL = "http://localhost:5100/v1/chat/completions"
TIMEOUT_SEC = 120
CONCURRENCY = 4
PROGRESS_EVERY = 10

TOP_N = 15

PROMPTS = [
    {
        "id": 1,
        "text": "If all roses are flowers and some flowers fade quickly, can we conclude some roses fade quickly? Explain in 2-3 sentences."
    },
    {
        "id": 2,
        "text": "Return a JSON object with keys `name`, `age`, `city` for a fictional person. Output ONLY the JSON, no other text."
    },
    {
        "id": 3,
        "text": "Write a Python function that returns the nth Fibonacci number. Include a docstring and one example call. Output ONLY the code, no other text."
    },
    {
        "id": 4,
        "text": "A train leaves Station A at 9am traveling 60mph. Another train leaves Station A at 10am traveling 80mph in the same direction. At what time does the second train catch up to the first? Show your work."
    },
    {
        "id": 5,
        "text": "Summarize the following passage in exactly 2 sentences. Passage: Call me Ishmael. Some years ago—never mind how long precisely—having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen, and regulating the circulation. Whenever I find myself growing grim about the mouth; whenever it is a damp, drizzly November in my soul; whenever I find myself involuntarily pausing before coffin warehouses, and bringing up the rear of every funeral I meet; and especially whenever my hypos get such an upper hand of me, that it requires a strong moral principle to prevent me from deliberately stepping into the street, and methodically knocking people's hats off—then, I account it high time to get to sea as soon as I can."
    },
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def load_shortlist_top15():
    with open(SHORTLIST_PATH) as f:
        data = json.load(f)
    return [m["model"] for m in data["models"][:TOP_N]]

def build_server_map():
    """
    From results.jsonl, for each model name, capture the first record where
    available==True and capabilities.writing==True.
    Returns {model_name: server_url}
    """
    server_map = {}
    seen = set()
    with open(EVAL_RESULTS_PATH) as f:
        for line in f:
            rec = json.loads(line)
            model = rec.get("model", "")
            if model in seen:
                continue
            available = rec.get("available", False)
            caps = rec.get("capabilities", {})
            writing = caps.get("writing", False) if isinstance(caps, dict) else False
            if available and writing:
                server_map[model] = rec.get("server_url", "")
                seen.add(model)
    return server_map

def load_existing_results():
    """Returns set of (model, prompt_id) already in results file."""
    existing = set()
    if not os.path.exists(RESULTS_PATH):
        return existing
    with open(RESULTS_PATH) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                existing.add((rec.get("model", ""), rec.get("prompt_id")))
            except json.JSONDecodeError:
                continue
    return existing

def append_result(rec):
    with open(RESULTS_PATH, "a") as f:
        f.write(json.dumps(rec) + "\n")

def append_unroutable(model, reason):
    with open(UNROUTABLE_PATH, "a") as f:
        f.write(json.dumps({"model": model, "reason": reason}) + "\n")

def call_orchestrator(model, prompt_id, prompt_text, server_url_suggested, retries=2):
    """
    Send one prompt to the orchestrator. Returns dict result.
    Retries transient (5xx, connection) errors up to 2 times with 2s backoff.
    """
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt_text}],
        "max_tokens": 512,
        "temperature": 0.0,
        "stream": False,
    }

    for attempt in range(retries + 1):
        start_time = time.time()
        try:
            resp = requests.post(
                ORCHESTRATOR_URL,
                json=payload,
                timeout=TIMEOUT_SEC,
            )
            end_time = time.time()
            total_latency_ms = int((end_time - start_time) * 1000)
            ttft_ms = total_latency_ms  # non-streaming: whole call is TTFT proxy

            if resp.status_code == 200:
                data = resp.json()
                content = (
                    data.get("choices", [{}])[0]
                    .get("message", {})
                    .get("content", "")
                    if data.get("choices")
                    else ""
                )
                usage = data.get("usage", {})
                return {
                    "model": model,
                    "prompt_id": prompt_id,
                    "prompt_text": prompt_text,
                    "response_text": content,
                    "ttft_ms": ttft_ms,
                    "total_latency_ms": total_latency_ms,
                    "prompt_tokens": usage.get("prompt_tokens", 0),
                    "completion_tokens": usage.get("completion_tokens", 0),
                    "total_tokens": usage.get("total_tokens", 0),
                    "server_url_suggested": server_url_suggested,
                    "http_status": resp.status_code,
                    "success": True,
                    "error": None,
                    "timestamp": int(end_time),
                }
            elif 400 <= resp.status_code < 500:
                # 4xx: model not found, route failed — non-transient, don't retry
                end_time = time.time()
                return {
                    "model": model,
                    "prompt_id": prompt_id,
                    "prompt_text": prompt_text,
                    "response_text": "",
                    "ttft_ms": 0,
                    "total_latency_ms": int((end_time - start_time) * 1000),
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                    "server_url_suggested": server_url_suggested,
                    "http_status": resp.status_code,
                    "success": False,
                    "error": f"4xx: {resp.text[:200]}",
                    "timestamp": int(end_time),
                }
            else:
                # 5xx: transient — retry
                err_msg = f"5xx attempt {attempt+1}: {resp.status_code} {resp.text[:100]}"
                if attempt < retries:
                    time.sleep(2)
                    continue
                end_time = time.time()
                return {
                    "model": model,
                    "prompt_id": prompt_id,
                    "prompt_text": prompt_text,
                    "response_text": "",
                    "ttft_ms": 0,
                    "total_latency_ms": int((end_time - start_time) * 1000),
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                    "server_url_suggested": server_url_suggested,
                    "http_status": resp.status_code,
                    "success": False,
                    "error": err_msg,
                    "timestamp": int(end_time),
                }

        except (requests.ConnectionError, requests.Timeout) as e:
            if attempt < retries:
                time.sleep(2)
                continue
            end_time = time.time()
            return {
                "model": model,
                "prompt_id": prompt_id,
                "prompt_text": prompt_text,
                "response_text": "",
                "ttft_ms": 0,
                "total_latency_ms": int((end_time - start_time) * 1000),
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "server_url_suggested": server_url_suggested,
                "http_status": 0,
                "success": False,
                "error": f"Connection/Timeout after {retries} retries: {str(e)[:200]}",
                "timestamp": int(end_time),
            }

    # Should not reach here
    return None

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("BAKE-OFF RETEST  |  top-15 models  |  5 prompts each  |  75 calls")
    print("=" * 60)

    # Ensure output dir
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Load data
    top15 = load_shortlist_top15()
    print(f"\nTop 15 models: {top15}\n")

    server_map = build_server_map()
    print(f"Server map entries found: {len(server_map)}")

    existing = load_existing_results()
    print(f"Already completed: {len(existing)} (model,prompt_id) pairs\n")

    # Build work items
    work = []
    for model in top15:
        srv = server_map.get(model, None)
        if srv is None:
            append_unroutable(model, "no available server in eval data")
            print(f"  [UNROUTABLE] {model} — no available server")
            continue
        for p in PROMPTS:
            if (model, p["id"]) in existing:
                print(f"  [SKIP] {model} p{p['id']} — already done")
                continue
            work.append({
                "model": model,
                "prompt_id": p["id"],
                "prompt_text": p["text"],
                "server_url_suggested": srv,
            })

    total_work = len(work)
    print(f"Work items to execute: {total_work}\n")

    if total_work == 0:
        print("Nothing to do — all results already present.")
        return

    # Track stats
    stats = {"success": 0, "fail": 0}
    completed = 0

    def worker(item):
        res = call_orchestrator(
            item["model"],
            item["prompt_id"],
            item["prompt_text"],
            item["server_url_suggested"],
        )
        if res is None:
            return item, None
        return item, res

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        futures = {executor.submit(worker, w): w for w in work}
        for future in as_completed(futures):
            item, res = future.result()
            if res is None:
                append_unroutable(item["model"], "worker returned None")
                stats["fail"] += 1
            elif not res["success"]:
                append_result(res)
                append_unroutable(
                    item["model"],
                    f"prompt_id={item['prompt_id']} failed: {res['error']}",
                )
                stats["fail"] += 1
            else:
                append_result(res)
                stats["success"] += 1

            completed += 1
            if completed % PROGRESS_EVERY == 0:
                print(f"  progress: {completed}/{total_work}  success={stats['success']}  fail={stats['fail']}")

    print(f"\nDONE.  success={stats['success']}  fail={stats['fail']}")

    # Summary: per-model latency
    print("\n── Per-model mean latency ──")
    model_latencies = {}
    with open(RESULTS_PATH) as f:
        for line in f:
            rec = json.loads(line.strip())
            m = rec["model"]
            lat = rec.get("total_latency_ms", 0)
            if m not in model_latencies:
                model_latencies[m] = []
            if lat > 0:
                model_latencies[m].append(lat)

    for m, lats in sorted(model_latencies.items()):
        avg = sum(lats) / len(lats)
        print(f"  {m}: {avg:.0f}ms  (n={len(lats)})")

if __name__ == "__main__":
    main()
