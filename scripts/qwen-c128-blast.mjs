/**
 * qwen-c128-blast.mjs
 * Targeted blast at c=128 to exercise the queue and adaptive concurrency tuner.
 * Uses pre-existing chunks from Memory Alpha.
 */

const ORCHESTRATOR = 'http://localhost:5100';
const MODEL = 'qwen3:0.6b';
const CHUNKS = [
  "Jean-Luc Picard is a fictional character in the Star Trek franchise. He is a Starfleet officer who served as captain of the USS Enterprise-D and later the USS Enterprise-E. Picard was born in Labarre, France on July 13, 2305 to Maurice and Yvette Picard. He attended Starfleet Academy and rose through the ranks becoming one of Starfleet's most respected officers. He is known for his diplomatic skills, love of archaeology, and his passion for Earl Grey tea. Picard commanded the Enterprise-D from 2364 to 2371 and led numerous first contact missions.",
  "James T. Kirk was a legendary Starfleet officer who served as captain of the USS Enterprise NCC-1701. Born in Riverside, Iowa on March 22, 2233, Kirk was known for his daring tactics and unorthodox approach to command. He attended Starfleet Academy and quickly rose to become the youngest captain in Starfleet history. Kirk was known for his close friendship with Spock and Dr. Leonard McCoy. He commanded the Enterprise on its historic five-year mission exploring strange new worlds.",
  "Spock was a half-Vulcan, half-Human Starfleet officer who served as science officer and first officer aboard the USS Enterprise. Born in 2230 on Vulcan to Sarek, a Vulcan ambassador, and Amanda Grayson, a Human teacher, Spock struggled with his dual heritage throughout his life. He was known for his logical approach to problems, the Vulcan salute, and his friendship with Captain Kirk. Spock attended the Vulcan Science Academy before joining Starfleet.",
  "Data was an android Starfleet officer who served as second officer and chief operations officer aboard the USS Enterprise-D. Built by Dr. Noonien Soong, Data possessed superhuman strength and an encyclopedic memory but strived to understand human emotions and behavior. He was discovered by Starfleet and attended Starfleet Academy where he graduated with honors. Data served with distinction under Captain Picard and formed close friendships with Geordi La Forge and Counselor Troi.",
  "Worf was a Klingon Starfleet officer who served as security chief aboard the USS Enterprise-D and later as tactical officer on Deep Space 9. Born on the Klingon homeworld Qo'noS in 2340, Worf was raised by Human parents after his father was killed in battle. He struggled to balance his Klingon heritage with his Starfleet duties. Worf was known for his warrior spirit, honor code, and deep bass voice. He became the first Klingon to serve in Starfleet.",
  "Kathryn Janeway was a Starfleet officer who commanded the USS Voyager during its seven-year journey through the Delta Quadrant. Born in Bloomington, Indiana, Janeway was a brilliant scientist before joining command. When Voyager was stranded 70,000 light-years from Earth, she united a diverse crew including Maquis rebels and the holographic Doctor. Janeway was known for her determination, scientific curiosity, and moral principles.",
  "Benjamin Sisko was a Starfleet officer who commanded Deep Space 9 during a pivotal period in galactic history. Born in New Orleans, Louisiana, Sisko was initially reluctant to take command of the former Cardassian space station. He was chosen by the Bajoran Prophets and became their Emissary, playing a key role in the Dominion War. Sisko was known for his leadership, cooking skills, and complex relationship with the Prophets.",
  "Jonathan Archer was the captain of the first Warp 5 starship Enterprise NX-01. Born in upstate New York, Archer was a pioneer in early space exploration who laid the foundation for the United Federation of Planets. He commanded the Enterprise during a time of first contact with many alien species including the Klingons and Vulcans. Archer later served as a Federation Council member and eventually as President of the Federation.",
  "The Borg were a race of cybernetic beings that sought to assimilate all sentient life into their collective consciousness. Originating from the Delta Quadrant, the Borg operated as a hive mind with a single consciousness. They were known for their iconic phrase Resistance is futile and their cube-shaped vessels. The Borg assimilated entire civilizations and represented one of the greatest threats to the Federation.",
  "Starfleet was the principal space exploration and defense organization of the United Federation of Planets. Headquartered in San Francisco, Earth, Starfleet operated thousands of starships and starbases across the galaxy. Its primary mission was peaceful exploration and scientific discovery but it also served as a defensive force. Starfleet Academy trained cadets from dozens of Federation member worlds.",
  "The Klingon Empire was a major political power in the Alpha Quadrant known for its warrior culture and honor-based society. The Klingons were a humanoid species with distinctive forehead ridges and a complex language called Klingonese. They were initially hostile to the Federation but later became allies. Key Klingon concepts included the bat'leth weapon and the afterlife dimension Sto-vo-kor.",
  "The United Federation of Planets was the largest interstellar political entity in the Alpha Quadrant. Founded in 2161 by Earth, Vulcan, Andoria, and Tellar, the Federation was based on principles of peace, cooperation, and mutual defense. It included hundreds of member worlds and maintained a policy of non-interference with pre-warp civilizations through the Prime Directive.",
];

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
      signal: AbortSignal.timeout(180_000),
    });
    if (!resp.ok) {
      return { ok: false, latency: Date.now() - start, status: resp.status };
    }
    const data = await resp.json();
    return {
      ok: true,
      latency: Date.now() - start,
      content: data?.message?.content ?? '',
      evalCount: data?.eval_count ?? 0,
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

async function fetchTunerStats() {
  try {
    const resp = await fetch(`${ORCHESTRATOR}/api/orchestrator/concurrency/stats`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

async function main() {
  console.log(`\n=== c=128 blast test ===`);
  console.log(`Model: ${MODEL}`);
  console.log(`Start: ${new Date().toISOString()}\n`);

  // Snapshot before
  const before = await fetchTunerStats();
  const bQwen = before?.pairs?.filter(p => p.model === MODEL) ?? [];
  const bCapSum = bQwen.reduce((s, p) => s + p.currentCap, 0);
  const bFloorSum = bQwen.reduce((s, p) => s + p.floor, 0);
  console.log(`Before: ${bQwen.length} pairs, total cap=${bCapSum}, total floor=${bFloorSum}`);

  const BATCHES = 8;
  const c = 128;
  const totalReqs = c * BATCHES;
  const latencies = [];
  let ok = 0;
  let fail = 0;
  const loadDurations = [];
  const globalStart = Date.now();

  for (let batch = 0; batch < BATCHES; batch++) {
    const batchTasks = [];
    for (let i = 0; i < c; i++) {
      const chunk = CHUNKS[(batch * c + i) % CHUNKS.length];
      batchTasks.push(sendRequest(buildPrompt('EXTRACT', chunk)));
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
    const done = (batch + 1) * c;
    process.stdout.write(`  batch ${batch + 1}/${BATCHES} done (${done}/${totalReqs} reqs, ${elapsed}s)\r`);
  }

  const wall = (Date.now() - globalStart) / 1000;
  const rps = wall > 0 ? (totalReqs / wall).toFixed(2) : 'N/A';
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);

  // Snapshot after
  const after = await fetchTunerStats();
  const aQwen = after?.pairs?.filter(p => p.model === MODEL) ?? [];
  const aCapSum = aQwen.reduce((s, p) => s + p.currentCap, 0);

  console.log(`\n\n=== Results ===`);
  console.log(`Reqs: ${totalReqs}  OK: ${ok}  Fail: ${fail}`);
  console.log(`Wall: ${wall.toFixed(1)}s  RPS: ${rps}`);
  console.log(`P50: ${p50}ms  P95: ${p95}ms  P99: ${p99}ms`);

  // Check for queue activation
  const timeouts = latencies.filter(l => l >= 180_000).length;
  const slowReqs = latencies.filter(l => l >= 120_000).length;
  console.log(`Requests >= 120s: ${slowReqs}  >= 180s (timeout): ${timeouts}`);

  // Tuner delta
  const raised = aQwen.filter(p => p.lastAdjustReason === 'raise').length;
  const lowered = aQwen.filter(p => p.lastAdjustReason?.startsWith('lower')).length;
  console.log(`\nTuner delta: pairs ${bQwen.length}→${aQwen.length}, cap ${bCapSum}→${aCapSum}`);
  console.log(`Raised: ${raised}  Lowered: ${lowered}`);

  // Show top 10 worst pair latencies
  const worst = [...aQwen].sort((a, b) => b.windowP95 - a.windowP95).slice(0, 10);
  console.log(`\nWorst 10 qwen3:0.6b pairs:`);
  console.log(`Server       Cap Floor  P50     P95     Reason`);
  for (const p of worst) {
    console.log(`${p.serverId.slice(0,12)} ${String(p.currentCap).padStart(3)} ${String(p.floor).padStart(5)} ${String(Math.round(p.windowP50)).padStart(6)}ms ${String(Math.round(p.windowP95)).padStart(6)}ms ${p.lastAdjustReason ?? 'none'}`);
  }

  // Detect queue engagement — look for deferred requests (latency >> model inference)
  const queueLikely = latencies.filter(l => l > 120_000).length;
  console.log(`\nQueue likely engaged: ${queueLikely} requests waited >120s`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
