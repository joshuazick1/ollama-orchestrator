#!/usr/bin/env node
// Fleet-wide concurrency calibration harness.
//
//   --model NAME              model name           default: smollm2:135m
//   --host ID-OR-URL          pin a single server (legacy single-host mode)
//   --fleet                   fleet-wide mode (default if --host is omitted)
//   --steps 1,2,4,8,12,16     concurrency steps    default: 1,2,4,8,12,16
//   --reps N                  requests per slot per step (total = step * reps)
//   --target-p95-ms N         knee threshold       default: 3000
//   --url URL                 orchestrator base    default: http://localhost:5100
//   --prompt TEXT             prompt to send       default: same as smollm2-storm
//   --max-tokens N            num_predict          default: 32
//   --timeout-ms N            per-request timeout  default: 30000
//   --report-dir PATH         output dir           default: .sisyphus/reports
//
// In fleet mode (default): discover healthy hosts via orchestrator /api/orchestrator/servers
// then probe each backend's /api/tags to filter for servers hosting the model.
// In single-host mode (legacy, --host URL|ID): pin a single server (used when
// --host is passed); everything still flows through the orchestrator's
// /api/generate so we exercise the same routing path.

import { promises as fs } from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';

const DEFAULT_STEPS = [1, 2, 4, 8, 12, 16];
const DEFAULT_PROMPT = 'Write one short sentence about the moon.';

function parseArgs(argv) {
  const args = {
    url: 'http://localhost:5100',
    model: 'smollm2:135m',
    host: null, // legacy single-host (URL or server id)
    fleet: true,
    steps: DEFAULT_STEPS.slice(),
    reps: 3,
    targetP95Ms: 3000,
    prompt: DEFAULT_PROMPT,
    maxTokens: 32,
    timeoutMs: 30_000,
    reportDir: '.sisyphus/reports',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--url': args.url = next(); break;
      case '--model': args.model = next(); break;
      case '--host': args.host = next(); args.fleet = false; break;
      case '--fleet': args.fleet = true; break;
      case '--steps': args.steps = parseSteps(next()); break;
      case '--reps': args.reps = parseInt(next(), 10); break;
      case '--target-p95-ms': args.targetP95Ms = parseInt(next(), 10); break;
      case '--prompt': args.prompt = next(); break;
      case '--max-tokens': args.maxTokens = parseInt(next(), 10); break;
      case '--timeout-ms': args.timeoutMs = parseInt(next(), 10); break;
      case '--report-dir': args.reportDir = next(); break;
      case '--help':
      case '-h':
        console.log(
          'Usage: node scripts/bench-concurrency.js [options]\n' +
          '  --model NAME              model name (default: smollm2:135m)\n' +
          '  --host ID-OR-URL          pin a single server (legacy single-host mode)\n' +
          '  --fleet                   fleet-wide mode (default)\n' +
          '  --steps 1,2,4,8,12,16     concurrency steps (default: 1,2,4,8,12,16)\n' +
          '  --reps N                  requests per slot per step (default: 3)\n' +
          '  --target-p95-ms N         knee threshold ms (default: 3000)\n' +
          '  --url URL                 orchestrator base (default: http://localhost:5100)\n' +
          '  --prompt TEXT             prompt text\n' +
          '  --max-tokens N            num_predict (default: 32)\n' +
          '  --timeout-ms N            per-request timeout ms (default: 30000)\n' +
          '  --report-dir PATH         output dir (default: .sisyphus/reports)'
        );
        process.exit(0);
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
    }
  }
  return args;
}

function parseSteps(raw) {
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function round(n) {
  return Math.round(n * 100) / 100;
}

async function fetchJson(url, { timeoutMs = 5000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('client-timeout')), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ac.signal,
    });
    const text = await res.text();
    let parsed = null;
    let parseErr = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (e) {
      parseErr = e.message;
    }
    return { ok: res.ok, status: res.status, body: parsed, parseErr };
  } finally {
    clearTimeout(timer);
  }
}

async function probeBackendTags(hostUrl, model, timeoutMs) {
  const { ok, status, body, parseErr } = await fetchJson(
    `${hostUrl.replace(/\/$/, '')}/api/tags`,
    { timeoutMs }
  );
  if (!ok) return { ok: false, hasModel: false, status };
  if (parseErr || !body) return { ok: false, hasModel: false, status, parseErr };
  const names = (body.models || []).map((m => m && m.name)).filter(Boolean);
  return { ok: true, hasModel: names.includes(model), models: names, status: 200 };
}

async function discoverFleet({ orchestratorUrl, model, timeoutMs }) {
  const { ok, status, body } = await fetchJson(
    `${orchestratorUrl.replace(/\/$/, '')}/api/orchestrator/servers`,
    { timeoutMs }
  );
  if (!ok) {
    return {
      ok: false,
      status,
      error: `orchestrator /api/orchestrator/servers returned HTTP ${status}`,
      servers: [],
    };
  }
  const list = Array.isArray(body) ? body : Array.isArray(body?.servers) ? body.servers : [];
  return { ok: true, status: 200, servers: list };
}

// Best-effort extraction of which backend handled a request. The orchestrator
// currently does not expose per-request server-id in response headers, so this
// always returns null and per-server breakdown is reported as "unavailable".
function extractServerIdFromResponse(res) {
  if (!res || !res.headers) return null;
  const candidates = [
    'x-orchestrator-server-id',
    'x-server-id',
    'x-upstream-server-id',
  ];
  for (const h of candidates) {
    const v = res.headers.get(h);
    if (v) return v;
  }
  return null;
}

async function fireOne({ url, model, prompt, maxTokens, timeoutMs, index }) {
  const body = JSON.stringify({
    model,
    prompt,
    stream: false,
    options: { num_predict: maxTokens },
  });

  const t0 = performance.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('client-timeout')), timeoutMs);

  try {
    const res = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: ac.signal,
    });
    const text = await res.text();
    const totalMs = performance.now() - t0;

    let parsed = null;
    let parseErr = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parseErr = e.message;
    }

    return {
      index,
      ok: res.ok && !parseErr,
      statusCode: res.status,
      latencyMs: round(totalMs),
      error: !res.ok ? `HTTP ${res.status}` : parseErr || null,
      serverId: extractServerIdFromResponse(res),
    };
  } catch (err) {
    const totalMs = performance.now() - t0;
    return {
      index,
      ok: false,
      statusCode: null,
      latencyMs: round(totalMs),
      error: String(err?.message || err),
      serverId: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runStep({ args, step }) {
  const totalRequests = step * args.reps;
  const tasks = [];
  for (let i = 0; i < totalRequests; i++) {
    tasks.push(
      fireOne({
        url: args.url,
        model: args.model,
        prompt: args.prompt,
        maxTokens: args.maxTokens,
        timeoutMs: args.timeoutMs,
        index: i,
      })
    );
  }

  const armedAt = performance.now();
  const results = await Promise.all(tasks);
  const wallClockMs = performance.now() - armedAt;

  const okResults = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const fleetThroughput = results.length / (wallClockMs / 1000);

  // Per-server aggregation (only if any serverId was returned)
  const perServerMap = new Map();
  for (const r of results) {
    if (!r.serverId) continue;
    const entry = perServerMap.get(r.serverId) || { serverId: r.serverId, lats: [] };
    entry.lats.push(r.latencyMs);
    perServerMap.set(r.serverId, entry);
  }
  const perServer = Array.from(perServerMap.values()).map((e) => {
    const sorted = e.lats.sort((a, b) => a - b);
    return {
      serverId: e.serverId,
      requests: sorted.length,
      p50: round(pct(sorted, 50)),
      p95: round(pct(sorted, 95)),
    };
  });

  return {
    concurrency: step,
    fleetP50: round(pct(latencies, 50)),
    fleetP95: round(pct(latencies, 95)),
    fleetThroughput: round(fleetThroughput),
    wallClockMs: round(wallClockMs),
    errors: failed.length,
    counts: { total: results.length, ok: okResults.length, failed: failed.length },
    perServer,
    perServerBreakdown:
      perServer.length > 0 ? 'response-header' : 'unavailable',
  };
}

function detectKnee(steps, targetP95Ms) {
  for (const s of steps) {
    if (s.fleetP95 != null && s.fleetP95 > targetP95Ms) {
      return {
        concurrency: s.concurrency,
        fleetP95: s.fleetP95,
        rationale: `first concurrency with fleetP95 > targetP95Ms (${targetP95Ms}ms)`,
      };
    }
  }
  return {
    concurrency: null,
    fleetP95: null,
    rationale: `no step exceeded targetP95Ms (${targetP95Ms}ms) within tested steps`,
  };
}

async function bench(args) {
  console.log(`[bench] model=${args.model} mode=${args.fleet ? 'fleet' : 'single-host'}`);
  console.log(`[bench] orchestrator=${args.url}`);
  console.log(`[bench] steps=${args.steps.join(',')} reps=${args.reps} targetP95Ms=${args.targetP95Ms}`);

  // ---- fleet discovery
  const fleetSummary = {
    hostsFound: 0,
    hostsResponded: 0,
    hostsErrored: 0,
    perServerBreakdown: 'unavailable',
  };
  let pinnedServer = null;

  if (args.fleet) {
    const disc = await discoverFleet({
      orchestratorUrl: args.url,
      model: args.model,
      timeoutMs: args.timeoutMs,
    });
    if (!disc.ok) {
      console.error(`[bench] fleet discovery failed: ${disc.error}`);
      throw new Error(disc.error);
    }
    fleetSummary.hostsFound = disc.servers.length;

    // Filter by orchestrator's reported models[] — avoids per-backend probes
    // that would otherwise time out on 277 hosts and block the whole batch.
    const healthy = disc.servers.filter((s) =>
      Array.isArray(s.models) && s.models.includes(args.model),
    );
    fleetSummary.hostsResponded = healthy.length;
    fleetSummary.hostsErrored = disc.servers.length - healthy.length;
    console.log(
      `[bench] fleet: ${fleetSummary.hostsFound} discovered, ` +
      `${fleetSummary.hostsResponded} with model=${args.model}, ` +
      `${fleetSummary.hostsErrored} missing-model (per orchestrator catalog)`
    );
    if (healthy.length === 0) {
      throw new Error(
        `no healthy host is currently serving model=${args.model}; aborting`
      );
    }
  } else {
    // legacy single-host mode: --host may be a URL or a server id
    if (!args.host) {
      throw new Error('--host is required for single-host mode');
    }
    const looksLikeUrl = /^https?:\/\//i.test(args.host);
    if (looksLikeUrl) {
      const probe = await probeBackendTags(args.host, args.model, Math.min(args.timeoutMs, 5000));
      if (!probe.ok) {
        throw new Error(`single-host probe failed: HTTP ${probe.status}`);
      }
      if (!probe.hasModel) {
        throw new Error(`single-host does not serve model=${args.model}`);
      }
      pinnedServer = { id: args.host, url: args.host };
    } else {
      // treat as server id — look it up via /api/orchestrator/servers
      const disc = await discoverFleet({
        orchestratorUrl: args.url,
        model: args.model,
        timeoutMs: args.timeoutMs,
      });
      if (!disc.ok) {
        throw new Error(`orchestrator /api/orchestrator/servers failed: HTTP ${disc.status}`);
      }
      const match = disc.servers.find((s) => s.id === args.host);
      if (!match) {
        throw new Error(`server id ${args.host} not found in orchestrator fleet`);
      }
      pinnedServer = { id: match.id, url: match.url };
    }
    fleetSummary.hostsFound = 1;
    fleetSummary.hostsResponded = 1;
    console.log(`[bench] single-host pinned to id=${pinnedServer.id} url=${pinnedServer.url}`);
  }

  // ---- run the curve
  const stepResults = [];
  for (const step of args.steps) {
    process.stdout.write(`[bench] step=${step} ... `);
    const s = await runStep({ args, step });
    stepResults.push(s);
    console.log(
      `p50=${s.fleetP50}ms p95=${s.fleetP95}ms ` +
      `rps=${s.fleetThroughput} err=${s.errors}/${s.counts.total}`
    );
  }

  const knee = detectKnee(stepResults, args.targetP95Ms);
  const report = {
    model: args.model,
    mode: args.fleet ? 'fleet' : 'single-host',
    fleetSummary,
    pinnedServer: pinnedServer ? { id: pinnedServer.id, url: pinnedServer.url } : null,
    config: {
      url: args.url,
      model: args.model,
      steps: args.steps,
      reps: args.reps,
      targetP95Ms: args.targetP95Ms,
      promptChars: args.prompt.length,
      maxTokens: args.maxTokens,
      timeoutMs: args.timeoutMs,
    },
    steps: stepResults,
    knee,
    startedAt: new Date().toISOString(),
  };

  // ---- write report
  const reportDir = path.resolve(args.reportDir);
  await fs.mkdir(reportDir, { recursive: true });
  const safeModel = args.model.replace(/:/g, '_').replace(/[^a-zA-Z0-9_.-]+/g, '_');
  const date = new Date().toISOString().slice(0, 10);
  const modeTag = args.fleet ? 'fleet' : 'single';
  const reportPath = path.join(reportDir, `bench-${safeModel}-${modeTag}-${date}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log('');
  console.log('=== BENCH RESULTS ===');
  for (const s of stepResults) {
    console.log(
      `step=${s.concurrency.toString().padStart(3)}  ` +
      `p50=${String(s.fleetP50).padStart(7)}ms  ` +
      `p95=${String(s.fleetP95).padStart(7)}ms  ` +
      `rps=${String(s.fleetThroughput).padStart(6)}  ` +
      `err=${s.errors}/${s.counts.total}`
    );
  }
  console.log(
    `knee: ${knee.concurrency != null
      ? `concurrency=${knee.concurrency} fleetP95=${knee.fleetP95}ms`
      : 'none (all steps under target)'}`
  );
  console.log(`perServerBreakdown: ${fleetSummary.perServerBreakdown}`);
  console.log(`report: ${reportPath}`);

  return report;
}

const args = parseArgs(process.argv);
bench(args).catch((err) => {
  console.error('[bench] fatal:', err?.message || err);
  process.exit(1);
});
