#!/usr/bin/env python3
"""Pull qwen3:4b-instruct onto every healthy Ollama server in the fleet.
Reads servers.json directly, probes then pulls. Saves incremental progress
as a checkpoint file so it can be killed and resumed.

Usage:
  python3 scripts/pull-qwen3-everywhere.py [--concurrency N] [--batch N]
"""
from __future__ import annotations
import argparse, json, sys, time, urllib.request, urllib.error, os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
import threading

MODEL = "qwen3:4b-instruct"
CHECKPOINT = Path(".sisyphus/reports/pull-qwen3-checkpoint.json")
REPORT = Path(".sisyphus/reports/pull-qwen3-4b-report.json")

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--concurrency", type=int, default=16)
    p.add_argument("--batch", type=int, default=50, help="Servers per batch (saves checkpoint between batches)")
    p.add_argument("--pull-timeout", type=int, default=600)
    return p.parse_args()


def probe_ollama(url, timeout=10):
    try:
        req = urllib.request.Request(f"{url}/api/tags", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            d = json.loads(resp.read())
        names = {m.get("name") for m in d.get("models", [])}
        return MODEL in names, len(d.get("models", [])), None
    except Exception as e:
        return False, 0, f"{type(e).__name__}: {e}"


def pull_blocking(url, model, timeout, progress_file, sid):
    """POST /api/pull, follow NDJSON. Writes progress updates to shared file."""
    t0 = time.monotonic()
    body = json.dumps({"model": model, "stream": True}).encode()
    req = urllib.request.Request(
        f"{url}/api/pull", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            buf = b""
            last_chunk = None
            for chunk in iter(lambda: resp.read(8192), b""):
                buf += chunk
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
                    status = ev.get("status", "")
                    if status == "success":
                        return {"status": "pulled", "elapsed_s": round(time.monotonic() - t0, 2), "error": None}
                    if "error" in ev and ev.get("error"):
                        return {"status": "error", "elapsed_s": round(time.monotonic() - t0, 2), "error": ev["error"]}
            return {"status": "ended", "elapsed_s": round(time.monotonic() - t0, 2), "error": "no_success"}
    except urllib.error.HTTPError as e:
        detail = e.read()[:200].decode(errors="replace") if e.fp else ""
        return {"status": "http_error", "elapsed_s": round(time.monotonic() - t0, 2), "error": f"{e.code}: {detail}"}
    except Exception as e:
        return {"status": "exception", "elapsed_s": round(time.monotonic() - t0, 2), "error": f"{type(e).__name__}: {e}"}


def save_checkpoint(done, failed, remaining, already, unreachable, results):
    data = {
        "model": MODEL,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "done": done, "failed": failed,
        "remaining": [{"id": s["id"], "url": s["url"]} for s in remaining],
        "already_have": [{"id": s["id"], "url": s["url"]} for s in already],
        "unreachable": [{"id": s["id"], "url": s["url"], "error": s.get("error","")} for s in unreachable],
        "results": results,
    }
    CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
    CHECKPOINT.write_text(json.dumps(data, indent=2))


def main():
    args = parse_args()
    start_ts = datetime.now(timezone.utc)

    # Check if we're resuming from a checkpoint
    resume = CHECKPOINT.exists() and CHECKPOINT.stat().st_size > 10
    if resume:
        cp = json.loads(CHECKPOINT.read_text())
        print(f"[pull] RESUMING from checkpoint: {cp['done']} done, {len(cp['remaining'])} remaining",
              file=sys.stderr)
        already = [{"id": s["id"], "url": s["url"]} for s in cp["already_have"]]
        unreachable = [{"id": s["id"], "url": s["url"], "error": s.get("error","")} for s in cp["unreachable"]]
        all_remaining = [{"id": s["id"], "url": s["url"]} for s in cp["remaining"]]
        results = cp.get("results", [])
        done_count = cp["done"]
        failed_count = cp["failed"]
    else:
        # Fresh start: read servers.json
        sj_path = Path(__file__).resolve().parents[1] / "data" / "servers.json"
        with open(sj_path) as f:
            raw = json.load(f)
        healthy = [s for s in raw if s.get("healthy", False)]
        print(f"[pull] {len(healthy)} healthy servers", file=sys.stderr)

        print(f"[pull] Probing {len(healthy)} servers...", file=sys.stderr)
        need_pull = []
        already = []
        unreachable = []
        lock = threading.Lock()

        def probe_one(s):
            has, n, err = probe_ollama(s["url"])
            if err:
                return ("unreachable", s["id"], s["url"], err)
            elif has:
                return ("already", s["id"], s["url"], n)
            else:
                return ("need", s["id"], s["url"], n)

        with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            futs = {pool.submit(probe_one, s): s for s in healthy}
            for fut in as_completed(futs):
                kind, sid, url, extra = fut.result()
                with lock:
                    if kind == "unreachable":
                        unreachable.append({"id": sid, "url": url, "error": extra})
                    elif kind == "already":
                        already.append({"id": sid, "url": url})
                    else:
                        need_pull.append({"id": sid, "url": url})

        print(f"[pull] need_pull={len(need_pull)} already={len(already)} unreachable={len(unreachable)}",
              file=sys.stderr)
        all_remaining = need_pull
        results = []
        done_count = 0
        failed_count = 0

    # Phase 2: Pull in batches
    if not all_remaining:
        print("[pull] Nothing to pull!", file=sys.stderr)
    else:
        total = len(all_remaining)
        print(f"[pull] Pulling {MODEL} to {total} servers in batches of {args.batch}...", file=sys.stderr)

        batch_num = 0
        while all_remaining:
            batch = all_remaining[:args.batch]
            all_remaining = all_remaining[args.batch:]
            batch_num += 1
            print(f"[pull] Batch {batch_num}: {len(batch)} servers ({len(all_remaining)} remaining)",
                  file=sys.stderr)

            batch_results = []
            lock = threading.Lock()

            def worker(s):
                sid = s["id"]
                nonlocal done_count, failed_count
                with lock:
                    print(f"[pull]   -> {sid[:12]} {s['url']}", file=sys.stderr, flush=True)
                r = pull_blocking(s["url"], MODEL, args.pull_timeout, None, sid)
                r["id"] = sid
                r["url"] = s["url"]
                with lock:
                    if r.get("error"):
                        failed_count += 1
                    else:
                        done_count += 1
                    rem = len(all_remaining) + len(batch) - (done_count + failed_count - (total - len(all_remaining) - len(batch)))
                    print(f"[pull] [{done_count}/{total}] {sid[:12]} -> {r['status']} {r.get('elapsed_s',0):.0f}s  rem={rem}",
                          file=sys.stderr, flush=True)
                return r

            with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
                futs = {pool.submit(worker, s): s for s in batch}
                for fut in as_completed(futs):
                    batch_results.append(fut.result())

            results.extend(batch_results)

            # Checkpoint after each batch
            save_checkpoint(done_count, failed_count, all_remaining, already, unreachable, results)

    wall = round((datetime.now(timezone.utc) - start_ts).total_seconds(), 2)

    report = {
        "model": MODEL,
        "started_at": start_ts.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "need_pull_total": len(results) + done_count + failed_count,
        "already_have": len(already),
        "unreachable": len(unreachable),
        "pulled": done_count,
        "failed": failed_count,
        "wall_clock_s": wall,
        "results": results,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2))
    CHECKPOINT.unlink(missing_ok=True)
    print(f"\n[pull] REPORT: {REPORT}", file=sys.stderr)
    print(f"[pull] pulled={done_count} failed={failed_count} already={len(already)} unreachable={len(unreachable)} wall={wall}s",
          file=sys.stderr)


if __name__ == "__main__":
    main()
