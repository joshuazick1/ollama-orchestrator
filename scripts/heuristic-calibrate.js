#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';

const DEFAULT_REPORTS_DIR = '.sisyphus/reports';
const TARGET_P95_MS = 3000;

function parseArgs(argv) {
  const args = { reportsDir: DEFAULT_REPORTS_DIR };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--reports-dir':
        args.reportsDir = next();
        break;
      case '--help':
      case '-h':
        console.log(
          'Usage: node scripts/heuristic-calibrate.js [--reports-dir PATH]\n' +
          `  --reports-dir   output dir for bench reports  default: ${DEFAULT_REPORTS_DIR}`
        );
        process.exit(0);
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
    }
  }
  return args;
}

async function readReportsDir(reportsDir) {
  const entries = await fs.readdir(reportsDir);
  return entries
    .filter((f) => /^bench-.+-fleet-.*\.json$/i.test(f))
    .sort();
}

async function readReportJson(reportPath) {
  const text = await fs.readFile(reportPath, 'utf8');
  return JSON.parse(text);
}

async function parseModelMemoryFloorTable() {
  const filePath = path.resolve('src/concurrency/model-memory-budget.ts');
  const text = await fs.readFile(filePath, 'utf8');
  const table = {};

  const lineRe = /^\s*['"]?([^'":\s]+)['"]?\s*:\s*(\d+)/;
  for (const line of text.split('\n')) {
    const m = line.match(lineRe);
    if (m) {
      table[m[1].trim()] = parseInt(m[2], 10);
    }
  }
  return table;
}

function detectFleetKnee(steps, targetP95Ms) {
  for (const s of steps) {
    if (s.fleetP95 != null && s.fleetP95 > targetP95Ms) {
      return { concurrency: s.concurrency, fleetP95: s.fleetP95 };
    }
  }
  return null;
}

function computePerServerKneeDistribution(allSteps, targetP95Ms) {
  const serverSteps = new Map();

  for (const step of allSteps) {
    if (!step.perServer) continue;
    for (const entry of step.perServer) {
      if (!entry.serverId || entry.p95 == null) continue;
      const arr = serverSteps.get(entry.serverId) || [];
      arr.push({ step: step.concurrency, p95: entry.p95 });
      serverSteps.set(entry.serverId, arr);
    }
  }

  const kneeCounts = new Map();
  for (const [, steps] of serverSteps) {
    steps.sort((a, b) => a.step - b.step);
    let knee = null;
    for (const { step, p95 } of steps) {
      if (p95 > targetP95Ms) {
        knee = step;
        break;
      }
    }
    if (knee === null && steps.length > 0) {
      knee = steps[steps.length - 1].step;
    }
    if (knee !== null) {
      kneeCounts.set(knee, (kneeCounts.get(knee) || 0) + 1);
    }
  }

  if (kneeCounts.size === 0) return null;

  const total = [...kneeCounts.values()].reduce((a, b) => a + b, 0);
  return [...kneeCounts.entries()]
    .map(([knee, count]) => ({ knee, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

function fmtDist(dist) {
  if (!dist) return 'N/A';
  return dist
    .map((d) => `${d.knee} (${d.pct}%)`)
    .join(', ');
}

function fmtDelta(heuristic, fleetKnee) {
  if (fleetKnee == null) return 'N/A';
  return ((heuristic / fleetKnee - 1) * 100).toFixed(1) + '%';
}

function recommendation(heuristic, fleetKnee) {
  if (fleetKnee == null) return 'NO DATA';
  const ratio = heuristic / fleetKnee;
  if (Math.abs(ratio - 1) < 0.25) return 'OK';
  if (ratio < 0.75) return 'RAISE';
  if (ratio > 1.25) return 'LOWER';
  return 'OK';
}

async function main() {
  const args = parseArgs(process.argv);
  const reportsDir = path.resolve(args.reportsDir);
  const outPath = path.join(reportsDir, 'heuristic-calibration.md');

  let floorTable;
  try {
    floorTable = await parseModelMemoryFloorTable();
  } catch (err) {
    console.error('[heuristic-calibrate] Could not parse MODEL_MEMORY_FLOOR_TABLE:', err.message);
    process.exit(1);
  }

  let reportFiles;
  try {
    reportFiles = await readReportsDir(reportsDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      reportFiles = [];
    } else {
      throw err;
    }
  }

  if (reportFiles.length === 0) {
    const stub =
      '# Heuristic Calibration Report\n\n**Generated:** ' +
      `${new Date().toISOString()}\n\n` +
      `No bench reports found in \`${reportsDir}\`.\n\n` +
      'Run Task 10 (`bench-concurrency.js`) first to generate benchmark data.\n';
    await fs.writeFile(outPath, stub, 'utf8');
    console.log(`[heuristic-calibrate] No reports found. Stub written to ${outPath}`);
    return;
  }

  const rows = [];
  let okCount = 0, raiseCount = 0, lowerCount = 0, noDataCount = 0;

  for (const file of reportFiles) {
    const reportPath = path.join(reportsDir, file);
    let report;
    try {
      report = await readReportJson(reportPath);
    } catch (err) {
      console.warn(`[heuristic-calibrate] Skipping ${file}: ${err.message}`);
      continue;
    }

    const model = report.model || file.replace(/^bench-|-\d{4}-\d{2}-\d{2}\.json$/gi, '');
    const heuristic = floorTable[model];

    let fleetKnee = null;
    if (report.knee && report.knee.concurrency != null) {
      fleetKnee = report.knee.concurrency;
    } else if (report.steps && Array.isArray(report.steps)) {
      const detected = detectFleetKnee(report.steps, TARGET_P95_MS);
      if (detected) fleetKnee = detected.concurrency;
    }

    const perServerDist =
      report.steps && Array.isArray(report.steps)
        ? computePerServerKneeDistribution(report.steps, TARGET_P95_MS)
        : null;

    const rec = recommendation(heuristic ?? 0, fleetKnee);
    if (rec === 'OK') okCount++;
    else if (rec === 'RAISE') raiseCount++;
    else if (rec === 'LOWER') lowerCount++;
    else noDataCount++;

    rows.push({
      model,
      fleetKnee,
      perServerDist,
      heuristicFloor: heuristic ?? '?',
      delta: fmtDelta(heuristic ?? 0, fleetKnee),
      recommendation: rec,
    });
  }

  const recOrder = { RAISE: 0, LOWER: 1, 'NO DATA': 2, OK: 3 };
  rows.sort((a, b) => (recOrder[a.recommendation] ?? 9) - (recOrder[b.recommendation] ?? 9));

  const lines = [];
  lines.push('# Heuristic Calibration Report\n');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Reports evaluated:** ${reportFiles.length}`);
  lines.push(`**Fleet knee threshold:** ${TARGET_P95_MS}ms\n`);
  lines.push('## Summary\n');
  lines.push(
    `| Category | count |\n|---|---|\n` +
    `| OK | ${okCount} |\n` +
    `| RAISE | ${raiseCount} |\n` +
    `| LOWER | ${lowerCount} |\n` +
    `| NO DATA | ${noDataCount} |\n`
  );
  lines.push('\n## Per-Model Calibration\n');
  lines.push(
    '| model | fleet-knee | per-server-knee-distribution | heuristic-floor | delta | recommendation |\n' +
    '|---|---|---|---|---|---|\n'
  );

  for (const r of rows) {
    const fleetKneeStr = r.fleetKnee != null ? String(r.fleetKnee) : 'N/A';
    const hf = r.heuristicFloor !== '?' ? String(r.heuristicFloor) : 'N/A';
    lines.push(
      `| ${r.model} | ${fleetKneeStr} | ${fmtDist(r.perServerDist)} | ${hf} | ${r.delta} | ${r.recommendation} |\n`
    );
  }

  await fs.writeFile(outPath, lines.join(''), 'utf8');
  console.log(`[heuristic-calibrate] Report written to ${outPath}`);
  console.log(`  Models: ${rows.length} | OK=${okCount} RAISE=${raiseCount} LOWER=${lowerCount} NO_DATA=${noDataCount}`);
}

main().catch((err) => {
  console.error('[heuristic-calibrate] fatal:', err?.message || err);
  process.exit(1);
});
