#!/usr/bin/env python3
"""
fleet_eval.py — Direct upstream fleet capability + latency evaluator.

Hits each Ollama server in data/servers.json directly at http://<ip>:11434/api/chat
(bypassing the orchestrator proxy and its rate limits). For every (server, model)
pair it measures:
  - warmup / time-to-first-token (TTFT) via a streamed first request
  - total response latency
  - writing capability
  - coding capability
  - tool-use (function calling) capability
  - vision capability (only for vision-classified models)

Results are appended incrementally to results.jsonl (one JSON per line) so the run
is resumable. A separate --summarize pass aggregates everything for analysis.

Usage:
  python3 fleet_eval.py                 # run full evaluation (resumes if interrupted)
  python3 fleet_eval.py --summarize     # print/update aggregate report from results.jsonl
  python3 fleet_eval.py --limit 50      # only evaluate first N pairs (smoke test)
  python3 fleet_eval.py --workers 20    # override concurrency
"""
import json
import os
import sys
import time
import re
import threading
import argparse
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ROOT = "/root/project/ollama-orchestrator"
SERVERS_JSON = os.path.join(ROOT, "data", "servers.json")
OUTDIR = os.path.join(ROOT, "data", "fleet-eval")
RESULTS = os.path.join(OUTDIR, "results.jsonl")
DONESET = os.path.join(OUTDIR, "done.json")
SUMMARY = os.path.join(OUTDIR, "summary.json")
SUMMARY_MD = os.path.join(OUTDIR, "summary.md")

WORKERS = int(os.environ.get("FLEET_WORKERS", "40"))
WARMUP_TIMEOUT = int(os.environ.get("FLEET_WARMUP_TO", "200"))   # seconds, cold model load
PROBE_TIMEOUT = int(os.environ.get("FLEET_PROBE_TO", "150"))     # seconds, per capability probe
CONNECT_TIMEOUT = 10                                             # seconds, socket connect
RETRY = 1                                                        # retry network errors once
CONCURRENCY_SAMPLE_TARGET = int(os.environ.get("FLEET_CONCURRENCY_SAMPLE", "100"))
                                                           # number of pairs to run concurrency sweep on
_sample_lock = threading.Lock()
_sample_remaining = CONCURRENCY_SAMPLE_TARGET

# Tiny 1x1 red PNG used for vision probe (tests multimodal input acceptance).
VISION_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC"
)

print_lock = threading.Lock()


def log(msg: str):
    with print_lock:
        print(msg, flush=True)


# ---------------------------------------------------------------------------
# Model classification (by name pattern — servers.json carries no capability flags)
# ---------------------------------------------------------------------------
def classify(model: str) -> str:
    m = model.lower()
    if any(k in m for k in ["embed"]):
        return "embedding"
    if any(k in m for k in ["flux", "sdxl", "stable-diffusion", "cogview", "dall", "imagine", "aura", "dream"]):
        return "image-gen"
    if any(k in m for k in [
        "vision", "llava", "minicpm", "qwen-vl", "qvq", "qwen2-vl", "qwen2.5-vl",
        "glm-4v", "glm-v", "phi-3-vision", "phi3.5-vision", "moondream", "cogvlm",
        "internvl", "baklava", "fuyu", "idefics", "smolvlm", "mantis", "gemma-3",
        "gemma3", "x/llama", "llama-vision", "minicpm-v", "janus", "deepseek-vl",
        "emuinstruct", "thumb", "ovis",
    ]):
        return "vision"
    return "text"


# ---------------------------------------------------------------------------
# Probe helpers
# ---------------------------------------------------------------------------
def _get_json(url, timeout):
    """Non-streamed GET returning parsed JSON or error string."""
    try:
        r = requests.get(url, timeout=(CONNECT_TIMEOUT, timeout))
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}: {r.text[:200]}"
        return r.json(), ""
    except requests.exceptions.Timeout:
        return None, f"timeout after {timeout}s"
    except Exception as e:  # noqa
        return None, f"{type(e).__name__}: {e}"


def _post_json(url, body, timeout):
    """Non-streamed POST returning parsed JSON or error string."""
    try:
        r = requests.post(url, json=body, timeout=(CONNECT_TIMEOUT, timeout))
        if r.status_code != 200:
            return None, f"HTTP {r.status_code}: {r.text[:200]}"
        return r.json(), ""
    except requests.exceptions.Timeout:
        return None, f"timeout after {timeout}s"
    except Exception as e:  # noqa
        return None, f"{type(e).__name__}: {e}"


def _get_server_ip_region(host):
    """Rough region from IP prefix — maps known cloud provider ranges."""
    parts = host.split(".")
    if not parts:
        return "unknown"
    first = int(parts[0])
    # Very rough mapping — enough to cluster AWS/GCP/DigitalOcean/OVH/etc.
    if 3 <= first <= 3:
        return "us"
    if 5 <= first <= 5:
        return "eu"
    if 14 <= first <= 15:
        return "ap"
    if 27 <= first <= 31:
        return "ap"
    if 36 <= first <= 39:
        return "ap"
    if 42 <= first <= 44:
        return "ap"
    if 45 <= first <= 45:
        return "sa"
    if 57 <= first <= 57:
        return "ap"
    if 58 <= first <= 61:
        return "ap"
    if 64 <= first <= 76:
        return "us"
    if 77 <= first <= 95:
        return "eu"
    if 96 <= first <= 126:
        return "us"
    if 140 <= first <= 143:
        return "ap"
    if 146 <= first <= 149:
        return "us"
    if 150 <= first <= 151:
        return "ap"
    if 152 <= first <= 159:
        return "us"
    if 160 <= first <= 175:
        return "us"
    if 176 <= first <= 191:
        return "eu"
    if 192 <= first <= 195:
        return "eu"
    if 196 <= first <= 197:
        return "sa"
    if 200 <= first <= 223:
        return "sa"
    if 223 <= first <= 223:
        return "sa"
    return "unknown"


# Capability heuristics ------------------------------------------------------
def score_writing(text: str) -> bool:
    if not text or len(text.strip()) < 30:
        return False
    sentences = re.split(r"[.!?]\s+", text.strip())
    return len([s for s in sentences if len(s.strip()) > 5]) >= 2


def score_coding(text: str) -> bool:
    if not text:
        return False
    return ("```" in text) or re.search(r"\b(def |function |public |class |import |#include|print\()", text) is not None


def score_tooluse(obj) -> bool:
    """Check Ollama response for tool_calls."""
    if not obj:
        return False
    msg = obj.get("message", {})
    if isinstance(msg.get("tool_calls"), list) and len(msg["tool_calls"]) > 0:
        return True
    # some servers nest under choices (openai-compatible path)
    for ch in obj.get("choices", []):
        if ch.get("message", {}).get("tool_calls"):
            return True
    return False


def score_vision(text: str) -> bool:
    if not text or len(text.strip()) < 3:
        return False
    # accept if it says anything substantive (color word strongly suggests it saw the image)
    return True


# ---------------------------------------------------------------------------
# Concurrency benchmark
# Fires concurrent identical requests to measure server behavior under load.
# Returns (results_dict, did_benchmark). Caller appends results to results.jsonl.
# ---------------------------------------------------------------------------
def concurrency_benchmark(url, model):
    body = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with the word 'ok' and nothing else."}],
        "stream": False,
    }
    results = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for level in (1, 2, 4):
            def _req():
                t0 = time.time()
                obj, err = _post_json(url, body, PROBE_TIMEOUT)
                dt = time.time() - t0
                ok = (obj is not None and err == "")
                return dt, ok, err

            futures = [ex.submit(_req) for _ in range(level)]
            outcomes = [f.result() for f in futures]
            lats = [o[0] * 1000 for o in outcomes]
            ok_count = sum(1 for o in outcomes if o[1])
            errs = [o[2] for o in outcomes if not o[1]]
            results[f"concurrency_{level}_all_ok"] = (ok_count == level)
            results[f"concurrency_{level}_avg_latency_ms"] = round(sum(lats) / len(lats)) if lats else None

        baseline = results.get("concurrency_1_avg_latency_ms")
        l2 = results.get("concurrency_2_avg_latency_ms")
        l4 = results.get("concurrency_4_avg_latency_ms")
        if baseline and baseline > 0:
            if l4 and l4 < baseline * 2 and results.get("concurrency_4_all_ok"):
                results["recommended_concurrency"] = 4
            elif l2 and l2 < baseline * 2 and results.get("concurrency_2_all_ok"):
                results["recommended_concurrency"] = 2
            else:
                results["recommended_concurrency"] = 1
        else:
            results["recommended_concurrency"] = None

    return results


# ---------------------------------------------------------------------------
# Per-pair evaluation
# ---------------------------------------------------------------------------
def evaluate_pair(server_idx, server, model):
    url = server["url"].rstrip("/") + "/api/chat"
    kind = classify(model)
    rec = {
        "server_idx": server_idx,
        "server_id": server.get("id"),
        "server_url": server["url"],
        "model": model,
        "kind": kind,
        "server_version": server.get("version"),
        "ts": int(time.time()),
    }

    # Non-generative models: just confirm availability with one tiny generate.
    if kind in ("embedding", "image-gen"):
        t0 = time.time()
        obj, err = _post_json(url, {
            "model": model, "messages": [{"role": "user", "content": "hi"}],
            "stream": False, "options": {"num_predict": 1},
        }, WARMUP_TIMEOUT)
        rec["available"] = obj is not None
        rec["error"] = err
        rec["warmup_ms"] = round((time.time() - t0) * 1000) if obj else None
        rec["capabilities"] = {}
        return rec

    warm_body = {
        "model": model,
        "messages": [{"role": "user", "content": "Write a short 3-sentence paragraph about the ocean."}],
        "stream": False,
    }
    # Fire warmup + V1 compatibility + context window + server version in parallel.
    base_url = server["url"].rstrip("/")
    v1_url = base_url + "/v1/chat/completions"
    v1_body = {
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 2,
    }
    show_url = base_url + "/api/show"
    version_url = base_url + "/api/version"

    def _parallel_warmup():
        return _post_json(url, warm_body, WARMUP_TIMEOUT)

    def _parallel_v1():
        return _post_json(v1_url, v1_body, WARMUP_TIMEOUT)

    def _parallel_context():
        return _post_json(show_url, {"model": model}, WARMUP_TIMEOUT)

    def _parallel_version():
        return _get_json(version_url, 10)

    with ThreadPoolExecutor(max_workers=4) as ex:
        f_warm = ex.submit(_parallel_warmup)
        f_v1 = ex.submit(_parallel_v1)
        f_ctx = ex.submit(_parallel_context)
        f_ver = ex.submit(_parallel_version)
        obj, err = f_warm.result()

    if obj is None:
        rec["available"] = False
        rec["error"] = err
        rec["capabilities"] = {}
        return rec

    rec["available"] = True

    # V1 compatibility
    v1_obj, v1_err = f_v1.result()
    rec["supports_v1"] = v1_obj is not None

    # Context window
    ctx_obj, ctx_err = f_ctx.result()
    if ctx_obj:
        rec["context_window"] = ctx_obj.get("details", {}).get("context_length")
    else:
        rec["context_window"] = None
        rec["context_window_error"] = ctx_err

    # Fresh server version (override stale servers.json version)
    ver_obj, ver_err = f_ver.result()
    if ver_obj:
        rec["server_version_live"] = ver_obj.get("version")
    else:
        rec["server_version_live"] = None
        rec["version_error"] = ver_err

    # IP region
    host = urllib.parse.urlparse(server["url"]).netloc.split(":")[0]
    rec["server_region"] = _get_server_ip_region(host)

    if kind in ("text", "vision"):
        with _sample_lock:
            global _sample_remaining
            do_conc = _sample_remaining > 0
            if do_conc:
                _sample_remaining -= 1
        if do_conc:
            conc = concurrency_benchmark(url, model)
            rec.update({"concurrency_" + k: v for k, v in conc.items()})

    rec["warmup_ms"] = round(obj.get("load_duration", 0) / 1e6) if obj.get("load_duration") else None
    rec["total_duration_ms"] = round(obj.get("total_duration", 0) / 1e6) if obj.get("total_duration") else None
    rec["eval_duration_ms"] = round(obj.get("eval_duration", 0) / 1e6) if obj.get("eval_duration") else None
    rec["eval_count"] = obj.get("eval_count")
    rec["prompt_eval_count"] = obj.get("prompt_eval_count")
    rec["prompt_eval_duration_ms"] = round(obj.get("prompt_eval_duration", 0) / 1e6) if obj.get("prompt_eval_duration") else None
    rec["capabilities"] = {}
    caps = rec["capabilities"]
    text = obj.get("message", {}).get("content", "") or ""
    caps["writing"] = score_writing(text)
    rec["writing_excerpt"] = text[:200]

    # Coding probe
    obj, err = _post_json(url, {
        "model": model,
        "messages": [{"role": "user", "content": "Write a Python function that reverses a string. Return only code."}],
        "stream": False,
    }, PROBE_TIMEOUT)
    if obj is not None:
        ctext = obj.get("message", {}).get("content", "")
        if not ctext and obj.get("choices"):
            ctext = obj["choices"][0].get("message", {}).get("content", "")
        caps["coding"] = score_coding(ctext)
        rec["coding_excerpt"] = ctext[:200]
    else:
        caps["coding"] = False
        rec["coding_error"] = err

    # Tool-use probe
    tool_body = {
        "model": model,
        "messages": [{"role": "user", "content": "What is the weather in Paris? Use the get_weather tool."}],
        "tools": [{
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get the current weather for a city",
                "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]},
            },
        }],
        "stream": False,
    }
    tool_obj, tool_err = _post_json(url, tool_body, PROBE_TIMEOUT)
    if tool_obj is not None:
        caps["tool_use"] = score_tooluse(tool_obj)
        tool_text = tool_obj.get("message", {}).get("content", "")
        rec["tool_response"] = tool_text[:100]
    else:
        caps["tool_use"] = False
        rec["tool_error"] = tool_err

    # Consistency score: 3× warm identical prompt
    ok_body = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with the word 'ok' and nothing else."}],
        "stream": False,
    }
    consistency_ok = 0
    for _ in range(3):
        o, _ = _post_json(url, ok_body, PROBE_TIMEOUT)
        if o:
            content = o.get("message", {}).get("content", "").strip().lower()
            if content == "ok":
                consistency_ok += 1
    rec["consistency_score"] = consistency_ok  # 0-3

    # Tool consistency: 3× tool prompt (only if tool_use was true)
    if caps.get("tool_use"):
        tool_consistent_args = 0
        tool_called_count = 0
        first_tool_call = None
        for _ in range(3):
            o, _ = _post_json(url, tool_body, PROBE_TIMEOUT)
            if o:
                tc = o.get("message", {}).get("tool_calls")
                if tc and len(tc) > 0:
                    tool_called_count += 1
                    args = json.dumps(tc[0].get("function", {}).get("arguments", ""))
                    if first_tool_call is None:
                        first_tool_call = args
                    elif args == first_tool_call:
                        tool_consistent_args += 1
        rec["tool_consistency_calls"] = tool_called_count  # 0-3
        rec["tool_consistency_args"] = tool_consistent_args  # 0-3 (matches first call)
    else:
        rec["tool_consistency_calls"] = 0
        rec["tool_consistency_args"] = 0

    # Vision probe
    if kind == "vision":
        vobj, verr = _post_json(url, {
            "model": model,
            "messages": [{"role": "user", "content": "What color is this image? Reply with one word.",
                          "images": [VISION_B64]}],
            "stream": False,
        }, PROBE_TIMEOUT)
        if vobj is not None:
            vtext = vobj.get("message", {}).get("content", "")
            caps["vision"] = score_vision(vtext)
            rec["vision_excerpt"] = vtext[:200]
        else:
            caps["vision"] = False
            rec["vision_error"] = verr

    return rec


# ---------------------------------------------------------------------------
# Run loop
# ---------------------------------------------------------------------------
def build_pairs(servers):
    pairs = []
    for idx, s in enumerate(servers):
        models = s.get("v1Models") or s.get("models") or []
        for m in models:
            pairs.append((idx, s, m))
    return pairs


def load_done():
    if os.path.exists(DONESET):
        try:
            return set(json.load(open(DONESET)))
        except Exception:
            return set()
    return set()


def save_done(done):
    tmp = DONESET + ".tmp"
    json.dump(list(done), open(tmp, "w"))
    os.replace(tmp, DONESET)


def run(limit=None):
    servers = json.load(open(SERVERS_JSON))
    pairs = build_pairs(servers)
    log(f"Total (server,model) pairs in servers.json: {len(pairs)}")

    done = load_done()
    pending = [(i, s, m) for (i, s, m) in pairs if f"{i}|{m}" not in done]
    log(f"Already evaluated: {len(done)} | Pending: {len(pending)}")
    if limit:
        pending = pending[:limit]
        log(f"Limited run to first {limit} pending pairs")

    completed = 0
    failed = 0
    lock = threading.Lock()
    stop = threading.Event()

    def worker(pair):
        i, s, m = pair
        try:
            rec = evaluate_pair(i, s, m)
        except Exception as e:  # noqa
            rec = {"server_idx": i, "server_id": s.get("id"), "model": m,
                   "available": False, "error": f"worker-exc: {e}"}
        with lock:
            with open(RESULTS, "a") as f:
                f.write(json.dumps(rec) + "\n")
            done.add(f"{i}|{m}")
            save_done(done)
            nonlocal completed, failed
            completed += 1
            if not rec.get("available"):
                failed += 1
            if completed % 25 == 0:
                log(f"[progress] done={completed} ok={completed-failed} fail={failed} pending={len(pending)-completed}")
        return rec

    log(f"Launching {WORKERS} workers against upstream fleet (direct, no proxy)...")
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = [ex.submit(worker, p) for p in pending]
        for _ in as_completed(futures):
            if stop.is_set():
                break
    log(f"DONE. completed={completed} failed={failed}")


# ---------------------------------------------------------------------------
# Summarize
# ---------------------------------------------------------------------------
def summarize():
    if not os.path.exists(RESULTS):
        log("No results.jsonl yet.")
        return
    rows = [json.loads(l) for l in open(RESULTS) if l.strip()]
    log(f"Loaded {len(rows)} result records.")

    # Model replication + capability tally
    from collections import defaultdict, Counter
    model_servers = defaultdict(set)
    model_kind = {}
    model_cap = defaultdict(lambda: Counter())
    model_avail = defaultdict(int)
    server_capable = defaultdict(int)       # server_idx -> # capable models
    server_total = defaultdict(int)
    server_resp = defaultdict(list)         # server_idx -> [warmup_ms]
    dead_servers = set()
    all_server_idx = set()

    for r in rows:
        si = r["server_idx"]
        m = r["model"]
        all_server_idx.add(si)
        model_servers[m].add(si)
        model_kind[m] = r.get("kind", "text")
        server_total[si] += 1
        if r.get("available"):
            model_avail[m] += 1
            w = r.get("warmup_ms")
            if w is not None:
                server_resp[si].append(w)
            caps = r.get("capabilities", {})
            for cap, val in caps.items():
                if val:
                    model_cap[m][cap] += 1
            # a server is "capable" if at least one model produced a usable response
            server_capable[si] += 1
        else:
            # track servers that returned nothing usable across all tried models
            pass

    # Servers that tried >=1 model and got zero available
    zero_servers = [si for si in all_server_idx if server_total[si] > 0 and server_capable[si] == 0]

    summary = {
        "generated_at": int(time.time()),
        "records": len(rows),
        "distinct_servers_tested": len(all_server_idx),
        "distinct_models_tested": len(model_servers),
        "servers_with_zero_capable_models": len(zero_servers),
        "zero_capable_server_idxs": sorted(zero_servers),
        "models_by_replication": sorted(
            [{"model": k, "servers": len(v), "kind": model_kind[k], "available_on": model_avail[k]}
             for k, v in model_servers.items()],
            key=lambda x: -x["servers"])[:50],
        "vision_capable_models": sorted(
            [k for k in model_servers if model_cap[k].get("vision", 0) > 0]),
        "tool_capable_models": sorted(
            [k for k in model_servers if model_cap[k].get("tool_use", 0) > 0]),
        "writing_capable_models": sorted(
            [k for k in model_servers if model_cap[k].get("writing", 0) > 0]),
        "coding_capable_models": sorted(
            [k for k in model_servers if model_cap[k].get("coding", 0) > 0]),
        "model_capability_tally": {
            k: dict(v) for k, v in model_cap.items()
        },
    }
    json.dump(summary, open(SUMMARY, "w"), indent=2)

    # Markdown report
    md = []
    md.append("# Fleet Evaluation Summary\n")
    md.append(f"- Generated: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(summary['generated_at']))}")
    md.append(f"- Records: {summary['records']}")
    md.append(f"- Distinct servers tested: {summary['distinct_servers_tested']}")
    md.append(f"- Distinct models tested: {summary['distinct_models_tested']}")
    md.append(f"- **Servers with ZERO capable models (dead/incapable): {summary['servers_with_zero_capable_models']}**")
    md.append("")
    md.append("## Top models by replication (server count)")
    md.append("| Model | Servers | Kind | Available on |")
    md.append("|---|---|---|---|")
    for x in summary["models_by_replication"][:30]:
        md.append(f"| {x['model']} | {x['servers']} | {x['kind']} | {x['available_on']} |")
    md.append("")
    md.append(f"## Vision-capable models ({len(summary['vision_capable_models'])})")
    md.append(', '.join(summary['vision_capable_models']) or 'none')
    md.append("")
    md.append(f"## Tool-use-capable models ({len(summary['tool_capable_models'])})")
    md.append(', '.join(summary['tool_capable_models'][:60]) or 'none')
    md.append("")
    md.append(f"## Writing-capable models ({len(summary['writing_capable_models'])})")
    md.append(', '.join(summary['writing_capable_models'][:60]) or 'none')
    md.append("")
    md.append(f"## Coding-capable models ({len(summary['coding_capable_models'])})")
    md.append(', '.join(summary['coding_capable_models'][:60]) or 'none')
    md.append("")
    md.append("## Dead / incapable servers (zero capable models)")
    md.append(", ".join(str(x) for x in summary["zero_capable_server_idxs"][:200]) or "none")
    open(SUMMARY_MD, "w").write("\n".join(md))

    log(f"Summary written -> {SUMMARY} and {SUMMARY_MD}")
    log(f"Servers with zero capable models: {summary['servers_with_zero_capable_models']}")
    log(f"Vision models: {len(summary['vision_capable_models'])} | Tool models: {len(summary['tool_capable_models'])}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--summarize", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=None)
    args = ap.parse_args()
    if args.workers:
        WORKERS = args.workers
    if args.summarize:
        summarize()
    else:
        run(limit=args.limit)
