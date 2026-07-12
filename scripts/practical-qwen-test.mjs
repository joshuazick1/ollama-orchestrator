/**
 * practical-qwen-test.mjs
 * Pushes concurrency until the adaptive concurrency tuner and queue are fully exercised.
 *
 * 1. Pre-fetches pages from Memory Alpha
 * 2. Single-flight profile (EXTRACT / SUMMARY / QA)
 * 3. Sustained concurrency sweep on EXTRACT (c=4..128, 20 batches each)
 * 4. Reports per-level metrics + auto-tuner telemetry from orchestrator
 */

const ORCHESTRATOR = 'http://localhost:5100';
const MODEL = 'qwen3:0.6b';
const PAGES = [
  'Jean-Luc_Picard', 'James_T._Kirk', 'Spock', 'Data',
  'Worf', 'Kathryn_Janeway', 'Benjamin_Sisko', 'Jonathan_Archer',
  'USS_Enterprise_(NCC-1701-D)', 'Borg', 'Starfleet', 'Klingon',
];
const CHUNK_SIZE = 3000;
const CONCURRENCY_LEVELS = [8, 16, 32, 64, 128];
const BATCHES_PER_LEVEL = 10;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function fetchMemoryAlpha(title) {
  const url = `https://memory-alpha.fandom.com/api.php?action=query&titles=${encodeURIComponent(title)}&prop=extracts&exlimit=1&explaintext=1&exchars=6000&format=json`;
  const resp = await fetch(url);
  const data = await resp.json();
  const pages = data?.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  return page?.extract ?? null;
}

function chunkText(text, size) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

function buildPrompt(taskType, chunk) {
  const msgs = {
    EXTRACT: [
      { role: 'system', content: 'Extract JSON from the text with keys: characters (array of character names), location (string or null), era (string). Return ONLY valid JSON.' },
      { role: 'user', content: `Text:\n${chunk}\n\nJSON:` },
    ],
    SUMMARY: [
      { role: 'system', content: 'Summarize the following Star Trek wiki text in 2-3 sentences.' },
      { role: 'user', content: chunk },
    ],
    QA: [
      { role: 'system', content: 'Answer the question concisely based on the provided text.' },
      { role: 'user', content: `${chunk}\n\nQuestion: What is this text about and who does it refer to?` },
    ],
  };
  return msgs[taskType];
}

async function sendRequest(messages) {
  const start = Date.now();
  let status;
  try {
    const resp = await fetch(`${ORCHESTRATOR}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages,
        options: { think: false },
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    status = resp.status;
    if (!resp.ok) {
      return { ok: false, latency: Date.now() - start, status };
    }
    const data = await resp.json();
    return {
      ok: true,
      latency: Date.now() - start,
      content: data?.message?.content ?? '',
      evalCount: data?.eval_count ?? 0,
      loadDuration: data?.load_duration ?? 0,
    };
  } catch (err) {
    return { ok: false, latency: Date.now() - start, status: err.name === 'TimeoutError' ? 408 : 0 };
  }
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function fetchAutoTunerState() {
  for (const path of ['/api/orchestrator/concurrency/stats', '/api/orchestrator/concurrency-stats']) {
    try {
      const resp = await fetch(`${ORCHESTRATOR}${path}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) return await resp.json();
    } catch { /* try next */ }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Runner                                                             */
/* ------------------------------------------------------------------ */

async function runSingleFlight(chunks) {
  console.log('\n=== Single-Flight Profile ===\n');
  const results = {};
  for (const taskType of ['EXTRACT', 'SUMMARY', 'QA']) {
    const latencies = [];
    let ok = 0;
    const taskStart = Date.now();
    for (const chunk of chunks.slice(0, 12)) {
      const r = await sendRequest(buildPrompt(taskType, chunk));
      latencies.push(r.latency);
      if (r.ok) ok++;
    }
    const wall = (Date.now() - taskStart) / 1000;
    results[taskType] = { N: Math.min(12, chunks.length), ok, p50: percentile(latencies, 50), p95: percentile(latencies, 95), wall };
    console.log(`  ${taskType.padEnd(8)} N=${results[taskType].N} OK=${ok} P50=${results[taskType].p50}ms P95=${results[taskType].p95}ms Wall=${wall.toFixed(1)}s`);
  }
  return results;
}

async function runConcurrencySweep(chunks) {
  console.log('\n=== Sustained Concurrency Sweep (EXTRACT) ===\n');

  // Snapshot tuner state before
  const tunerBefore = await fetchAutoTunerState();

  const rows = [];
  for (const c of CONCURRENCY_LEVELS) {
    const totalReqs = c * BATCHES_PER_LEVEL;
    const latencies = [];
    let ok = 0;
    const sweepStart = Date.now();
    let queueWaitCount = 0;

    for (let batch = 0; batch < BATCHES_PER_LEVEL; batch++) {
      const batchTasks = [];
      for (let i = 0; i < c; i++) {
        const chunk = chunks[(batch * c + i) % chunks.length];
        const rStart = Date.now();
        batchTasks.push(sendRequest(buildPrompt('EXTRACT', chunk)));
      }
      const batchResults = await Promise.allSettled(batchTasks);
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          latencies.push(r.value.latency);
          if (r.value.ok) ok++;
        }
      }
    }

    const wall = (Date.now() - sweepStart) / 1000;
    const rps = wall > 0 ? (totalReqs / wall).toFixed(2) : 'N/A';
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const failCount = totalReqs - ok;

    // Fetch tuner state after this level
    const tunerAfter = await fetchAutoTunerState();
    const pairCount = tunerAfter?.pairs?.length ?? 0;
    const raisedPairs = tunerAfter?.pairs?.filter(p => p.lastAdjustReason === 'raise')?.length ?? 0;
    const loweredPairs = tunerAfter?.pairs?.filter(p => p.lastAdjustReason?.startsWith('lower'))?.length ?? 0;

    rows.push({ c, reqs: totalReqs, ok, failCount, p50, p95, rps, pairCount, raisedPairs, loweredPairs });
    console.log(
      `  c=${c.toString().padEnd(3)} reqs=${totalReqs} OK=${ok} FAIL=${failCount} ` +
      `P50=${p50}ms P95=${p95}ms RPS=${rps}  ` +
      `[tuner: ${pairCount} pairs, ${raisedPairs} raised, ${loweredPairs} lowered]`
    );
  }

  // Snapshot tuner state after full sweep
  const tunerAfter = await fetchAutoTunerState();

  return { rows, tunerBefore, tunerAfter };
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log(`Orchestrator: ${ORCHESTRATOR}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Pages: ${PAGES.length}`);
  console.log(`Date: ${new Date().toISOString()}`);

  // Step 1: Pre-fetch all pages
  console.log('\n=== Fetching Memory Alpha pages ===');
  const allTexts = [];
  for (const title of PAGES) {
    const text = await fetchMemoryAlpha(title);
    if (text) {
      allTexts.push(text);
      console.log(`  ✓ ${title} (${text.length} chars)`);
    } else {
      console.log(`  ✗ ${title}`);
    }
  }
  console.log(`  Total: ${allTexts.length}/${PAGES.length}`);

  const chunks = allTexts.flatMap(t => chunkText(t, CHUNK_SIZE));
  console.log(`  Chunks (~${CHUNK_SIZE} chars): ${chunks.length}`);
  if (chunks.length === 0) { console.error('No data — aborting.'); process.exit(1); }

  // Step 2: Single-flight (lightweight warmup + baseline)
  const sf = await runSingleFlight(chunks);

  // Step 3: Sustained concurrency sweep
  const { rows, tunerBefore, tunerAfter } = await runConcurrencySweep(chunks);

  // Step 4: Print report
  console.log('\n\n=== REPORT ===\n');

  console.log('## Per-task single-flight profile\n');
  console.log('| Task | N | OK | P50 (ms) | P95 (ms) | Wall (s) |');
  console.log('|------|---|----|---------:|---------:|---------:|');
  for (const [task, r] of Object.entries(sf)) {
    console.log(`| ${task} | ${r.N} | ${r.ok} | ${r.p50} | ${r.p95} | ${r.wall.toFixed(1)} |`);
  }

  console.log('\n## Sustained concurrency sweep (EXTRACT)\n');
  console.log('| c | Reqs | OK | Fail | P50 (ms) | P95 (ms) | RPS | Tuner pairs | Raised | Lowered |');
  console.log('|--:|-----:|---:|-----:|---------:|---------:|----:|-----------:|-------:|--------:|');
  for (const row of rows) {
    console.log(
      `| ${row.c} | ${row.reqs} | ${row.ok} | ${row.failCount} | ${row.p50} | ${row.p95} | ${row.rps} | ${row.pairCount} | ${row.raisedPairs} | ${row.loweredPairs} |`
    );
  }

  const peak = rows.reduce((a, b) => (parseFloat(b.rps) > parseFloat(a.rps) ? b : a), rows[0]);
  console.log(`\n- **Peak throughput**: ${peak.rps} req/s at concurrency=${peak.c}`);
  console.log(`- **Total requests**: ${rows.reduce((s, r) => s + r.reqs, 0)}`);

  // Tuner delta
  if (tunerBefore && tunerAfter) {
    const bPairs = tunerBefore.pairs?.length ?? 0;
    const aPairs = tunerAfter.pairs?.length ?? 0;
    console.log(`\n## Auto-tuner delta\n`);
    console.log(`- Before: ${bPairs} pairs`);
    console.log(`- After:  ${aPairs} pairs`);
    console.log(`- Diff:   ${aPairs - bPairs} pairs`);

    // Show top adjusted pairs
    const adjusted = (tunerAfter.pairs ?? [])
      .filter(p => p.lastAdjustReason)
      .sort((a, b) => Math.abs(b.windowP95 - 3000) - Math.abs(a.windowP95 - 3000))
      .slice(0, 10);
    if (adjusted.length > 0) {
      console.log('\n### Most active tuner pairs\n');
      console.log('| Server | Model | Cap | Floor | P50 | P95 | Last adjust |');
      console.log('|--------|-------|----:|------:|----:|----:|-------------|');
      for (const p of adjusted) {
        console.log(`| ${p.serverId.slice(0,12)} | ${(p.model ?? MODEL).slice(0,16)} | ${p.currentCap} | ${p.floor} | ${p.windowP50} | ${p.windowP95} | ${p.lastAdjustReason} |`);
      }
    }
  }

  // Queue stats — read from runtime telemetry
  console.log('\n## Auto-tuner summary\n');
  if (tunerAfter && tunerAfter.pairs) {
    const raisedCount = tunerAfter.pairs.filter(p => p.lastAdjustReason === 'raise')?.length ?? 0;
    const loweredCount = tunerAfter.pairs.filter(p => p.lastAdjustReason?.startsWith('lower'))?.length ?? 0;
    const atFloor = tunerAfter.pairs.filter(p => p.currentCap <= p.floor)?.length ?? 0;
    console.log(`- Pairs at floor (no adjustment): ${atFloor}`);
    console.log(`- Pairs raised: ${raisedCount}`);
    console.log(`- Pairs lowered: ${loweredCount}`);
    console.log(`- Pairs total: ${tunerAfter.pairs.length}`);
  } else {
    console.log('(not available — auth-gated endpoint)');
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
