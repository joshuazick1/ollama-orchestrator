

const ORCHESTRATOR = 'http://localhost:5100';
const MODEL = 'qwen3:0.6b';
const KEEP = process.env.KEEP_ALIVE || '';

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

function buildPrompt(c) {
  return [
    { role: 'system', content: 'Extract JSON: characters (array), location (string|null), era (string). Return ONLY valid JSON.' },
    { role: 'user', content: `Text:\n${c}\n\nJSON:` },
  ];
}

async function send(messages) {
  const s = Date.now();
  const body = { model: MODEL, messages, options: { think: false }, stream: false };
  if (KEEP) body.keep_alive = KEEP;
  try {
    const r = await fetch(`${ORCHESTRATOR}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
    if (!r.ok) return { ok: false, l: Date.now() - s, s: r.status };
    const d = await r.json();
    return { ok: true, l: Date.now() - s, e: d.eval_count, load: d.load_duration };
  } catch (err) { return { ok: false, l: Date.now() - s, s: 0 }; }
}

function p(arr, q) { if (!arr.length) return 0; const s = [...arr].sort((a,b)=>a-b); return s[Math.max(0, Math.ceil(q/100*s.length)-1)]; }

async function run(c, batches) {
  const reqs = c * batches;
  const lats = []; let ok = 0;
  const t = Date.now();
  for (let b = 0; b < batches; b++) {
    const tasks = [];
    for (let i = 0; i < c; i++) tasks.push(send(buildPrompt(CHUNKS[(b*c+i)%CHUNKS.length])));
    const r = await Promise.allSettled(tasks);
    for (const x of r) { if (x.status==='fulfilled') { lats.push(x.value.l); if (x.value.ok) ok++; } }
  }
  const wall = (Date.now()-t)/1000;
  return { c, reqs, ok, rps: (reqs/wall).toFixed(2), p50: p(lats,50), p95: p(lats,95), p99: p(lats,99), wall: wall.toFixed(1) };
}

const levels = [64, 128, 192, 256];
const batches = 8;
const rows = [];
for (const c of levels) {
  process.stdout.write(`  c=${c}...`);
  rows.push(await run(c, batches));
  console.log(` ${rows[rows.length-1].rps} RPS`);
}
console.log('\n=== Sweep results ===');
console.log('c | Reqs | OK | RPS | P50  | P95  | P99  | Wall');
for (const r of rows) {
  console.log(`${r.c.toString().padStart(2)} | ${r.reqs.toString().padStart(4)} | ${r.ok.toString().padStart(2)} | ${r.rps.padStart(4)} | ${r.p50.toString().padStart(4)}ms | ${r.p95.toString().padStart(5)}ms | ${r.p99.toString().padStart(5)}ms | ${r.wall}s`);
}
