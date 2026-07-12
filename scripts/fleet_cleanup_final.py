#!/usr/bin/env python3
"""
fleet_cleanup_final.py — Finalize servers.json cleanup.
Reads evaluation results to identify 401/cloud model entries and stale /api/tags
discrepancies. Backs up original, writes cleaned servers.json.
Safe to re-run: idempotent DELETE calls.
"""
import json, os, time, urllib.parse
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict
import threading

ROOT = "/root/project/ollama-orchestrator"
SERVERS_JSON = os.path.join(ROOT, "data", "servers.json")
RESULTS_JSONL = os.path.join(ROOT, "data", "fleet-eval", "results.jsonl")
BACKUP_DIR = os.path.join(ROOT, "data", "servers.json.cleanup.d")
CONNECT_TIMEOUT = 6
API_TIMEOUT = 20
WORKERS = 25

plock = threading.Lock()
def log(msg):
    with plock:
        print(msg, flush=True)

def load_errors_from_results():
    """From results.jsonl: which (server_idx, model) pairs returned permanent errors."""
    si_errors = defaultdict(set)
    si_avail = defaultdict(set)
    for line in open(RESULTS_JSONL):
        if not line.strip(): continue
        r = json.loads(line)
        si, m = r["server_idx"], r["model"]
        if r.get("available"):
            si_avail[si].add(m)
        else:
            err = r.get("error", "") or ""
            if any(x in err for x in ["401", "403", "404", "model not found"]):
                si_errors[si].add(m)
    return si_avail, si_errors

def get_actual_models(server_url):
    url = server_url.rstrip("/") + "/api/tags"
    try:
        r = requests.get(url, timeout=(CONNECT_TIMEOUT, API_TIMEOUT))
        if r.status_code == 200:
            return [m["name"] for m in r.json().get("models", [])]
        return None
    except Exception:
        return None

def delete_model(server_url, model):
    url = server_url.rstrip("/") + "/api/delete"
    try:
        r = requests.request("DELETE", url, json={"name": model},
                          timeout=(CONNECT_TIMEOUT, API_TIMEOUT))
        return r.status_code in (200, 204), r.status_code, r.text[:80]
    except Exception as e:
        return False, None, str(e)

def main():
    servers = json.load(open(SERVERS_JSON))
    si_avail, si_errors = load_errors_from_results()

    log("[1/3] Discovering stale entries via /api/tags...")
    to_remove = defaultdict(set)

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = {ex.submit(get_actual_models, s["url"]): idx for idx, s in enumerate(servers)}
        done = 0
        for future in as_completed(futures):
            idx = futures[future]
            actual = future.result()
            done += 1
            if done % 100 == 0:
                log(f"  discover progress: {done}/{len(servers)}")
            if actual is None:
                continue
            listed = set(servers[idx].get("v1Models") or [])
            stale = listed - set(actual)
            if stale:
                to_remove[idx].update(stale)

    stale_count = sum(len(v) for v in to_remove.values())
    log(f"  Stale entries to remove: {stale_count} across {len(to_remove)} servers")

    log("[2/3] Identifying 401/cloud models to delete from servers...")
    to_delete = defaultdict(set)
    for idx, s in enumerate(servers):
        good = si_avail.get(idx, set())
        bad = si_errors.get(idx, set())
        if good and bad:
            to_delete[idx].update(bad)

    cloud_total = sum(len(v) for v in to_delete.values())
    log(f"  401/cloud model entries: {cloud_total} across {len(to_delete)} servers")

    log("[3/3] Deleting cloud models from servers...")
    deleted = 0; failed_404 = 0; failed_conn = 0
    delete_tasks = [(idx, servers[idx]["url"], m) for idx, models in to_delete.items() for m in models]

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = {ex.submit(delete_model, url, m): (idx, url, m) for idx, url, m in delete_tasks}
        for future in as_completed(futures):
            idx, url, m = futures[future]
            ok, code, resp = future.result()
            if ok:
                deleted += 1
            elif code == 404:
                failed_404 += 1
            else:
                failed_conn += 1
            if (deleted + failed_404 + failed_conn) % 50 == 0:
                log(f"  delete progress: {deleted+failed_404+failed_conn}/{len(delete_tasks)}")

    log(f"  Deleted: {deleted} | 404(not present): {failed_404} | failed: {failed_conn}")

    # --- Write cleaned servers.json ---
    ts = int(time.time())
    os.makedirs(BACKUP_DIR, exist_ok=True)
    backup = os.path.join(BACKUP_DIR, f"servers.json.{ts}")
    json.dump(servers, open(backup, "w"), indent=2)
    log(f"  Backed up: {backup}")

    cleaned = []
    for idx, s in enumerate(servers):
        s = dict(s)
        bad = to_remove.get(idx, set()) | to_delete.get(idx, set())
        if bad:
            s["v1Models"] = [m for m in (s.get("v1Models") or []) if m not in bad]
        cleaned.append(s)

    out = os.path.join(ROOT, "data", "servers.json")
    json.dump(cleaned, open(out, "w"), indent=2)

    old_pairs = sum(len(s.get("v1Models") or []) for s in servers)
    new_pairs = sum(len(s.get("v1Models") or []) for s in cleaned)
    log(f"  Wrote: {out}")
    log(f"  Before: {len(servers)} servers, {old_pairs} model entries")
    log(f"  After:  {len(cleaned)} servers, {new_pairs} model entries")
    log(f"  Removed: {old_pairs - new_pairs} model entries")
    log("DONE")

if __name__ == "__main__":
    main()
