/**
 * iterate.mjs
 * Fast iteration benchmark for qwen3:0.6b tuning.
 * Runs a fixed c=32 sweep with 5 batches (~90s).
 * Reports RPS, P50/P95/P99, and auto-tuner snapshot.
 *
 * Usage: node scripts/iterate.mjs [iter_name]
 */

const ORCHESTRATOR = 'http://localhost:5100';
const MODEL = 'qwen3:0.6b';
const c = 32;
const BATCHES = 5;

const CHUNKS = [
  "Jean-Luc Picard is a fictional character in the Star Trek franchise. He is a Starfleet officer who served as captain of the USS Enterprise-D and later the USS Enterprise-E. Picard was born in Labarre, France on July 13, 2305 to Maurice and Yvette Picard. He attended Starfleet Academy and rose through the ranks becoming one of Starfleet's most respected officers. He is known for his diplomatic skills, love of archaeology, and his passion for Earl Grey tea.",
  "James T. Kirk was a legendary Starfleet officer who served as captain of the USS Enterprise NCC-1701. Born in Riverside, Iowa on March 22, 2233, Kirk was known for his daring tactics and unorthodox approach to command. He attended Starfleet Academy and quickly rose to become the youngest captain in Starfleet history. Kirk was known for his close friendship with Spock and Dr. Leonard McCoy.",
  "Spock was a half-Vulcan, half-Human Starfleet officer who served as science officer and first officer aboard the USS Enterprise. Born in 2230 on Vulcan to Sarek, a Vulcan ambassador, and Amanda Grayson, a Human teacher, Spock struggled with his dual heritage throughout his life.",
  "Data was an android Starfleet officer who served as second officer and chief operations officer aboard the USS Enterprise-D. Built by Dr. Noonien Soong, Data possessed superhuman strength and an encyclopedic memory but strived to understand human emotions and behavior.",
  "Worf was a Klingon Starfleet officer who served as security chief aboard the USS Enterprise-D and later as tactical officer on Deep Space 9. Born on the Klingon homeworld Qo'noS in 2340, Worf was raised by Human parents after his father was killed in battle.",
  "Kathryn Janeway was a Starfleet officer who commanded the USS Voyager during its seven-year journey through the Delta Quadrant. Born in Bloomington, Indiana, Janeway was a brilliant scientist before joining command.",
  "Benjamin Sisko was a Starfleet officer who commanded Deep Space 9 during a pivotal period in galactic history. Born in New Orleans, Louisiana, Sisko was initially reluctant to take command of the former Cardassian space station.",
  "Jonathan Archer was the captain of the first Warp 5 starship Enterprise NX-01. Born in upstate New York, Archer was a pioneer in early space exploration who laid the foundation for the United Federation of Planets.",
  "The Borg were a race of cybernetic beings that sought to assimilate all sentient life into their collective consciousness. Originating from the Delta Quadrant, the Borg operated as a hive mind with a single consciousness.",
  "Starfleet was the principal space exploration and defense organization of the United Federation of Planets. Headquartered in San Francisco, Earth, Starfleet operated thousands of starships and starbases across the galaxy.",
  "The Klingon Empire was a major political power in the Alpha Quadrant known for its warrior culture and honor-based society. The Klingons were a humanoid species with distinctive forehead ridges.",
  "The United Federation of Planets was the largest interstellar political entity in the Alpha Quadrant. Founded in 2161 by Earth, Vulcan, Andoria, and Tellar, the Federation was based on principles of peace, cooperation, and mutual defense.",
];

const iterName = process.argv[2] ?? 'unnamed';
const KEEP_ALIVE = process.env.KEEP_ALIVE ?? ''; // e.g. "5m"

function buildPrompt(chunk) {
  return [
    { role: 'system', content: 'Extract JSON with keys: characters (array), location (string|null), era (string). Return ONLY valid JSON.' },
    { role: 'user', content: `Text:\n${chunk}\n\nJSON:` },
  ];
}

async function sendRequest(messages) {
  const start = Date.now();
  try {
    const body = { model: MODEL, messages, options: { think: false }, stream: false };
    if (KEEP_ALIVE) body.keep_alive = KEEP_ALIVE;
    const resp = await fetch(`${ORCHESTRATOR}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    if (!resp.ok) return { ok: false, latency: Date.now() - start, status: resp.status };
    const data = await resp.json();
    return { ok: true, latency: Date.now() - start, evalCount: data?.eval_count ?? 0 };
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

async function fetchTunerStats() {
  try {
    const resp = await fetch(`${ORCHESTRATOR}/api/orchestrator/concurrency/stats`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

async function fetchLoadBalancerWeights() {
  try {
    const resp = await fetch(`${ORCHESTRATOR}/api/orchestrator/config`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const d = await resp.json();
    return d?.config?.loadBalancer?.weights ?? null;
  } catch { return null; }
}

async function main() {
  console.log(`\n=== Iteration: ${iterName} ===`);
  console.log(`c=${c} batches=${BATCHES} keep_alive="${KEEP_ALIVE}"`);
  console.log(`Start: ${new Date().toISOString()}`);

  const lbWeights = await fetchLoadBalancerWeights();
  console.log(`LB weights: latency=${lbWeights?.latency} success=${lbWeights?.successRate} load=${lbWeights?.load}`);

  const before = await fetchTunerStats();
  const bPairs = before?.pairs?.filter(p => p.model === MODEL) ?? [];
  const bCapSum = bPairs.reduce((s, p) => s + p.currentCap, 0);
  const bModes = before ? `mode=${before.mode}` : '';
  console.log(`Tuner before: ${bPairs.length} pairs, total cap=${bCapSum}, ${bModes}`);

  const totalReqs = c * BATCHES;
  const latencies = [];
  let ok = 0;
  let fail = 0;
  const globalStart = Date.now();

  for (let batch = 0; batch < BATCHES; batch++) {
    const batchTasks = [];
    for (let i = 0; i < c; i++) {
      const chunk = CHUNKS[(batch * c + i) % CHUNKS.length];
      batchTasks.push(sendRequest(buildPrompt(chunk)));
    }
    const batchResults = await Promise.allSettled(batchTasks);
    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        latencies.push(r.value.latency);
        if (r.value.ok) ok++;
        else fail++;
      }
    }
    const elapsed = ((Date.now() - globalStart) / 1000).toFixed(0);
    process.stdout.write(`  batch ${batch + 1}/${BATCHES} done (${elapsed}s)\r`);
  }

  const wall = (Date.now() - globalStart) / 1000;
  const rps = wall > 0 ? (totalReqs / wall).toFixed(2) : 'N/A';

  const after = await fetchTunerStats();
  const aPairs = after?.pairs?.filter(p => p.model === MODEL) ?? [];
  const aCapSum = aPairs.reduce((s, p) => s + p.currentCap, 0);
  const aRaised = aPairs.filter(p => p.lastAdjustReason === 'raise').length;
  const aLowered = aPairs.filter(p => p.lastAdjustReason?.startsWith('lower')).length;

  const caps = aPairs.map(p => p.currentCap);
  const capMin = caps.length ? Math.min(...caps) : 0;
  const capMax = caps.length ? Math.max(...caps) : 0;
  const capAvg = caps.length ? (caps.reduce((s, c) => s + c, 0) / caps.length).toFixed(1) : '0';

  console.log(`\n  ── Result ──`);
  console.log(`  Reqs: ${totalReqs}  OK: ${ok}  Fail: ${fail}`);
  console.log(`  Wall: ${wall.toFixed(1)}s  RPS: ${rps}`);
  console.log(`  P50: ${percentile(latencies, 50)}ms  P95: ${percentile(latencies, 95)}ms  P99: ${percentile(latencies, 99)}ms  Max: ${Math.max(...latencies)}ms`);
  console.log(`  Tuner: ${aPairs.length} pairs, cap ${capMin}/${capAvg}/${capMax}, raised=${aRaised} lowered=${aLowered}`);
  console.log(`  Total qwen3:0.6b cluster cap: ${aCapSum}`);
  console.log(`  Summary: ${iterName} → ${rps} RPS, P95=${percentile(latencies, 95)}ms\n`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });