/**
 * collect-metrics.ts
 *
 * Captures server-side metrics snapshots from the orchestrator for stress testing
 * and performance analysis. Outputs a single JSON file per invocation.
 *
 * Usage:
 *   npx tsx scripts/stress/collect-metrics.ts --label before-phase1 --output .sisyphus/evidence/stress-
 *
 * Flags:
 *   --label   Required. A label to identify this metrics snapshot.
 *   --output  Required. Output file prefix (without extension). Creates {output}{label}.json
 */

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:5100';
const TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface HealthResponse {
  status: string;
  healthyServers?: number;
  reason?: string;
  totalServers?: number;
}

interface StatsData {
  uptime: number;
  totalServers: number;
  healthyServers: number;
  totalModels: number;
  inFlightRequests: number;
  circuitBreakers: Record<string, { state: string; failureCount: number }>;
  circuitBreakersByState: Record<string, number>;
}

interface StatsResponse {
  success: boolean;
  stats: StatsData;
}

interface CircuitBreakersByState {
  OPEN: number;
  CLOSED: number;
  HALF_OPEN: number;
  UNKNOWN: number;
  [key: string]: number;
}

interface CircuitBreakerEntry {
  serverId: string;
  model: string;
  state: string;
  uiState: string;
  failureCount: number;
  [key: string]: unknown;
}

interface CircuitBreakersResponse {
  success: boolean;
  circuitBreakers: CircuitBreakerEntry[];
  byState: CircuitBreakersByState;
}

interface MetricsResponse {
  success: boolean;
  timestamp: number;
  global: Record<string, unknown>;
  servers?: Record<string, unknown>;
}

interface CbSummary {
  total: number;
  byState: Record<string, number>;
}

interface ProcessMetrics {
  pid: number | null;
  rss: number | null;
  vsz: number | null;
  comm: string | null;
}

interface MetricsSnapshot {
  timestamp: string;
  label: string;
  health: { data: HealthResponse | null; error: string | null };
  stats_summary: { data: StatsData | null; error: string | null };
  cb_summary: { data: CbSummary | null; error: string | null };
  prometheus_metrics: { data: string | null; error: string | null };
  process: ProcessMetrics;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { label: string; output: string } {
  const args = process.argv.slice(2);
  let label: string | undefined;
  let output: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--label' && i + 1 < args.length) {
      label = args[i + 1];
      i++;
    } else if (args[i] === '--output' && i + 1 < args.length) {
      output = args[i + 1];
      i++;
    }
  }

  if (!label) {
    console.error('Error: --label is required');
    process.exit(1);
  }

  if (!output) {
    console.error('Error: --output is required');
    process.exit(1);
  }

  return { label, output };
}

// ---------------------------------------------------------------------------
// Fetch with timeout
// ---------------------------------------------------------------------------

async function fetchWithTimeout<T>(
  url: string,
  parseJson = true
): Promise<{ data: T | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { data: null, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    if (parseJson) {
      const json = (await response.json()) as T;
      return { data: json, error: null };
    } else {
      const text = await response.text();
      return { data: text as T, error: null };
    }
  } catch (err) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : String(err);
    return { data: null, error: message };
  }
}

// ---------------------------------------------------------------------------
// Process metrics
// ---------------------------------------------------------------------------

function getProcessMetrics(): Promise<ProcessMetrics> {
  return new Promise(resolve => {
    // Find the node process running dist/index.js
    exec(
      "ps -o pid,rss,vsz,comm -p $(pgrep -f 'node.*dist/index.js' | head -1) 2>/dev/null | tail -1",
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve({ pid: null, rss: null, vsz: null, comm: null });
          return;
        }

        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 4) {
          resolve({
            pid: parseInt(parts[0], 10) || null,
            rss: parseInt(parts[1], 10) || null,
            vsz: parseInt(parts[2], 10) || null,
            comm: parts[3] || null,
          });
        } else {
          resolve({ pid: null, rss: null, vsz: null, comm: null });
        }
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Extract CB summary from circuit-breakers response
// ---------------------------------------------------------------------------

function extractCbSummary(data: CircuitBreakersResponse | null): {
  data: CbSummary | null;
  error: string | null;
} {
  if (!data) {
    return { data: null, error: null };
  }

  const total = data.circuitBreakers?.length ?? 0;
  const byState: Record<string, number> = {};

  if (data.byState) {
    for (const [state, count] of Object.entries(data.byState)) {
      if (count > 0) {
        byState[state] = count;
      }
    }
  }

  return { data: { total, byState }, error: null };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { label, output } = parseArgs();
  const timestamp = new Date().toISOString();

  // Fetch all endpoints in parallel
  const [healthResult, statsResult, cbResult, promResult, metricsResult] = await Promise.all([
    fetchWithTimeout<HealthResponse>(`${BASE_URL}/health/ready`),
    fetchWithTimeout<StatsResponse>(`${BASE_URL}/api/orchestrator/stats`),
    fetchWithTimeout<CircuitBreakersResponse>(`${BASE_URL}/api/orchestrator/circuit-breakers`),
    fetchWithTimeout<string>(`${BASE_URL}/metrics`, false),
    fetchWithTimeout<MetricsResponse>(`${BASE_URL}/api/orchestrator/metrics`),
    getProcessMetrics(),
  ]);

  // Build output directory if needed
  const outputPath = output.endsWith(path.sep) ? output : output;
  const dir = path.dirname(outputPath);
  if (dir && dir !== '.' && dir !== path.sep) {
    await fs.mkdir(dir, { recursive: true });
  }

  // Extract CB summary
  const cbSummaryResult = extractCbSummary(cbResult.data);

  // Stats endpoint wraps data in { success, stats }
  const statsData = statsResult.data?.stats ?? null;

  // Build snapshot
  const snapshot: MetricsSnapshot = {
    timestamp,
    label,
    health: healthResult,
    stats_summary: { data: statsData, error: statsResult.error },
    cb_summary: cbSummaryResult,
    prometheus_metrics: promResult,
    process: await getProcessMetrics(),
  };

  // Write output
  const outputFile = `${output}${label}.json`;
  await fs.writeFile(outputFile, JSON.stringify(snapshot, null, 2));

  // Print one-line summary
  const healthSize = JSON.stringify(healthResult).length;
  const statsSize = JSON.stringify(statsResult).length;
  const cbSize = JSON.stringify(cbSummaryResult).length;
  const promSize = promResult.data?.length ?? 0;
  const procStr = snapshot.process.pid
    ? `pid=${snapshot.process.pid} rss=${snapshot.process.rss}KB`
    : 'pid=n/a';

  console.log(
    `${label} ${timestamp} health=${healthSize}B stats=${statsSize}B cb=${cbSize}B prom=${promSize}B ${procStr}`
  );

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
