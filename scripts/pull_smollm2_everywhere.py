#!/usr/bin/env python3
"""pull_smollm2_everywhere.py — pull a model onto every healthy Ollama server
in the orchestrator fleet that doesn't already host it. Hits each backend
directly via /api/pull (avoids the orchestrator admin auth path).

Usage:
  python3 scripts/pull_smollm2_everywhere.py [options]

Options:
  --url URL        Orchestrator base URL       (default: http://localhost:5100)
  --model NAME     Model name to pull          (default: smollm2:135m)
  --concurrency N  Max simultaneous pulls      (default: 8)
  --pull-timeout S Per-server pull deadline    (default: 600)
  --report-dir D   Directory for JSON report   (default: .sisyphus/reports)
  --include-already  Pull anyway even on hosts that already have it (off)
"""
from __future__ import annotations
import argparse, json, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
import threading


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="http://localhost:5100")
    p.add_argument("--model", default="smollm2:135m")
    p.add_argument("--concurrency", type=int, default=8)
    p.add_argument("--pull-timeout", type=int, default=600)
    p.add_argument("--report-dir", default=".sisyphus/reports")
    p.add_argument("--include-already", action="store_true")
    return p.parse_args()


def http_json(url: str, timeout: int = 30):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def list_orchestrator_models(orch_url: str):
    """Discover Ollama servers in the fleet from the orchestrator's /api/tags.
    Returns dict[sid] -> {models: [name...]}.  This does NOT carry the
    server's URL, so we resolve URLs separately from servers.json below."""
    catalog = http_json(f"{orch_url}/api/tags", timeout=20)
    servers = {}
    for m in catalog.get("models", []):
        for sid in m.get("servers", []) or []:
            entry = servers.setdefault(sid, {"models": []})
            entry["models"].append(m.get("name"))
    return servers


def resolve_backend_urls():
    """Read servers.json (orchestrator's persisted fleet state) and return
    dict[sid] -> url.  This file exists alongside this script at
    ../data/servers.json."""
    here = Path(__file__).resolve().parents[1] / "data" / "servers.json"
    if not here.exists():
        print(f"[pull] WARN: {here} not found", file=sys.stderr)
        return {}
    try:
        data = json.loads(here.read_text())
    except Exception as e:
        print(f"[pull] WARN: could not parse {here}: {e}", file=sys.stderr)
        return {}
    by_id = {}
    for s in data:
        if isinstance(s, dict) and s.get("url") and s.get("id"):
            by_id[s["id"]] = s["url"]
    return by_id


def probe_ollama(server_url: str, model: str, timeout: int = 5):
    """Return (has_model, model_count, error_str).  has_model is True only when
    we successfully read /api/tags AND model appears in the names list."""
    try:
        d = http_json(f"{server_url}/api/tags", timeout=timeout)
        names = {m.get("name") for m in d.get("models", [])}
        return model in names, len(d.get("models", [])), None
    except Exception as e:
        return False, 0, f"{type(e).__name__}: {e}"


def pull_blocking(server_url: str, model: str, timeout: int, log_sink):
    """POST /api/pull with stream=True; follow the NDJSON until either
    'status':'success' or an 'error' event.  Returns a result dict."""
    t0 = time.monotonic()
    body = json.dumps({"model": model, "stream": True, "insecure": True}).encode()
    req = urllib.request.Request(
        f"{server_url}/api/pull",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            buf = b""
            last_chunk = None
            total_bytes = 0
            for chunk in iter(lambda: resp.read(8192), b""):
                buf += chunk
                total_bytes += len(chunk)
                while b"\n" in buf:
                    line, _, buf = buf.partition(b"\n")
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        ev = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    last_chunk = ev
                    log_sink(ev)
                    status = ev.get("status", "")
                    if status == "success":
                        return {
                            "status": "pulled",
                            "elapsed_s": round(time.monotonic() - t0, 2),
                            "bytes": total_bytes,
                            "last_chunk": last_chunk,
                            "error": None,
                        }
                    if "error" in ev and ev.get("error"):
                        return {
                            "status": "error",
                            "elapsed_s": round(time.monotonic() - t0, 2),
                            "bytes": total_bytes,
                            "last_chunk": last_chunk,
                            "error": ev.get("error"),
                        }
            return {
                "status": "ended_without_success",
                "elapsed_s": round(time.monotonic() - t0, 2),
                "bytes": total_bytes,
                "last_chunk": last_chunk,
                "error": None,
            }
    except urllib.error.HTTPError as e:
        return {
            "status": "http_error",
            "elapsed_s": round(time.monotonic() - t0, 2),
            "bytes": 0,
            "last_chunk": None,
            "error": f"{e.code} {e.reason}: {e.read()[:200]!r}",
        }
    except Exception as e:
        return {
            "status": "exception",
            "elapsed_s": round(time.monotonic() - t0, 2),
            "bytes": 0,
            "last_chunk": None,
            "error": f"{type(e).__name__}: {e}",
        }


def main():
    args = parse_args()
    catalog = list_orchestrator_models(args.url)
    by_url = resolve_backend_urls()
    print(
        f"[pull] orchestrator reports {len(catalog)} server(s) hosting any model",
        file=sys.stderr,
    )

    candidates = []
    for sid, info in catalog.items():
        url = by_url.get(sid)
        if not url:
            continue
        candidates.append({
            "id": sid,
            "url": url,
            "models": info["models"],
            "has_model_per_catalog": args.model in info["models"],
        })

    print(f"[pull] {len(candidates)} candidate server(s) with known backend URLs", file=sys.stderr)
    if args.include_already:
        todo = candidates
    else:
        todo = [c for c in candidates if not c["has_model_per_catalog"]]

    print(f"[pull] pre-checking {len(todo)} server(s) for direct reachability...", file=sys.stderr)
    reachable, unreachable = [], []
    for c in todo:
        has, n, err = probe_ollama(c["url"], args.model, timeout=6)
        c["probe_ok"] = bool(n >= 0 or err is None)
        c["actually_has_model"] = has
        c["model_count"] = n
        c["probe_err"] = err
        if err is None:
            reachable.append(c)
        else:
            unreachable.append(c)

    need_pull = [c for c in reachable if not c["actually_has_model"]]
    already = [c for c in reachable if c["actually_has_model"]]
    print(
        f"[pull] reachable={len(reachable)}  already_has={len(already)}  "
        f"need_pull={len(need_pull)}  unreachable={len(unreachable)}",
        file=sys.stderr,
    )

    if not need_pull:
        print("[pull] nothing to do", file=sys.stderr)
        summary = {
            "started_at": datetime.now(timezone.utc).isoformat(),
            "model": args.model,
            "orchestrator_url": args.url,
            "concurrency": args.concurrency,
            "candidates_total": len(candidates),
            "reachable": len(reachable),
            "already_have_model": len(already),
            "pulled": 0,
            "failed": 0,
            "wall_clock_s": 0,
            "unreachable_servers": [
                {"id": c["id"], "url": c["url"], "error": c.get("probe_err")}
                for c in unreachable
            ],
            "results": [],
        }
    else:
        results = []
        completed = 0
        lock = threading.Lock()

        def log_sink_for(sid):
            def sink(ev):
                s = ev.get("status", "")
                if ev.get("error"):
                    s = f"ERROR {ev['error']}"
                with lock:
                    print(f"  [{sid[:12]}] {s}", file=sys.stderr)
            return sink

        def worker(c):
            sid = c["id"]
            sink = log_sink_for(sid)
            with lock:
                print(f"[pull] -> {sid[:12]} {c['url']}", file=sys.stderr)
            r = pull_blocking(c["url"], args.model, args.pull_timeout, sink)
            r["id"] = sid
            r["url"] = c["url"]
            return r

        started = time.monotonic()
        with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
            futures = {ex.submit(worker, c): c for c in need_pull}
            for fut in as_completed(futures):
                try:
                    r = fut.result()
                except Exception as e:
                    r = {"id": futures[fut]["id"], "url": futures[fut]["url"],
                         "status": "worker_exception", "error": str(e), "elapsed_s": 0, "bytes": 0}
                results.append(r)
                completed += 1
                with lock:
                    print(
                        f"[pull] ({completed}/{len(need_pull)}) {r.get('id','?')[:12]} "
                        f"{r.get('status')} elapsed={r.get('elapsed_s')}s",
                        file=sys.stderr,
                    )
        total = round(time.monotonic() - started, 2)

        ok = sum(1 for r in results if r.get("status") == "pulled")
        fail = len(results) - ok
        summary = {
            "started_at": datetime.now(timezone.utc).isoformat(),
            "model": args.model,
            "orchestrator_url": args.url,
            "concurrency": args.concurrency,
            "candidates_total": len(candidates),
            "reachable": len(reachable),
            "unreachable": len(unreachable),
            "already_have_model": len(already),
            "pulled": ok,
            "failed": fail,
            "wall_clock_s": total,
            "unreachable_servers": [
                {"id": c["id"], "url": c["url"], "error": c.get("probe_err")}
                for c in unreachable
            ],
            "results": [
                {
                    "id": r.get("id"),
                    "url": r.get("url"),
                    "status": r.get("status"),
                    "elapsed_s": r.get("elapsed_s"),
                    "bytes": r.get("bytes"),
                    "error": r.get("error"),
                    "last_status": (r.get("last_chunk") or {}).get("status"),
                }
                for r in sorted(results, key=lambda r: r.get("id") or "")
            ],
        }

    out_dir = Path(args.report_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    out_path = out_dir / f"pull_{args.model.replace(':','_')}_{stamp}.json"
    out_path.write_text(json.dumps(summary, indent=2))
    print(f"[pull] report: {out_path}", file=sys.stderr)
    print(
        f"\n=== PULL SUMMARY ===\n"
        f"candidates_total: {summary['candidates_total']}\n"
        f"reachable       : {summary['reachable']}\n"
        f"already_have    : {summary['already_have_model']}\n"
        f"pulled          : {summary['pulled']}\n"
        f"failed          : {summary['failed']}\n"
        f"wall_clock_s    : {summary['wall_clock_s']}\n"
        f"report          : {out_path}",
    )


if __name__ == "__main__":
    main()
