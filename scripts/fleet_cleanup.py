#!/usr/bin/env python3
"""
fleet_cleanup.py — Clean up stale/broken models from servers.json using each
server's own Ollama API, then write a corrected servers.json.

Passes:
  --discover   Query GET /api/tags on every server. Diff against servers.json.
               Remove v1Models entries that the server doesn't actually have.
               Also remove entries for models that returned permanent errors
               (401 auth required, 404 not found, 500 server error) on a server
               that has other working models.

  --delete-cloud  For servers that have ≥1 working model AND ≥1 model that
               returned 401: call DELETE /api/delete on the cloud model
               directly on the server, then remove from servers.json.

  --apply       Actually write the corrected servers.json (dry-run by default).

Usage:
  python3 fleet_cleanup.py --discover --apply
  python3 fleet_cleanup.py --delete-cloud --apply
  python3 fleet_cleanup.py --discover --delete-cloud --apply
"""
import json, os, sys, time, argparse, urllib.parse
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

ROOT = "/root/project/ollama-orchestrator"
SERVERS_JSON = os.path.join(ROOT, "data", "servers.json")
RESULTS_JSONL = os.path.join(ROOT, "data", "fleet-eval", "results.jsonl")
BACKUP_DIR = os.path.join(ROOT, "data", "servers.json.cleanup.d")
CONNECT_TIMEOUT = 8
API_TIMEOUT = 30
WORKERS = 60

print_lock = __import__("threading").Lock()
def log(msg):
    with print_lock:
        print(msg, flush=True)

def load_results():
    if not os.path.exists(RESULTS_JSONL):
        return {}
    model_errors = defaultdict(set)
    model_available = defaultdict(set)
    for line in open(RESULTS_JSONL):
        if not line.strip():
            continue
        r = json.loads(line)
        si = r["server_idx"]
        m = r["model"]
        if r.get("available"):
            model_available[si].add(m)
        else:
            err = r.get("error", "") or ""
            if any(x in err for x in ["401", "403", "model not found", "404"]):
                model_errors[si].add(m)
    return model_available, model_errors

def discover_server_models(server_url):
    """Query /api/tags to get actual models on this server."""
    url = server_url.rstrip("/") + "/api/tags"
    try:
        r = requests.get(url, timeout=(CONNECT_TIMEOUT, API_TIMEOUT))
        if r.status_code == 200:
            data = r.json()
            return [m["name"] for m in data.get("models", [])]
        return None
    except Exception:
        return None

def delete_model(server_url, model):
    """Call DELETE /api/delete on a specific model."""
    url = server_url.rstrip("/") + "/api/delete"
    try:
        r = requests.request("DELETE", url,
                            json={"name": model},
                            timeout=(CONNECT_TIMEOUT, API_TIMEOUT))
        return r.status_code, r.text[:100]
    except Exception as e:
        return None, str(e)

def do_discover(servers, dry_run=True):
    """Query every server's /api/tags and diff against servers.json."""
    log(f"[discover] Checking {len(servers)} servers...")
    to_remove = defaultdict(list)  # server_idx -> [model, ...]

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futures = {}
        for idx, s in enumerate(servers):
            url = s["url"]
            futures[ex.submit(discover_server_models, url)] = (idx, s)

        for future in as_completed(futures):
            idx, s = futures[future]
            actual = future.result()
            if actual is None:
                continue
            actual_set = set(actual)
            listed = set(s.get("v1Models") or [])
            stale = listed - actual_set
            if stale:
                to_remove[idx].extend(list(stale))

    log(f"[discover] Servers with stale entries: {len(to_remove)}")
    total_stale = sum(len(v) for v in to_remove.values())
    log(f"[discover] Total stale model entries to remove: {total_stale}")

    if dry_run:
        log(f"[discover] DRY RUN — pass --apply to actually write servers.json")

    for idx, models in sorted(to_remove.items()):
        s = servers[idx]
        for m in models:
            action = "REMOVE" if not dry_run else "WOULD REMOVE"
            log(f"  {action}: server={s['url']} model={m}")

    return to_remove

def do_delete_cloud(servers, dry_run=True):
    """For servers with working models + 401 cloud models: delete the cloud model."""
    model_avail, model_errors = load_results()
    log(f"[delete-cloud] Finding servers with working models but 401 cloud models...")

    to_delete = []  # [(server_idx, server_url, model), ...]
    for idx, s in enumerate(servers):
        working = model_avail.get(idx, set())
        errors_401 = set(m for m in model_errors.get(idx, set()))
        if working and errors_401:
            for m in errors_401:
                to_delete.append((idx, s["url"], m))

    log(f"[delete-cloud] Servers with working+401: {len(set(x[0] for x in to_delete))}")
    log(f"[delete-cloud] Total 401 model entries to delete from servers: {len(to_delete)}")

    if dry_run:
        log(f"[delete-cloud] DRY RUN — pass --apply to actually delete + update servers.json")

    deleted_count = 0
    for idx, url, model in to_delete:
        if not dry_run:
            status, resp = delete_model(url, model)
            if status in (200, 204):
                log(f"  DELETED: server={url} model={model}")
                deleted_count += 1
            else:
                log(f"  DELETE FAILED ({status}): server={url} model={model} resp={resp}")
        else:
            log(f"  WOULD DELETE: server={url} model={model}")

    if not dry_run:
        log(f"[delete-cloud] Deleted {deleted_count} models from servers")

    return [(x[0], x[2]) for x in to_delete]  # [(server_idx, model), ...]

def apply_cleanup(servers, discover_removals, cloud_removals):
    """Write corrected servers.json, backing up the original."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = int(time.time())
    backup = os.path.join(BACKUP_DIR, f"servers.json.{ts}")
    json.dump(servers, open(backup, "w"), indent=2)
    log(f"[apply] Backed up original -> {backup}")

    # Build removal map: server_idx -> set of models to remove
    remove_map = defaultdict(set)
    for idx, models in discover_removals.items():
        for m in models:
            remove_map[idx].add(m)
    for idx, model in cloud_removals:
        remove_map[idx].add(model)

    cleaned = []
    for idx, s in enumerate(servers):
        if idx in remove_map:
            bad = remove_map[idx]
            original = s.get("v1Models") or []
            cleaned_models = [m for m in original if m not in bad]
            s = dict(s)
            s["v1Models"] = cleaned_models
            log(f"[apply] Cleaned server {s['url']}: {len(original)} -> {len(cleaned_models)} models ({len(bad)} removed)")
        cleaned.append(s)

    out = os.path.join(ROOT, "data", "servers.json")
    json.dump(cleaned, open(out, "w"), indent=2)
    log(f"[apply] Wrote {out} ({len(cleaned)} servers)")

    # Summary
    total_removed = sum(len(remove_map.get(i, set())) for i in range(len(servers)))
    log(f"[apply] Done. Total model entries removed: {total_removed}")
    log(f"[apply] Servers touched: {len(remove_map)}")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--discover", action="store_true", help="Query /api/tags and remove stale entries")
    ap.add_argument("--delete-cloud", action="store_true", help="DELETE 401 cloud models from servers")
    ap.add_argument("--apply", action="store_true", help="Actually write changes (default is dry-run)")
    ap.add_argument("--workers", type=int, default=WORKERS, help="Concurrent workers")
    args = ap.parse_args()

    if not args.discover and not args.delete_cloud:
        log("Nothing to do. Pass --discover and/or --delete-cloud. Use --help for usage.")
        sys.exit(0)

    servers = json.load(open(SERVERS_JSON))
    WORKERS = args.workers

    discover_removals = {}
    cloud_removals = []

    if args.discover:
        discover_removals = do_discover(servers, dry_run=not args.apply)

    if args.delete_cloud:
        cloud_removals = do_delete_cloud(servers, dry_run=not args.apply)

    if args.apply:
        if not discover_removals and not cloud_removals:
            log("[apply] Nothing to apply.")
        else:
            apply_cleanup(servers, discover_removals, cloud_removals)
    else:
        log("[apply] Dry-run complete. Pass --apply to write changes.")
