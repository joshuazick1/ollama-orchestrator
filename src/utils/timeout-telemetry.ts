import { appendFileSync, mkdirSync } from 'fs';

interface TelemetryEntry {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

const LOG_DIR = process.env.TIMEOUT_TELEMETRY_LOG_DIR ?? './logs';
const TELEMETRY_ENABLED = process.env.TIMEOUT_TELEMETRY_ENABLED !== 'false';
const CHUNK_GAP_INTERVAL_MS = parseInt(
  process.env.TIMEOUT_TELEMETRY_CHUNK_GAP_INTERVAL_MS ?? '30000',
  10
);

let currentLogDate: string | null = null;

function writeEntry(entry: TelemetryEntry): void {
  if (!TELEMETRY_ENABLED) {
    return;
  }
  try {
    const dateStr = new Date().toISOString().split('T')[0];
    if (dateStr !== currentLogDate) {
      currentLogDate = dateStr;
      try {
        mkdirSync(LOG_DIR, { recursive: true });
      } catch {
        // dir may already exist
      }
    }
    const logFile = `${LOG_DIR}/timeout-tuning-${dateStr}.log`;
    appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch {
    // silent - telemetry failures should not crash requests
  }
}

export interface RequestCompleteData {
  serverId: string;
  model: string;
  protocol: 'ollama' | 'openai' | 'anthropic';
  endpoint: string;
  isStreaming: boolean;
  configuredTimeoutMs: number;
  clientHeaderTimeoutMs?: number;
  effectiveTimeoutMs: number;
  timeToFirstTokenMs?: number;
  totalDurationMs: number;
  tokensGenerated?: number;
  tokensPrompt?: number;
  status: 'success' | 'timeout' | 'error' | 'client_disconnect' | 'stall_handoff';
  httpStatus?: number;
  errorMessage?: string;
  retryAttempt: number;
  failoverServer?: string;
}

export function recordRequestComplete(data: RequestCompleteData): void {
  writeEntry({ type: 'REQUEST_COMPLETE', timestamp: new Date().toISOString(), ...data });
}

export interface TimeoutAdaptedData {
  serverId: string;
  model: string;
  previousTimeoutMs: number;
  newTimeoutMs: number;
  baseTimeoutMs: number;
  trigger:
    | 'response_time'
    | 'failure_escalation'
    | 'decay'
    | 'manual_reset'
    | 'default_update'
    | 'active_test_timeout'
    | 'idle_reset';
  observedResponseTimeMs?: number;
  isActiveTest: boolean;
  multiplier: number;
}

export function recordTimeoutAdapted(data: TimeoutAdaptedData): void {
  writeEntry({ type: 'TIMEOUT_ADAPTED', timestamp: new Date().toISOString(), ...data });
}

export interface TimeoutFiredData {
  serverId: string;
  model: string;
  protocol: 'ollama' | 'openai' | 'anthropic';
  endpoint: string;
  isStreaming: boolean;
  timeoutType: 'connection' | 'activity' | 'non_streaming';
  configuredTimeoutMs: number;
  elapsedMs: number;
  retryAttempt: number;
  circuitBreakerState?: string;
}

export function recordTimeoutFired(data: TimeoutFiredData): void {
  writeEntry({ type: 'TIMEOUT_FIRED', timestamp: new Date().toISOString(), ...data });
}

export interface StallDetectedData {
  serverId: string;
  model: string;
  protocol: 'ollama' | 'openai' | 'anthropic';
  stallThresholdMs: number;
  timeSinceLastChunkMs: number;
  timeToFirstTokenMs: number;
  totalTokensBeforeStall: number;
  totalDurationMs: number;
  handoffAttempted: boolean;
  handoffSuccess: boolean;
  handoffTargetServer?: string;
}

export function recordStallDetected(data: StallDetectedData): void {
  writeEntry({ type: 'STALL_DETECTED', timestamp: new Date().toISOString(), ...data });
}

export interface StreamingChunkGapData {
  serverId: string;
  model: string;
  protocol: 'ollama' | 'openai' | 'anthropic';
  chunkCount: number;
  totalTokensSoFar: number;
  timeSinceFirstTokenMs: number;
  timeSinceLastChunkMs: number;
  maxChunkGapMs: number;
  avgChunkGapMs: number;
  effectiveTimeoutMs: number;
  activityTimeoutMs: number;
  approachingTimeout: boolean;
}

export function recordStreamingChunkGap(data: StreamingChunkGapData): void {
  writeEntry({ type: 'STREAMING_CHUNK_GAP', timestamp: new Date().toISOString(), ...data });
}

export { CHUNK_GAP_INTERVAL_MS };
