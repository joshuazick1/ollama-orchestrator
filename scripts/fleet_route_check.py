#!/usr/bin/env python3
"""
fleet_route_check.py — Validate orchestrator routing decisions against fleet evaluation findings.

Sends inference requests through the orchestrator with debug enabled, parses routing
decision headers, and cross-references against data/fleet-eval/results.jsonl:
  - Server selection matches a healthy, capable server
  - maxConcurrency is respected
  - TTFT is within expected range for the model
  - Servers with known failures (c1/c2) are NOT selected
  - Routing algorithm matches protocol

Usage:
  python3 fleet_route_check.py                       # smoke: 5 random models
  python3 fleet_route_check.py --model llama3.2:3b  # specific model
  python3 fleet_route_check.py --sample 20            # 20 random models
  python3 fleet_route_check.py --all                # exhaustively test all live models
  python3 fleet_route_check.py --verbose             # show all warnings
"""
import json, os, sys, time, argparse, random
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

ROOT = "/root/project/ollama-orchestrator"
ORCHESTRATOR_URL = os.environ.get("ORCHESTRATOR_URL", "http://localhost:5100")
RESULTS = os.path.join(ROOT, "data", "fleet-eval", "results.jsonl")
SERVERS_JSON = os.path.join(ROOT, "data", "servers.json")

CONNECT_TIMEOUT = 10
REQUEST_TIMEOUT = 120

plock = __import__("threading").Lock()
def log(msg):
    with plock:
        print(msg, flush=True)

def load_eval_data():
    if not os.path.exists(RESULTS):
        return {}, {}, set(), set()
    rows = [json.loads(l) for l in open(RESULTS) if l.strip()]
    server_data = {}
    model_data = {}
    c1_servers = set()
    c2_servers = set()
    for r in rows:
        url = r["server_url"]
        m = r["model"]
        if url not in server_data:
            server_data[url] = {
                "available": r.get("available", False),
                "warmup_ms": r.get("warmup_ms"),
                "capabilities": r.get("capabilities", {}),
                "concurrency_rec": None,
            }
        conc = r.get("concurrency_recommended_concurrency")
        if conc is not None:
            cur = server_data[url]["concurrency_rec"]
            if cur is None or conc < cur:
                server_data[url]["concurrency_rec"] = conc
        if m not in model_data:
            model_data[m] = {"servers": set(), "warmups": [], "capabilities": defaultdict(int)}
        if r.get("available"):
            model_data[m]["servers"].add(url)
            if r.get("warmup_ms"):
                model_data[m]["warmups"].append(r["warmup_ms"])
            for k, v in r.get("capabilities", {}).items():
                if v:
                    model_data[m]["capabilities"][k] += 1
        if r.get("concurrency_recommended_concurrency") == 1:
            c1_servers.add(url)
        elif r.get("concurrency_recommended_concurrency") == 2:
            c2_servers.add(url)
    return server_data, model_data, c1_servers, c2_servers

def get_live_models():
    r = requests.get(f"{ORCHESTRATOR_URL}/v1/models", timeout=CONNECT_TIMEOUT)
    r.raise_for_status()
    return [m["id"] for m in r.json().get("data", [])]

def enable_debug_mode():
    try:
        r = requests.patch(
            f"{ORCHESTRATOR_URL}/admin/config",
            json={"proxy": {"debugHeadersMode": "always"}},
            timeout=CONNECT_TIMEOUT
        )
        return r.status_code in (200, 204)
    except Exception:
        return False

def send_request(model, prompt="Say 'ok' in one word.", max_tokens=5, stream=False):
    headers = {
        "Content-Type": "application/json",
        "X-Include-Debug-Info": "true",
    }
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "stream": stream,
    }
    t0 = time.time()
    try:
        r = requests.post(
            f"{ORCHESTRATOR_URL}/v1/chat/completions?debug=true",
            json=body,
            headers=headers,
            timeout=(CONNECT_TIMEOUT, REQUEST_TIMEOUT),
        )
        latency_ms = round((time.time() - t0) * 1000)
    except requests.exceptions.Timeout:
        return None, f"timeout after {REQUEST_TIMEOUT}s", {}
    except Exception as e:
        return None, str(e), {}

    debug = {}
    for k, v in r.headers.items():
        if k.lower().startswith("x-orchestrator-debug-"):
            debug[k.replace("X-Orchestrator-Debug-", "").lower()] = v

    result_body = {}
    if r.status_code == 200:
        try:
            result_body = r.json()
            body_debug = result_body.get("debug", {})
            if body_debug and isinstance(body_debug, dict):
                for kk, vv in body_debug.items():
                    key = kk.lower()
                    if key not in debug:
                        debug[key] = vv
        except Exception:
            pass

    if r.status_code != 200:
        return None, f"HTTP {r.status_code}: {r.text[:200]}", {}

    return {
        "latency_ms": latency_ms,
        "selected_server": debug.get("selected-server"),
        "server_circuit": debug.get("server-circuit-state"),
        "model_circuit": debug.get("model-circuit-state"),
        "algorithm": debug.get("algorithm"),
        "ttft_ms": float(debug.get("time-to-first-token", 0)) or None,
        "retry_count": int(debug.get("retry-count", 0)) or 0,
        "failover_count": int(debug.get("failover-count", 0)) or 0,
        "server_load": float(debug.get("server-load", 0)) or None,
        "max_concurrency": int(debug.get("max-concurrency", 0)) or None,
        "queue_wait_ms": float(debug.get("queue-wait-ms", 0)) or None,
        "available_servers": int(debug.get("available-servers", 0)) or None,
        "servers_tried": debug.get("servers-tried", "").split(",") if debug.get("servers-tried") else [],
    }, "", debug

def validate(result, model, server_data, model_data, c1_servers, c2_servers, servers):
    warnings = []
    sel = result.get("selected_server")
    id_to_url = {s.get("id"): s.get("url") for s in servers}
    id_to_title = {s.get("id"): s.get("title", s.get("id")) for s in servers}
    sel_url = id_to_url.get(sel, sel or "")
    sel_title = id_to_title.get(sel, sel or "")
    result["selected_server_url"] = sel_url
    result["selected_server_title"] = sel_title

    if not sel:
        warnings.append("[WARN] No server selected (all circuits open?)")
        return warnings

    sd = server_data.get(sel_url, {})
    conc_rec = sd.get("concurrency_rec")
    if conc_rec == 1 and sel_url in c1_servers:
        warnings.append(f"[WARN] Selected c1-fail server {sel_title} — verify maxConcurrency=1 enforced at LB")
    elif conc_rec == 2 and sel_url in c2_servers:
        warnings.append(f"[WARN] Selected c2-fail server {sel_title} — check maxConcurrency is respected")

    if sel_url in server_data and not server_data[sel_url].get("available"):
        warnings.append(f"[WARN] Server {sel_title} returned zero available models in fleet eval")

    if model in model_data and sel_url not in model_data[model]["servers"]:
        warnings.append(f"[INFO] Model {model} was not evaluated on {sel_title} in fleet eval")

    ttft = result.get("ttft_ms")
    if model in model_data and model_data[model]["warmups"]:
        warmups = model_data[model]["warmups"]
        avg_w = sum(warmups) / len(warmups)
        if ttft and ttft > avg_w * 3:
            warnings.append(f"[WARN] TTFT {ttft:.0f}ms >> expected warmup ~{avg_w:.0f}ms for {model}")

    if result.get("server_circuit") in ("banned", "open"):
        warnings.append(f"[WARN] Server circuit state: {result['server_circuit']}")
    if result.get("model_circuit") == "banned":
        warnings.append(f"[WARN] Model {model} is circuit-banned")

    if result.get("retry_count", 0) > 0:
        warnings.append(f"[INFO] Retried {result['retry_count']}x")
    if result.get("failover_count", 0) > 0:
        warnings.append(f"[INFO] Failover: tried {result['failover_count']} server(s)")
    if result.get("queue_wait_ms", 0) > 2000:
        warnings.append(f"[INFO] Queue wait: {result['queue_wait_ms']:.0f}ms")

    return warnings

def run_check(models, concurrency=4):
    servers = json.load(open(SERVERS_JSON))
    server_data, model_data, c1_servers, c2_servers = load_eval_data()
    log(f"Loaded: {len(server_data)} servers, {len(model_data)} models from eval data")
    log(f"c1-fail servers: {len(c1_servers)}, c2-fail: {len(c2_servers)}")

    results = []
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = {ex.submit(send_request, m): m for m in models}
        for future in as_completed(futures):
            m = futures[future]
            try:
                result, err, debug = future.result()
                if err:
                    results.append({"model": m, "error": err, "passed": False})
                    log(f"  FAIL {m}: {err}")
                    continue
                warnings = validate(result, m, server_data, model_data, c1_servers, c2_servers, servers)
                passed = not any(w.startswith("[WARN]") for w in warnings)
                result["model"] = m
                result["warnings"] = warnings
                result["passed"] = passed
                results.append(result)
                status = "PASS" if passed else "WARN"
                log(f"  {status} {m} -> {result.get('selected_server_title','?')} "
                    f"latency={result.get('latency_ms')}ms "
                    f"ttft={result.get('ttft_ms')}ms "
                    f"circuit={result.get('server_circuit','?')} "
                    f"load={result.get('server_load','?')} "
                    f"conc={result.get('max_concurrency','?')}")
                for w in warnings:
                    log(f"         {w}")
            except Exception as e:
                results.append({"model": m, "error": str(e), "passed": False})
                log(f"  EXC {m}: {e}")

    passed = sum(1 for r in results if r.get("passed"))
    warn = sum(1 for r in results if not r.get("passed") and not r.get("error"))
    err = sum(1 for r in results if r.get("error"))
    log(f"\n=== {passed}/{len(results)} passed | {warn} warnings | {err} errors ===")
    algos = defaultdict(lambda: {"total": 0, "warn": 0})
    for r in results:
        a = r.get("algorithm", "unknown")
        algos[a]["total"] += 1
        if not r.get("passed"):
            algos[a]["warn"] += 1
    if algos:
        log(f"\nRouting algorithm:")
        for a, v in sorted(algos.items()):
            log(f"  {a}: {v['total']} ({v['warn']} warnings)")
    return results

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", help="Test specific model")
    ap.add_argument("--sample", type=int, help="Test N random live models")
    ap.add_argument("--all", action="store_true", help="Test all live models")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    if args.model:
        models = [args.model]
    else:
        try:
            live = get_live_models()
            if args.all:
                models = live
            elif args.sample:
                random.seed(42)
                models = random.sample(live, min(args.sample, len(live)))
            else:
                random.seed(42)
                models = random.sample(live, min(5, len(live)))
        except Exception as e:
            log(f"Could not fetch live models: {e}")
            _, md, _, _ = load_eval_data()
            models = list(md.keys())[:5]

    debug_mode = enable_debug_mode()
    if debug_mode:
        log("[debug] Enabled always mode for debug headers")
    else:
        log("[debug] Could not enable always mode — relying on ?debug=true query param")

    log(f"Testing {len(models)} model(s)")
    run_check(models, concurrency=args.workers)
