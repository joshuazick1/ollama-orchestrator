#!/usr/bin/env node
// Pull <model> to a chosen subset of Ollama servers in the fleet.
//
//   --model <name>          default: smollm2:135m
//   --concurrency <n>       parallel pulls        default: 8
//   --limit <n>             cap on servers to act on (default: 10) - safety
//   --include-already       re-pull on hosts that already have it (off)
//   --report <path>         JSON output path     default: .sisyphus/reports/pull-report.json
//   --dry-run               enumerate and probe only
//
// servers.json is the canonical source for server URLs + health.
// We do not hit /api/tags here; we only read servers.json + each backend's /api/tags.

import { promises as fs } from 'fs';
import path from 'path';

function parseArgs(argv) {
  const args = {
    model: 'smollm2:135m',
    concurrency: 8,
    limit: 10,
    includeAlready: false,
    report: '.sisyphus/reports/pull-report.json',
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--model': args.model = next(); break;
      case '--concurrency': args.concurrency = parseInt(next(), 10); break;
      case '--limit': args.limit = parseInt(next(), 10); break;
      case '--include-already': args.includeAlready = true; break;
      case '--report': args.report = next(); break;
      case '--dry-run': args.dryRun = true; break;
      case '--help':
      case '-h':
        console.log(
          'Usage: node scripts/pull-to-fleet.js [options]\n' +
          '  --model <name>          model name (default: smollm2:135m)\n' +
          '  --concurrency <n>       parallel pulls (default: 8)\n' +
          '  --limit <n>             max servers to act on (default: 10)\n' +
          '  --include-already       pull on hosts that already have it (off)\n' +
          '  --report <path>         JSON report path\n' +
          '  --dry-run               enumerate and probe only'
        );
        process.exit(0);
      default:
        console.error(`Unknown arg: ${a}`);
        process.exit(2);
    }
  }
  return args;
}

async function probeServer(url, model) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 2500);
  try {
    const r = await fetch(`${url}/api/tags`, { signal: ac.signal });
    if (!r.ok) return { reachable: false, hasModel: false, status: r.status };
    const data = await r.json();
    const names = (data.models || []).map((m) => m.name);
    return { reachable: true, hasModel: names.includes(model), models: names, status: 200 };
  } catch (e) {
    return { reachable: false, hasModel: false, status: 0, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function pullModel(url, model) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 1_200_000);
  const start = Date.now();
  try {
    const r = await fetch(`${url}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
      signal: ac.signal,
    });
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, status: r.status, error: body.slice(0, 500), ms: Date.now() - start };
    }
    let lastStatus = null;
    let bytes = 0;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.status) lastStatus = ev.status;
          if (ev.error) {
            return { ok: false, status: 200, error: ev.error, lastStatus, bytes, ms: Date.now() - start };
          }
        } catch {}
      }
    }
    return { ok: true, status: 200, lastStatus, bytes, ms: Date.now() - start };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e), ms: Date.now() - start };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(
    `[pull-fleet] model=${args.model} concurrency=${args.concurrency} limit=${args.limit} ` +
    `includeAlready=${args.includeAlready} dryRun=${args.dryRun}`
  );

  const raw = await fs.readFile('/root/project/ollama-orchestrator/data/servers.json', 'utf8');
  const fleet = JSON.parse(raw);
  console.log(`[pull-fleet] fleet size: ${fleet.length}`);

  const candidates = fleet.filter((s) =>
    s.url && s.supportsOllama !== false && s.healthy
  );
  console.log(`[pull-fleet] healthy ollama-capable candidates: ${candidates.length}`);

  const probeResults = [];
  const PROBE_CONC = 64;
  for (let i = 0; i < candidates.length; i += PROBE_CONC) {
    const slice = candidates.slice(i, i + PROBE_CONC);
    const ps = await Promise.all(
      slice.map(async (s) => ({ id: s.id, url: s.url, maxConcurrency: s.maxConcurrency, ...(await probeServer(s.url, args.model)) }))
    );
    probeResults.push(...ps);
  }
  const need = probeResults.filter((r) => r.reachable && !r.hasModel);
  const have = probeResults.filter((r) => r.reachable && r.hasModel);
  const dead = probeResults.filter((r) => !r.reachable);
  console.log(`[pull-fleet] reachable=${probeResults.length} have_model=${have.length} need_pull=${need.length} unreachable=${dead.length}`);

  const targets = args.includeAlready
    ? probeResults.filter((r) => r.reachable).slice(0, args.limit)
    : need.slice(0, args.limit);
  console.log(`[pull-fleet] acting on ${targets.length} target(s)`);
  if (targets.length === 0) {
    console.log('[pull-fleet] nothing to do');
    const summary = {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      config: args,
      fleetSize: fleet.length,
      healthyOllamaCapable: candidates.length,
      alreadyHaveModel: have.length,
      unreachable: dead.length,
      needPull: need.length,
      targeted: targets.length,
      pulled: 0, failed: 0,
      results: [],
    };
    await fs.mkdir(path.dirname(args.report), { recursive: true });
    await fs.writeFile(args.report, JSON.stringify(summary, null, 2));
    return;
  }

  if (args.dryRun) {
    const summary = {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      config: args,
      fleetSize: fleet.length,
      healthyOllamaCapable: candidates.length,
      alreadyHaveModel: have.length,
      unreachable: dead.length,
      needPull: need.length,
      targets: targets,
    };
    await fs.mkdir(path.dirname(args.report), { recursive: true });
    await fs.writeFile(args.report, JSON.stringify(summary, null, 2));
    console.log(`[pull-fleet] dry-run report: ${args.report}`);
    return;
  }

  const pullResults = [];
  let succeeded = 0, failed = 0, done = 0;

  async function worker(item) {
    done++;
    const tag = `${item.id} (${item.url})`;
    process.stdout.write(`[pull-fleet] [${done}/${targets.length}] ${tag} - starting\n`);
    const res = await pullModel(item.url, args.model);
    if (res.ok) {
      succeeded++;
      process.stdout.write(`[pull-fleet] [${done}/${targets.length}] ${tag} - OK in ${Math.round(res.ms/1000)}s last=${res.lastStatus}\n`);
    } else {
      failed++;
      process.stdout.write(`[pull-fleet] [${done}/${targets.length}] ${tag} - FAIL: ${String(res.error).slice(0,140)}\n`);
    }
    pullResults.push({ ...item, ...res });
  }

  const queue = targets.slice();
  await Promise.all(
    Array.from({ length: args.concurrency }, async () => {
      while (queue.length) {
        const item = queue.shift();
        if (!item) return;
        await worker(item);
      }
    })
  );

  const summary = {
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    config: args,
    fleetSize: fleet.length,
    healthyOllamaCapable: candidates.length,
    alreadyHaveModel: have.length,
    unreachable: dead.length,
    needPull: need.length,
    targeted: targets.length,
    pulled: succeeded,
    failed,
    results: pullResults,
  };
  await fs.mkdir(path.dirname(args.report), { recursive: true });
  await fs.writeFile(args.report, JSON.stringify(summary, null, 2));
  console.log(`[pull-fleet] report: ${args.report}`);
  console.log(
    `\n=== PULL SUMMARY ===\n` +
    `targeted: ${targets.length}\npulled: ${succeeded}\nfailed: ${failed}\n` +
    `report: ${args.report}`
  );
}

main().catch((err) => {
  console.error('[pull-fleet] fatal:', err);
  process.exit(1);
});
