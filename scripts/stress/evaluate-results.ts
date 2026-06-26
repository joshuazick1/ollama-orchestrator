/**
 * evaluate-results.ts
 * Stress test result evaluator - validates JSON against Zod schema and emits verdicts
 */

import { z } from 'zod';
import { readFileSync, writeFileSync } from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

const stressResultSchema = z.object({
  phase: z.string(),
  requests_sent: z.number().int().min(0),
  requests_completed: z.number().int().min(0),
  p50_ms: z.number().min(0),
  p95_ms: z.number().min(0),
  p99_ms: z.number().min(0),
  error_rate: z.number().min(0).max(1),
  http_5xx_count: z.number().int().min(0),
  in_flight_peak: z.number().int().min(0),
  memory_growth_pct: z.number().min(0).max(100),
  cb_healthy_count: z.number().int().min(0),
  cb_total_count: z.number().int().min(1),
  expected_overflow: z.boolean().optional().default(false),
});

export type StressResult = z.infer<typeof stressResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds
// ─────────────────────────────────────────────────────────────────────────────

interface ThresholdDef {
  pass: number;
  warn: number;
}

const THRESHOLDS = {
  p99_latency_ms: { pass: 2000, warn: 5000 },
  error_rate: { pass: 0.01, warn: 0.05 },
  http_5xx_count: { pass: 0, warn: 10 },
  memory_growth_pct: { pass: 20, warn: 50 },
  cb_healthy_pct: { pass: 100, warn: 95 },
} as const;

type Verdict = 'PASS' | 'WARN' | 'FAIL';

interface CategoryResult {
  value: number;
  threshold_pass: number;
  threshold_warn: number;
  verdict: Verdict;
  message: string;
}

interface EvaluationResult {
  verdict: Verdict;
  categories: {
    latency: CategoryResult;
    errors: CategoryResult;
    http_5xx: CategoryResult;
    memory: CategoryResult;
    circuit_breaker: CategoryResult;
  };
  aggregate_score: number;
  summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation logic
// ─────────────────────────────────────────────────────────────────────────────

function evaluateLatency(p99_ms: number): CategoryResult {
  const { pass, warn } = THRESHOLDS.p99_latency_ms;
  let verdict: Verdict;
  if (p99_ms < pass) verdict = 'PASS';
  else if (p99_ms < warn) verdict = 'WARN';
  else verdict = 'FAIL';
  return {
    value: p99_ms,
    threshold_pass: pass,
    threshold_warn: warn,
    verdict,
    message: `p99 latency: ${p99_ms}ms [${verdict}]`,
  };
}

function evaluateErrorRate(error_rate: number, expected_overflow: boolean): CategoryResult {
  if (expected_overflow) {
    return {
      value: error_rate,
      threshold_pass: THRESHOLDS.error_rate.pass,
      threshold_warn: THRESHOLDS.error_rate.warn,
      verdict: 'PASS',
      message: `error rate: ${(error_rate * 100).toFixed(2)}% [SKIPPED - expected_overflow=true]`,
    };
  }
  const { pass, warn } = THRESHOLDS.error_rate;
  let verdict: Verdict;
  if (error_rate < pass) verdict = 'PASS';
  else if (error_rate < warn) verdict = 'WARN';
  else verdict = 'FAIL';
  return {
    value: error_rate,
    threshold_pass: pass,
    threshold_warn: warn,
    verdict,
    message: `error rate: ${(error_rate * 100).toFixed(2)}% [${verdict}]`,
  };
}

function evaluateHttp5xx(http_5xx_count: number): CategoryResult {
  const { pass, warn } = THRESHOLDS.http_5xx_count;
  let verdict: Verdict;
  if (http_5xx_count <= pass) verdict = 'PASS';
  else if (http_5xx_count < warn) verdict = 'WARN';
  else verdict = 'FAIL';
  return {
    value: http_5xx_count,
    threshold_pass: pass,
    threshold_warn: warn,
    verdict,
    message: `5xx count: ${http_5xx_count} [${verdict}]`,
  };
}

function evaluateMemoryGrowth(memory_growth_pct: number): CategoryResult {
  const { pass, warn } = THRESHOLDS.memory_growth_pct;
  let verdict: Verdict;
  if (memory_growth_pct < pass) verdict = 'PASS';
  else if (memory_growth_pct < warn) verdict = 'WARN';
  else verdict = 'FAIL';
  return {
    value: memory_growth_pct,
    threshold_pass: pass,
    threshold_warn: warn,
    verdict,
    message: `memory growth: ${memory_growth_pct.toFixed(1)}% [${verdict}]`,
  };
}

function evaluateCircuitBreaker(cb_healthy_count: number, cb_total_count: number): CategoryResult {
  const healthy_pct = (cb_healthy_count / cb_total_count) * 100;
  const { pass, warn } = THRESHOLDS.cb_healthy_pct;
  let verdict: Verdict;
  if (healthy_pct >= pass) verdict = 'PASS';
  else if (healthy_pct >= warn) verdict = 'WARN';
  else verdict = 'FAIL';
  return {
    value: healthy_pct,
    threshold_pass: pass,
    threshold_warn: warn,
    verdict,
    message: `CB healthy: ${cb_healthy_count}/${cb_total_count} (${healthy_pct.toFixed(1)}%) [${verdict}]`,
  };
}

function worstVerdict(v1: Verdict, v2: Verdict): Verdict {
  const order: Record<Verdict, number> = { PASS: 0, WARN: 1, FAIL: 2 };
  return order[v1] >= order[v2] ? v1 : v2;
}

function computeAggregateScore(categories: EvaluationResult['categories']): number {
  // Score: 100 = all PASS, 50 = all WARN, 0 = any FAIL
  const verdicts = [
    categories.latency.verdict,
    categories.errors.verdict,
    categories.http_5xx.verdict,
    categories.memory.verdict,
    categories.circuit_breaker.verdict,
  ];
  if (verdicts.some(v => v === 'FAIL')) return 0;
  if (verdicts.every(v => v === 'PASS')) return 100;
  return 50;
}

export function evaluate(result: StressResult): EvaluationResult {
  const categories = {
    latency: evaluateLatency(result.p99_ms),
    errors: evaluateErrorRate(result.error_rate, result.expected_overflow ?? false),
    http_5xx: evaluateHttp5xx(result.http_5xx_count),
    memory: evaluateMemoryGrowth(result.memory_growth_pct),
    circuit_breaker: evaluateCircuitBreaker(result.cb_healthy_count, result.cb_total_count),
  };

  const aggregate_score = computeAggregateScore(categories);

  const allVerdicts = Object.values(categories).map(c => c.verdict);
  const verdict = allVerdicts.reduce(worstVerdict, 'PASS');

  const passCount = allVerdicts.filter(v => v === 'PASS').length;
  const warnCount = allVerdicts.filter(v => v === 'WARN').length;
  const failCount = allVerdicts.filter(v => v === 'FAIL').length;

  const summary =
    `${result.phase}: ${passCount} PASS, ${warnCount} WARN, ${failCount} FAIL ` +
    `(score: ${aggregate_score})`;

  return { verdict, categories, aggregate_score, summary };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

interface CliArgs {
  input: string;
  output?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { input: '' };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && i + 1 < argv.length) {
      args.input = argv[++i];
    } else if (arg === '--output' && i + 1 < argv.length) {
      args.output = argv[++i];
    }
  }
  if (!args.input) {
    console.error('Usage: npx tsx evaluate-results.ts --input <path.json> [--output <path.json>]');
    process.exit(1);
  }
  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main(argv: string[]): void {
  const { input, output } = parseArgs(argv);

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(readFileSync(input, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read/parse input file: ${input}`, err);
    process.exit(2);
  }

  const parsed = stressResultSchema.safeParse(rawJson);
  if (!parsed.success) {
    console.error('Input validation failed:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(2);
  }

  const result = evaluate(parsed.data);

  const jsonOutput = JSON.stringify(result, null, 2);

  if (output) {
    writeFileSync(output, jsonOutput);
    console.log(`[VERDICT] ${result.summary}`);
  } else {
    console.log(jsonOutput);
  }

  // Human-readable one-line summary
  console.log(`[VERDICT] ${result.summary}`);

  // Exit code: 0 if all PASS/WARN, 1 if any FAIL
  process.exit(result.verdict === 'FAIL' ? 1 : 0);
}

main(process.argv);
