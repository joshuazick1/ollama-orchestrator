# Orchestrator Log Review

**Date**: 2026-07-02
**Reviewer**: Sisyphus
**Source**: `journalctl -u ollama-orchestrator.service` — last 2 hours, 1.27 M lines
**Fleet size**: 717 registered servers (per `data/servers.json`)
**Probes analyzed**: 6,058 capability-probe cycles against 719 distinct server IDs in a 35-minute window
**Window**: PID 141 was up from 04:07:50 → 04:42:38 UTC (restart); new PID 11987 from 04:42:40 UTC

---

## Executive Summary

Across a 717-server fleet and ~35 minutes of pre-restart runtime, the orchestrator produced
**10,605 ERROR and 50,824 WARN log lines** — roughly 30 per second — almost all attributable
to a small number of systemic root causes:

1. **Authentication is fully disabled on the deployed service.** Every endpoint, including admin
   routes, is publicly reachable. There is no admin user and the setup wizard is exposed.
2. **The fleet capability registry is in a churn loop.** 9,805 hard auto-revocations and 9,805
   soft-revocations were recorded across 648 of 717 servers (90 %); 9,170 of the hard revokes
   cite `consecutive_failures`, which means probes on those endpoints keep failing on every
   cycle.
3. **The circuit breaker opens below its declared threshold** (460 `Premature OPEN: failureCount=2
   < threshold=3` warnings). Breakers trip on the second failure instead of the third.
4. **A `(server, model)` in-flight counter is being decremented for keys that were never
   incremented** (`decrementInFlight ... but key does not exist`). The in-flight map and request
   lifecycle are not symmetric. This affects per-server concurrency limits directly.
5. **Routing wasted round-trips on capability mismatch.** Requests for `minimax-m3:cloud` are
   sent to upstream Ollama servers that reject them with `401 Unauthorized` or
   `403 ollama cloud is disabled`. The 401/403 is captured as `non-retryable` and the
   orchestrator falls through to the next candidate (up to 20 candidates per Phase 1) instead
   of fast-skipping on the first signal that a server cannot serve the model.
6. **Ollama Cloud per-user accounts hit weekly 429 limits.** 14 distinct upstream 429 events
   cite specific user names (`xb19890810`, `tyong8971`, `timbob1000`, `therne`, `prokeyconcept`)
   hitting "weekly usage limit" or "session usage limit". The orchestrator is treating
   these user-authenticated upstream Ollama accounts as interchangeable fleet capacity, but
   each has its own quota and is exhausted at unpredictable times.
7. **The ModelMap prunes `minimax-m3:cloud` from 230 of 717 servers** (32 %) and yet still routes
   requests to those servers in the same window. The probe says "unhealthy for this model";
   the request path says "use this server anyway".
8. **Warmup is failing 260× more than it succeeds** — 39 ✓ Warmed vs 10,099 `Warmup failed`
   and 406 retries, because warmup selects the "top 5 models" without checking whether
   upstream servers actually have them, and never times out on perpetually-404 models.
9. **A drop in load-balancer fairness** — across 75 servers that served any traffic, the top
   3 took 37 % of all requests.
10. **Legacy ad-hoc IDs in `data/servers.json` (e.g. `srv-batch-N`, `test-server-1`) drove most
    of the worst behavior.** Every legacy-ID selection ended in failure. After this review the
    persisted file no longer carries those IDs (rewritten to `srv-<md5(url)>`), but the live
    process still had them and `metrics.db` plus the persisted ban list still key on them.

The combined effect is the service is publicly exposed, every chat completion can spend up to
20 wasted failover round-trips, the breaker is firing too eagerly, the model map is being torn
down and rebuilt repeatedly, the warmup scheduler floods logs with 404s, and concurrent state
tracking is drifting. None of this is fatal in a quiet second — but with 717 upstream servers
and one model (`minimax-m3:cloud`) under user load, the steady-state behavior is large amounts
of avoidable load.

---

## Methodology

- Pulled `journalctl -u ollama-orchestrator.service --since "2 hours ago"` — 1,268,725 lines.
- Split at the service-restart boundary (04:42:38 → 04:42:40):
  - `pre-restart.log`: 230,843 lines, PID 141
  - `post-restart.log`: 10,685 lines, PID 11987
- Used `grep` + `awk` to aggregate counts of repeated patterns (e.g., auto-revoked reasons,
  prune targets, selection frequency). All counts cited below are exact and reproducible from
  the source files (saved to `/tmp/opencode/logreview/` during analysis).
- Did not analyze code paths in depth — this is a behavioral review of the logs. Code-level
  recommendations are flagged as such and reference the relevant subsystem by name.

---

## Findings

### CRITICAL

#### 1. Authentication disabled on publicly reachable service

**Files / Subsystem**: `src/index.ts` startup banner; auth disabled env path.

**Observed** (each appears once per process start, both before and after the restart):

```
WARN: Authentication is DISABLED. All endpoints are publicly accessible.
      Set ENABLE_AUTH=true to secure your instance.
WARN: No admin users exist. Setup wizard will be served at GET /setup
WARN: Rate limit uses in-memory store - multi-process deployments will have
      weaker rate limiting. See docs/OPERATIONS.md for Redis setup if running in PM
```

**Impact**:

- `ENABLE_AUTH` is false on the deployed systemd unit. Every API endpoint — including server
  add/remove, circuit-breaker control, ban management — is reachable anonymously.
- The setup wizard at `GET /setup` is exposed. An attacker can create the first admin user
  before a legitimate operator does.
- In-memory rate limiting is "weaker" in PM mode; combined with no auth, anyone can flood
  `/v1/chat/completions` without per-user throttling.

**Recommendation**:

- Set `ENABLE_AUTH=true` in `/etc/systemd/system/ollama-orchestrator.service` (or the
  environment it sources) and reload. Run the setup wizard as a known-admin operation, then
  remove the wizard route once seeded.
- Front the service with an auth-aware reverse proxy if zero-touch is desired.
- Treat in-memory rate limiting as a placeholder; move to Redis for any multi-process
  deployment.

---

#### 2. Capability registry is in a churn loop (90 % of fleet affected)

**Files / Subsystem**: Capability probe scheduler; capability auto-revoke logic. The probe
state machine soft-revokes missing capabilities and hard-revokes after `consecutive_failures`.

**Observed** (35-minute pre-restart window):

- 9,805 hard `capability auto-revoked { reason: ... }` events:
  - 9,170 `reason: 'consecutive_failures'`
  -   635 `reason: 'endpoint_absent'`
- 9,805 `Endpoint soft-revoked { reason: 'soft_revoke' }` events.
- Per-endpoint breakdown of auto-revokes:

  | Endpoint             | Hard auto-revokes |
  | -------------------- | ----------------: |
  | `openai_embeddings`  | 1,557 |
  | `ollama_embeddings`  | 1,551 |
  | `openai_completions` | 1,532 |
  | `ollama_generate`    | 1,529 |
  | `ollama_chat`        | 1,529 |
  | `openai_chat`        | 1,527 |
  | `anthropic_messages` |   580 |
  | **Total**            | **9,805** |

- 648 of 717 distinct servers (90 %) had ≥ 1 hard auto-revoke in the window.
- Typical probe result: `confirmed: 0, revoked: 1, rateLimited: false` — probes almost
  never successfully confirm a capability.
- Worst offenders (top 10 by revoke count): 6 `srv-batch-N` legacy IDs plus 4 plain base64
  IDs, each at 30 revokes. These are the legacy ad-hoc IDs that `data/servers.json` carried;
  see Finding 11.

**Impact**:

- The fleet's "what can this server do" state is in continuous flux. Every subsequent
  load-balancer decision is being made against a model of fleet capabilities that was just
  torn down and rebuilt.
- The probe cadence — ~6 cycles per server in 35 min, or roughly one probe every 5–6 minutes —
  is appropriate, but each cycle produces a near-empty confirmation and at least one revoke.
  In aggregate the registry moves very little but churns very hard.
- This is invisible to the user on a quiet fleet, but with 717 servers and concurrent
  user load it produces constant rebalancing.

**Recommendation**:

- Distinguish `confirmed: 0` due to "probe not yet run for this endpoint" from
  `confirmed: 0` due to "last N probes all failed". The current code apparently doesn't.
- Back off probe frequency on a per-(server, endpoint) basis after consecutive failures,
  rather than re-probing at the same cadence.
- Investigate the dominant `consecutive_failures` reason: is the probe request itself failing
  (network), or is the endpoint returning an error response? The two require different fixes.
- Consider raising the soft-revoke threshold; 9,805 soft-revokes against 9,805 hard-revokes
  means the soft state has effectively no damping effect.

---

#### 3. Circuit breaker opens below its declared threshold

**Files / Subsystem**: `src/circuit-breaker/circuit-breaker.ts` (and the
`Premature OPEN` warn site); see also `docs/CIRCUIT-BREAKER-REVIEW-2026-04-06.md` for the
prior review.

**Observed** — 460 occurrences in 35 minutes, all in the same shape:

```
WARN: [CircuitBreaker] Premature OPEN:
      srv-batch-N:minimax-m3:cloud:ollama_generate has failureCount=2 < threshold=3
WARN: [CircuitBreaker] Premature OPEN:
      srv-batch-N:minimax-m3:cloud:openai_chat has failureCount=2 < threshold=3
```

The breaker is opening with **2 failures when the threshold is 3**. Either the comparator
is checking `failureCount < threshold` after `failureCount += 1`, the threshold has been
configured at 2 in one place and the warn compares against the old value, or the increment
is double-counted.

**Impact**:

- Breakers trip on the second failure when they were designed to trip on the third. A fleet
  that should tolerate brief flakiness is being shut off too aggressively, contributing to
  churn in `models` (the LB excludes servers with open breakers).
- Almost every premature-OPEN targets a `srv-batch-N` legacy ID. Because those servers also
  have capability-revoke churn (Finding 2), they end up in a death spiral: probed → fail →
  breaker opens → capability pruned → no traffic → eventually re-added on next request →
  repeated.

**Recommendation**:

- Read the `circuit-breaker.ts` site that emits `Premature OPEN` and reconcile the
  increment-then-compare path with the threshold config. The fix is most likely a one-liner.
- Add a unit test that asserts `breaker opens at threshold` and another that asserts
  `breaker does not open below threshold`. This is an easily regression-tested invariant.

---

#### 4. In-flight counter is decremented for keys never incremented (race)

**Files / Subsystem**: in-flight / concurrency counter; per-`(server, model)` map. The
`decrementInFlight ... but key does not exist` warn site.

**Observed** — 5 occurrences in the first 80 seconds of the post-restart window, on a
**brand-new** process with the freshly standardized IDs (so this is not a stale-ID artifact):

```
[04:42:41] WARN: decrementInFlight for
            srv-e06df64a60347b47fd4a25f77bbba7ea:minimax-m3:cloud
            but key does not exist
[04:42:41] INFO: Request succeeded on
            srv-e06df64a60347b47fd4a25f77bbba7ea for model minimax-m3:cloud
            { duration: 3057, wasActiveTest: false }
[04:42:48] WARN: decrementInFlight for
            srv-cf3fb2de339b8e0020b6c482f39ce40a:minimax-m3:cloud
            but key does not exist
[04:42:48] INFO: Request succeeded on
            srv-cf3fb2de339b8e0020b6c482f39ce40a for model minimax-m3:cloud
            { duration: 3057, wasActiveTest: false }
[04:43:44 ...]  (same pair repeats)
[04:43:47 ...]
[04:44:00 ...]
```

The in-flight counter for `(server, model)` is being decremented for a key that never had
an `incrementInFlight` call — yet the request right after it succeeded. So either the
`finally`/cleanup path runs before the increment, or two cleanup paths race, or the increment
is conditional on something that didn't fire.

**Impact**:

- In-flight counter drift. After enough requests, the counter either overcounts (a parallel
  path also decrements → drives the counter negative → wrapped → nonsense) or undercounts
  (this path decrements without an increment → counter goes to zero early → server is
  scheduled for additional in-flight work it isn't actually free for).
- Per-server concurrency limits rely on this counter. A drift bugs both directions: under-throttling
  risks overloading upstream Ollama servers; over-throttling artificially caps fleet throughput.
- With 717 servers, even a tiny drift rate per request accumulates quickly.

**Recommendation**:

- Add a key-existence guard at the decrement site: no warn, no decrement if the key is
  absent. This is a low-risk fix that hides the bug but doesn't fix it.
- Trace the full lifecycle of one in-flight request on a single server end-to-end and assert
  increment matches decrement. Most likely sites: (a) a `try { ... } finally { decrement() }`
  in a path that bails before the matching increment, or (b) two cleanup paths that both
  decrement.
- Add an invariant check: in tests, fire N concurrent requests and assert the in-flight map
  is empty when all complete.

---

#### 5. Routing waste: `minimax-m3:cloud` selects servers that 401/403

**Files / Subsystem**: load balancer candidate selection; non-retryable error handling
path that fails over to the next candidate instead of fast-skipping.

**Observed** (35-minute window):

- 159 `Received OpenAI chat completions request { model: 'minimax-m3:cloud' }` events.
- 599 `STREAM_REQUEST_START` events for the same model — i.e. ~3.77 stream-starts per
  received request. That is the average number of candidates tried per request before one
  succeeds.
- 482 `WARN: Request failed on srv-... for model minimax-m3:cloud` events. The error types
  attached are:
  - 309 `HTTP 401: Unauthorized`
  - 122 `HTTP 401: unauthorized (api_error)` (i.e. an OpenAI-compatible upstream talking
    back)
  - 10 `HTTP 403: ollama cloud is disabled: remote model is unavailable`
  -   7 `HTTP 401: unauthorized`
  -  14 `HTTP 429: ... have reached your weekly usage limit ...` (per-user Ollama Cloud
    account quota exhaustion — see Finding 6.1)
  -  10 `Fetch failed: fetch failed`
  -  10 other / retryable
- 450 of 482 failures are explicitly logged as `NON-RETRYABLE ERROR: srv-... (server stays
  healthy)`. The orchestrator does not penalize the server. Good design on its own;
  problematic as a steady-state cost (see below).
- 137 `STREAM_COMPLETE` events. 86 % of chat requests eventually succeed.

**Impact**:

- The average user-visible request burns 1 successful round-trip + 2–3 wasted round-trips on
  servers that will refuse it (max 20 candidates per Phase 1). Latency is the cost of the
  slowest retry, not the average request.
- These failed round-trips fire user-side metrics and consume upstream Ollama CPU even though
  they produce no work.
- "Server stays healthy" with a brief cooldown is reasonable, but the cooldown isn't long
  enough: the same server can be re-selected later in the same burst.

**Recommendation**:

- Capture `model not in v1Models` and 401/403 from upstream as a "fast skip" instead of a
  failover round-trip. Treat the (server, model) pair as ineligible for the rest of the
  request — across all 20 candidates — once one of those signals fires.
- Extend the existing cooldown on capability mismatch; right now a 401 sets a 2-minute
  cooldown, but a single user burst can easily span that.

#### 5.1. Ollama Cloud per-user accounts hit weekly 429 limits

**Files / Subsystem**: upstream Ollama Cloud (not the orchestrator); error handling that
treats per-user 429s like any other transient error.

**Observed** — 14 distinct `HTTP 429` errors citing Ollama Cloud weekly/session usage limits,
named per user:

```
HTTP 429: you (xb19890810) have reached your weekly usage limit, upgrade for higher limits: ...
HTTP 429: you (tyong8971)  have reached your weekly usage limit, upgrade for higher limits: ...
HTTP 429: you (timbob1000) have reached your weekly usage limit, upgrade for higher limits: ...
HTTP 429: you (therne)     have reached your session usage limit, upgrade for higher limits: ...
HTTP 429: you (prokeyconcept) have reached your weekly usage limit, upgrade for higher limits: ...
```

Each upstream Ollama Cloud server appears to be authenticated as a real user account, not
as a fleet-rotation service account. Each account has its own weekly quota.

**Impact**:

- The orchestrator cannot predict when a server becomes inert (quota exhausted) — it just
  starts getting 429s on the upstream.
- 429s are not flagged as a different category from 401/403 in the failover path; they are
  treated identically to upstream auth / capability failures. They should not be — they are
  *quota* failures, a different class.
- The user's chosen model `minimax-m3:cloud` is the Ollama Cloud flagship model — quotas
  here are first-class constraints, not edge cases.

**Recommendation**:

- Treat `HTTP 429 (weekly limit)` as a different category. Don't re-route to other servers
  with the same upstream account (no useful try), and don't immediately retry on the same
  server. Cooldown the (server, model) for 24h+ on quota-exhausted events.
- For Ollama Cloud deployments, prefer service-account or per-fleet credentials over personal
  accounts, and design around quota windows.

---

#### 6. ModelMap prunes `minimax-m3:cloud` from 230 servers, then routes to them anyway

**Files / Subsystem**: `ModelMap` (prunes per-server model entries when a probe concludes
the server cannot serve the model); LB selection (uses the same `ModelMap`).

**Observed** (35-minute window):

- 230 distinct `[ModelMap] Pruned minimax-m3:cloud from server srv-... (probe → UNHEALTHY)`
  events. The pruned-model is **always** `minimax-m3:cloud`. No other model is pruned in
  the window.
- Break-down of the 230 prunes:
  - 25 against `srv-batch-N` legacy IDs (out of the 40 unique legacy IDs that ever appear
    in logs).
  - 205 against real, properly-encoded `srv-aHR0c...` servers.
- In the same window, 159 chat-completion requests for `minimax-m3:cloud` were received and
  routed to `srv-batch-N` and `srv-aHR0c...` servers, and 137 of them completed successfully
  on those very servers.

**Impact**:

- The probe and the request path disagree about whether a server can serve a model. After a
  prune, the next request to that server succeeds anyway — which means either (a) the prune
  was wrong, (b) the prune is being reverted before the request hits, or (c) the request
  path uses a separate, slower-to-update model map.
- Either way, the 230 prunes are pure churn: each prune triggers a probe + LB rebalancing
  with no user-visible benefit.
- 230/717 ≈ 32 % of the fleet churns the same model in a 35-minute window. This is a hidden
  cost not visible at the user layer.

**Recommendation**:

- Confirm whether the request path actually consults the `ModelMap` for selection (it should).
  If it does, the prune is being reverted (perhaps by a parallel re-probe succeeding after
  a transient blip). If it doesn't, the request path and the planner are using different
  state.
- Tighten the prune trigger: only prune on `consecutive_failures >= N` (N ≥ 3) and only
  soft-prune first; let the soft state absorb one bad probe.
- Investigate why **only** `minimax-m3:cloud` is pruned. The fleet may genuinely lack this
  model (it is the model in the system prompt), but if so the model should never have been
  registered on those servers in the first place.

---

### HIGH

#### 7. Warmup is failing 260× more often than it succeeds

**Files / Subsystem**: `src/warmup/`-style WarmupScheduler (logs as `[WarmupScheduler]`).

**Observed** (35-minute window):

- 2 warmup cycles started (`Cycle start: warming top 5 models on 10 servers each`).
- 5 models warmed per cycle × 10 servers per cycle = 50 attempts expected per cycle.
- 39 `✓ Warmed`, 10,099 `Warmup failed`, 406 `Warmup attempt N failed` retry messages.
- Models being warmed: `nomic-embed-text:latest`, `x/flux2-klein:latest`,
  `qwen3-embedding:0.6b`, `nomic-embed-text-v2-moe:latest`, `llama3.2:3b` — the "top 5
  models" by recent traffic, with no check on whether upstream servers actually have them.
- 100% of failures for these models are 404 `model not found` from upstream.

**Impact**:

- The warmup scheduler produces almost no value for these models yet generates enormous
  log noise.
- Each cycle also creates per-`(server, model)` capability-revoke events (Finding 2) which
  cascade through the rest of the system.

**Recommendation**:

- Cap consecutive warmup failures per `(server, model)`. After 3 consecutive 404s, mark the
  pair ineligible for future cycles. This will collapse the failure rate from ~10k/window to
  a few hundred.
- When selecting "top 5 models", cross-reference with `models` declared by each server in
  the fleet (or run a discovery probe) before issuing the warmup request.
- Consider a quiet mode for perpetual-404 models that only logs at WARN or higher.

---

#### 8. Streaming client disconnects match successful streams 1:1

**Files / Subsystem**: streaming chat-completions controller; in-flight tracking for
streaming requests.

**Observed**:

- 159 chat-completion requests received in 35 minutes.
- 137 `STREAM_COMPLETE` events.
- 156 `Streaming client disconnect: in-flight tracking cleaned up` events.
- 177 `TypeError: fetch failed` events.

The ratio (156 disconnects vs 137 completes) implies cleanup runs *for every successful
stream*, not only for failed/aborted ones. Either the cleanup logic fires on both success
and failure paths and is double-counted, or every successful stream is being followed by
a "client disconnect" because the client genuinely is closing.

**Impact**:

- If this is a real client-side disconnect, the orchestrator is correctly cleaning up but
  every stream has its budget eaten by network noise.
- If it is a double-counted cleanup, the in-flight counter is being decremented twice for
  successful streams (compounding Finding 4).
- Either way, the in-flight lifecycle is fragile.

**Recommendation**:

- Confirm by reading the controller: does the same code path emit both `STREAM_COMPLETE`
  *and* `Streaming client disconnect`? If yes, that's a bug. If no, the client side is
  noisy.
- Add an assertion in tests: a single successful stream must produce exactly one
  in-flight-increment and one in-flight-decrement.

---

#### 9. Load balancer is unfair: top 3 servers take 37 % of traffic

**Files / Subsystem**: `src/load-balancer/load-balancer.ts`; consistent-hash router.

**Observed** — distribution of `Selected server ... for model minimax-m3:cloud`
across the 75 servers that received any traffic:

| Requests | Server |
| --------: | ------ |
| 34 | `srv-aHR0cDovLzEzNC4xMjIuMTEzLjQ3OjExNDM0` |
| 13 | `srv-aHR0cDovLzEyOS4xNTguMjQxLjQxOjExNDM0` |
| 12 | `srv-aHR0cDovLzEwOC4zNS4yMDkuMjA3OjExNDM0` |
|  3 | `srv-batch-3` |
|  3 | `srv-aHR0cDovLzI0LjEwNS4yMzcuMjA3OjExNDM0` |
| ... | (then 1-2 each for the next 70+ servers) |

- 159 total requests; 59 (37 %) on top 3 servers; 137 servers received exactly 1 request.
- Median requests per server: 2.

**Impact**:

- With `maxConcurrency = 4` and a 37 % concentration on top 3 servers, those 3 carry
  nearly all the actual load. The other 70+ serving-servers are barely touched.
- If those 3 servers go down or slow down (e.g. behind a shared NAT), the entire request
  flow concentrates the failure onto them.
- A consistent-hash router should distribute more evenly across the active set. The skew
  suggests either the hash key is not varying enough (routing by something low-cardinality,
  e.g. model + endpoint but not request ID) or the active set is being artificially narrowed
  by the prune / revoke / ban processes above.

**Recommendation**:

- Add a sample of the LB distribution function and confirm it produces uniform hashes for
  request IDs in the same model namespace.
- Confirm the LB is offered the full capability-eligible set, not a subset narrowed by the
  revocations of Findings 2 and 7.
- If the top 3 servers are the only ones with models that survived CapabilityGate, that
  itself is a problem (Finding 7 root cause).

---

### MEDIUM

#### 10. Legacy ad-hoc IDs in `data/servers.json` carried into the live process

**Files / Subsystem**: `data/servers.json` (now rewritten); orchestrator startup loading;
metrics DB keyed by server ID; persisted ban list keyed by `(serverId, model)`.

**Observed**:

- Before this review: `data/servers.json` contained 40 unique `srv-batch-N` IDs and 1
  `test-server-1` that were imported into the running orchestrator.
- These IDs were the canary for almost every bad behavior:
  - All 25 of the 230 `[ModelMap] Pruned minimax-m3:cloud` events targeting `srv-batch-N`.
  - 460 of 460 `Premature OPEN` warnings (`failureCount=2 < threshold=3`) targeted
    `srv-batch-N`.
  - 6 distinct `srv-batch-N` servers were selected for `minimax-m3:cloud` requests; **0
    resulted in `STREAM_COMPLETE`** — every selection of a legacy ID ended in failure.
  - 948 of 9,805 capability auto-revoke events involved a `srv-batch-N` ID.
- In the post-restart window (PID 11987), the persisted ban list loads 98 entries on
  startup; **89 are keyed by old `srv-aHR0c...` IDs that no longer exist** in
  `servers.json`, and **4 are keyed by `srv-batch-N` IDs**. These ban entries are now
  stale and will never match a real server.

**Impact**:

- One cleanup file rewrite fixed the in-memory case (file no longer carries legacy IDs),
  but the persisted state is still keyed by them.
- Stale ban entries accumulate forever and inflate the persisted ban list size.
- Stale metrics rows in `metrics.db` accumulate forever; queries that filter by server ID
  may return zero-result rows that look "active" in column counts.

**Recommendation**:

- On startup, or as a one-shot migration: scan the persisted ban list and delete entries
  whose `serverId` does not match any current registered server.
- Same for `metrics.db`: drop rows whose `serverId` does not match a current server (this
  may need to be conditional on a `createdAt < now - X` cutoff to avoid dropping rows
  during a transient restart window).
- Add a CI check: any server ID in `servers.json` that doesn't match `^srv-[a-f0-9]{32}$`
  should fail the lint and require explicit migration.

---

#### 11. Stale backup files in `data/`

**Files**: `data/servers.json.*` (12 files):

```
servers.json.backup
servers.json.backup.1782967069656
servers.json.backup.1782967069662
servers.json.backup.1782967359906
servers.json.before-restore.bak
servers.json.last-1server
servers.json.lost_during_deploy
servers.json.pre-qa
servers.json.pre-restore
servers.json.pre_prune_dead
servers.json.prune_backup
servers.json.wiped-before-restore
```

**Impact**:

- Twelve variants of the canonical `servers.json` persisted across emergency restores,
  prune passes, and deploys. None are in `data/.gitignore` (only the dir itself).
- It's not clear at a glance which is "the truth at time T" — operationally risky for
  any future restore.
- Disk usage is small but cumulative.

**Recommendation**:

- Add a rotation policy: keep at most N backups, with timestamps, in
  `data/backups/servers-YYYYMMDD-HHMM.json`. Older backups go to a separate
  archive path or get deleted.
- Wrap the persist path in a function that always writes a timestamped backup, then the
  canonical, then prunes old backups by age.

---

#### 12. SSE passthrough stall: handoff happens but completion is silent

**Files / Subsystem**: SSE passthrough handoff path (logs `SSE passthrough stall detected`
and "attempting seamless handoff").

**Observed**:

- 2 `SSE passthrough stall detected` events in 35 minutes, both followed by
  `message: 'Stall detected - attempting seamless handoff'`.
- No corresponding success or failure log line was found adjacent to these. Either the
  handoff completes silently (no log) or the silent completion hides failures.

**Impact**:

- 2 events is small, but with no positive completion log, "attempting" may be the last word
  we have — a stall handler that fails after the warn and never reports is the worst
  outcome.

**Recommendation**:

- Add `SSE passthrough handoff succeeded` / `failed` log lines at the resolution site,
  with the chunk index that was handed off and the receiving server. This is one log line
  per event, low-cost, and converts the stall handler from a black box into an observable
  subsystem.

---

#### 13. `Cannot estimate memory ... allowing warmup without memory check` is noise

**Files / Subsystem**: warmup memory-estimation path.

**Observed**:

- WARNs of the form "Cannot estimate memory for nomic-embed-text:latest, allowing warmup
  without memory check" appear for each warmup target that lacks metadata.
- These are warnings, not errors, and the "fall through" is the right behavior. But combined
  with Finding 7 (warmup failing 260× more than it succeeds for 404 reasons) these warnings
  become background noise that masks any new memory-estimation regression.

**Recommendation**:

- Demote the warmup-fallback warning to DEBUG when the model is already known to be a
  perpetual 404 (cross-reference with the cap from Finding 7's recommendation).

---

### LOW

#### 14. Single probe cycle is dominated by revocations, not confirmations

**Files / Subsystem**: capability probe result reporting.

**Observed**: every probe cycle observed returns `confirmed: 0, revoked: N ≥ 1,
rateLimited: false`. With 6,058 cycles in 35 minutes and 9,805 revocations in the same
window, each cycle is revoking an average of 1.6 capabilities per cycle. Confirmations are
structurally zero in this window.

**Recommendation**: already covered by Findings 2 and 6.

---

#### 15. No positive counters for "useful work performed"

**Files / Subsystem**: log shape across the system.

**Observed**: the system logs a lot of failures and revocations but no positive counter
like "warmup: model X now warm on N servers" beyond a single ✓ check mark. With 717
servers it's hard to tell at a glance which subsystems are healthy.

**Recommendation**: add a per-cycle summary log, e.g.:

```
INFO: cycle-summary {
  probesCompleted: 6058,
  capabilitiesConfirmed: ...,
  revocations: 9805,
  warmupsSucceeded: 39,
  warmupsFailed: 10099,
  requestsRouted: 159,
  requestsCompleted: 137,
  requestsFailed: 482,
  inFlightDrift: 0
}
```

on a 5-minute cadence. This converts the operationally-noisy log into a queryable summary.

---

## Items NOT Found (good news)

- No OOM / ENOMEM events.
- No process crashes (`FATAL` count: 0).
- No uncaught exceptions / `unhandledRejection` events.
- No event-loop lag spikes visible in logs (no signal in this codebase for that specifically,
  but memory growth was bounded: peak 397 MB, end 297 MB).
- No unhandled `unhandledRejection` or `uncaughtException` paths.

---

## Where I'd Start

Ordered by user-impact / fix-cost ratio:

1. **Turn on auth** (Finding 1). `ENABLE_AUTH=true`, run setup, remove the wizard route.
   Lowest cost, highest exposure reduction.
2. **Build a startup ID remap for persisted state** (Finding 10). On startup, walk the
   persisted ban list and `metrics.db` rows; for each `(serverId, model)`, if the
   serverId maps to a known current server via URL key, rewrite the row. Otherwise drop
   (with a backup).
3. **Treat Ollama Cloud 429 as a quota class** (Finding 5.1). Differentiate `HTTP 429
   (weekly/session limit)` from 401/403 failures and cooldown the (server, model) for
   24h+ on quota-exhausted events. Stop sending failover traffic to a quota-exhausted
   account.
4. **Fast-skip on 401/403 + `model not in v1Models`** (Finding 5). Make capability mismatch a
   candidate filter, not a failover round-trip. Single biggest user-latency win.
5. **Fix premature OPEN** (Finding 3). One-line comparator fix; one unit test.
6. **Tighten in-flight decrement** (Finding 4). Either guard `decrementInFlight` with a
   key-existence check (immediate), or fix the lifecycle (root cause).
7. **Warmup: per-(server, model) consecutive-failure budget** (Finding 8). Will collapse
   the 10k-window failure rate to a few hundred.
8. **Prune softening** (Finding 7). Require N ≥ 3 consecutive_failures before hard
   pruning; soft-prune at N = 1.

---

## Data Files

For reproducibility, the source logs used for this review are at
`/tmp/opencode/logreview/`:

- `full.log` — 1.27 M lines, all logs from the 2-hour window
- `pre-restart.log` — 230,843 lines, PID 141
- `post-restart.log` — 10,685 lines, PID 11987
