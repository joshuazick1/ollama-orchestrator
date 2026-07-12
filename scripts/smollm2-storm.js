#!/usr/bin/env node
// Usage: node scripts/smollm2-storm.js [--url URL] [--model NAME] [--count N]
//                                   [--prompt TEXT] [--max-tokens N]
//                                   [--timeout-ms N] [--report-dir PATH] [--label TEXT]

import { promises as fs } from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';

function parseArgs(argv) {
  const args = {
    url: 'http://localhost:5100',
    model: 'smollm2:135m',
    count: 50,
    prompt: 'Write one short sentence about the moon.',
    maxTokens: 32,
    timeoutMs: 300_000,
    reportDir: '.sisyphus/reports',
    label: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--url': args.url = next(); break;
      case '--model': args.model = next(); break;
      case '--count': args.count = parseInt(next(), 10); break;
      case '--prompt': args.prompt = next(); break;
      case '--max-tokens': args.maxTokens = parseInt(next(), 10); break;
      case '--timeout-ms': args.timeoutMs = parseInt(next(), 10); break;
      case '--report-dir': args.reportDir = next(); break;
      case '--label': args.label = next(); break;
      case '--help':
      case '-h':
        console.log(
          'Usage: node scripts/smollm2-storm.js [--url URL] [--model NAME] [--count N]\n' +
          '       [--prompt TEXT] [--max-tokens N] [--timeout-ms N] [--report-dir PATH]\n' +
          '       [--label TEXT]'
        );
        process.exit(0);
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
    }
  }
  return args;
}

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
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
    const ttftMs = performance.now() - t0; // non-streaming: TTFT == total

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
      totalMs: round(ttftMs),
      ttftMs: round(ttftMs),
      error: !res.ok ? `HTTP ${res.status}` : parseErr || null,
      responseChars: parsed?.response?.length ?? 0,
      promptEvalCount: parsed?.prompt_eval_count ?? null,
      evalCount: parsed?.eval_count ?? null,
      totalDurationMs:
        parsed?.total_duration != null ? round(parsed.total_duration / 1e6) : null,
      loadDurationMs:
        parsed?.load_duration != null ? round(parsed.load_duration / 1e6) : null,
      evalDurationMs:
        parsed?.eval_duration != null ? round(parsed.eval_duration / 1e6) : null,
    };
  } catch (err) {
    const totalMs = performance.now() - t0;
    return {
      index,
      ok: false,
      statusCode: null,
      totalMs: round(totalMs),
      ttftMs: null,
      error: String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function round(n) {
  return Math.round(n * 100) / 100;
}

async function storm(args) {
  const tag = `smollm2-storm model=${args.model} count=${args.count}`;
  console.log(`[storm] ${tag}`);
  console.log(`[storm] url=${args.url}  prompt=${JSON.stringify(args.prompt)}`);
  console.log(`[storm] arming ${args.count} parallel requests...`);

  const armedAt = performance.now();
  const tasks = [];
  for (let i = 0; i < args.count; i++) {
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

  const results = await Promise.all(tasks);
  const wallClockMs = performance.now() - armedAt;

  // ---- aggregate stats
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const totals = results.map((r) => r.totalMs).sort((a, b) => a - b);
  const rps = results.length / (wallClockMs / 1000);

  const summary = {
    label: args.label || tag,
    startedAt: new Date().toISOString(),
    config: {
      url: args.url,
      model: args.model,
      count: args.count,
      maxTokens: args.maxTokens,
      timeoutMs: args.timeoutMs,
      promptChars: args.prompt.length,
    },
    wallClockMs: round(wallClockMs),
    throughputRps: round(rps),
    counts: {
      total: results.length,
      ok: ok.length,
      failed: failed.length,
    },
    latencyMs: {
      min: round(totals[0]),
      p50: round(pct(totals, 50)),
      p75: round(pct(totals, 75)),
      p90: round(pct(totals, 90)),
      p95: round(pct(totals, 95)),
      p99: round(pct(totals, 99)),
      max: round(totals[totals.length - 1]),
      mean: round(totals.reduce((s, v) => s + v, 0) / totals.length),
    },
    evalTokens: collectStats(ok, 'evalCount'),
    responseChars: collectStats(ok, 'responseChars'),
    errors: groupErrors(failed),
    results,
  };

  // ---- persist
  const reportDir = path.resolve(args.reportDir);
  await fs.mkdir(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const modelSlug = args.model.replace(/[^a-zA-Z0-9]+/g, '_');
  const reportPath = path.join(
    reportDir,
    `smollm2-storm_${modelSlug}_n${args.count}_${stamp}.json`
  );
  await fs.writeFile(reportPath, JSON.stringify(summary, null, 2));

  // ---- human summary on stdout
  console.log('');
  console.log('=== RESULTS ===');
  console.log(`wall clock      : ${summary.wallClockMs} ms`);
  console.log(`throughput      : ${summary.throughputRps} req/s`);
  console.log(`requests ok/fail: ${summary.counts.ok} / ${summary.counts.failed}`);
  console.log(
    `latency ms min/p50/p90/p95/max: ` +
      `${summary.latencyMs.min} / ${summary.latencyMs.p50} / ${summary.latencyMs.p90} / ` +
      `${summary.latencyMs.p95} / ${summary.latencyMs.max}`
  );
  if (summary.evalTokens.min != null) {
    console.log(
      `eval tokens min/max/mean: ${summary.evalTokens.min} / ${summary.evalTokens.max} / ` +
        `${summary.evalTokens.mean}`
    );
  }
  if (failed.length) {
    console.log(`error histogram : ${JSON.stringify(summary.errors)}`);
  }
  console.log(`report          : ${reportPath}`);

  return summary;
}

function collectStats(rows, field) {
  const vals = rows
    .map((r) => r[field])
    .filter((v) => v != null)
    .sort((a, b) => a - b);
  if (vals.length === 0) return { min: null, max: null, mean: null };
  return {
    min: vals[0],
    max: vals[vals.length - 1],
    mean: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100,
  };
}

function groupErrors(rows) {
  const out = {};
  for (const r of rows) {
    const key = r.statusCode ? `HTTP ${r.statusCode}` : r.error || 'unknown';
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

const args = parseArgs(process.argv);
storm(args).catch((err) => {
  console.error('[storm] fatal:', err);
  process.exit(1);
});
