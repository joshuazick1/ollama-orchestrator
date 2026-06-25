/**
 * honeypot-probes.ts
 * Tier 1 infrastructure honeypot detection probes.
 *
 * Implements three probes:
 * - SchemaConformanceProbe: checks Ollama API endpoint implementation
 * - ColdStartTimingProbe: measures cold-start latency fingerprint
 * - ZeroWidthWatermarkProbe: scans responses for invisible Unicode watermarks
 *
 * These are infrastructure-level signals that are difficult for honeypots to fake
 * without running a real Ollama server.
 */

import { fetchWithTimeout } from './fetch-with-timeout.js';
import { logger } from './logger.js';

// Shared types

export interface HoneypotProbeResult {
  serverId: string;
  serverUrl: string;
  schemaScore: number;
  coldStartScore: number;
  watermarkScore: number;
  compositeScore: number;
  verdict: 'clean' | 'suspicious' | 'flagged';
  evidence: HoneypotEvidence;
  timestamp: number;
}

export interface HoneypotEvidence {
  schema?: SchemaConformanceEvidence;
  coldStart?: ColdStartEvidence;
  watermark?: WatermarkEvidence;
}

export interface SchemaConformanceEvidence {
  implemented: string[];
  missing: string[];
  totalChecked: number;
}

export interface ColdStartEvidence {
  coldStartDetected: boolean;
  ttftMs: number | null;
  idleMs: number;
  modelUsed: string;
}

export interface WatermarkEvidence {
  found: string[];
  positions: number[];
  charCodes: number[];
}

export interface SchemaConformanceProbeOptions {
  timeoutMs?: number;
}

export interface SchemaConformanceResult {
  score: number;
  evidence: SchemaConformanceEvidence;
}

/**
 * Probes a server's Ollama API endpoint implementation to detect incomplete API surfaces.
 * Honeypots typically only implement /api/generate and /api/tags, missing obscure endpoints.
 */
export class SchemaConformanceProbe {
  private readonly timeoutMs: number;

  /** The 7 endpoints every real Ollama server must implement */
  private static readonly ENDPOINTS = [
    { method: 'GET', path: '/api/tags', body: null },
    { method: 'GET', path: '/api/ps', body: null },
    { method: 'POST', path: '/api/show', body: { model: 'nonexistent-model-for-probe' } },
    { method: 'GET', path: '/api/version', body: null },
    { method: 'POST', path: '/api/embed', body: { prompt: 'probe' } },
    {
      method: 'POST',
      path: '/api/create',
      body: { name: 'probe-nonexistent', from: 'nonexistent' },
    },
    {
      method: 'POST',
      path: '/api/chat',
      body: { model: 'nonexistent', messages: [{ role: 'user', content: 'ping' }] },
    },
  ] as const;

  constructor(options: SchemaConformanceProbeOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Probe all 7 Ollama endpoints and return a conformance score.
   * Score = 0 if all pass, +30 per missing endpoint (capped at 100).
   */
  async probe(serverUrl: string): Promise<SchemaConformanceResult> {
    const results = await Promise.allSettled(
      SchemaConformanceProbe.ENDPOINTS.map(async endpoint => {
        const url = `${serverUrl}${endpoint.path}`;
        try {
          const response = await fetchWithTimeout(url, {
            method: endpoint.method,
            headers: { 'Content-Type': 'application/json' },
            body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
            timeout: this.timeoutMs,
          });
          // Accept any non-5xx response as "implemented"
          // Some endpoints return 404 for nonexistent models but the endpoint exists
          return response.ok || response.status === 404 ? 'present' : 'absent';
        } catch {
          return 'absent';
        }
      })
    );

    const implemented: string[] = [];
    const missing: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const endpoint = SchemaConformanceProbe.ENDPOINTS[i];
      if (result.status === 'fulfilled' && result.value === 'present') {
        implemented.push(endpoint.path);
      } else {
        missing.push(endpoint.path);
      }
    }

    const score = Math.min(missing.length * 30, 100);

    logger.debug('[HoneypotProbe][SchemaConformance] probe completed', {
      serverUrl,
      implemented: implemented.length,
      missing: missing.length,
      score,
    });

    return {
      score,
      evidence: {
        implemented,
        missing,
        totalChecked: SchemaConformanceProbe.ENDPOINTS.length,
      },
    };
  }
}

export interface ColdStartTimingProbeOptions {
  /** Idle threshold in ms — if server has been idle longer, fire a cold-start probe */
  idleThresholdMs?: number;
  /** Expected minimum cold-start TTFT for a 7B model (ms) */
  minExpectedMs?: number;
  /** Expected maximum cold-start TTFT for a 7B model (ms) */
  maxExpectedMs?: number;
  timeoutMs?: number;
}

export interface ColdStartTimingResult {
  score: number;
  evidence: ColdStartEvidence;
}

/** Per-server last-probe timestamps (in-memory, resets on restart) */
const serverLastProbeAt = new Map<string, number>();

/**
 * Measures cold-start latency to detect honeypots with pre-loaded models.
 * Real Ollama cold-starts take 3-10s for a 7B model. Honeypots respond <1s.
 */
export class ColdStartTimingProbe {
  private readonly idleThresholdMs: number;
  private readonly minExpectedMs: number;
  private readonly maxExpectedMs: number;
  private readonly timeoutMs: number;

  constructor(options: ColdStartTimingProbeOptions = {}) {
    this.idleThresholdMs = options.idleThresholdMs ?? 5 * 60 * 1000;
    this.minExpectedMs = options.minExpectedMs ?? 3_000;
    this.maxExpectedMs = options.maxExpectedMs ?? 40_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Probe cold-start latency if the server has been idle.
   * Updates the lastProbeAt timestamp for the server.
   *
   * @param serverUrl  Full URL of the server
   * @param serverId   Server identifier (used for last-probe tracking)
   * @param model      Model name to probe with (should be available on server)
   */
  async probe(serverUrl: string, serverId: string, model: string): Promise<ColdStartTimingResult> {
    const now = Date.now();
    const lastProbe = serverLastProbeAt.get(serverId) ?? 0;
    const idleMs = now - lastProbe;

    const coldStartDetected = idleMs > this.idleThresholdMs;

    serverLastProbeAt.set(serverId, now);

    if (!coldStartDetected) {
      logger.debug('[HoneypotProbe][ColdStart] no cold-start needed, server was recently probed', {
        serverId,
        idleMs,
        thresholdMs: this.idleThresholdMs,
      });
      return {
        score: 0,
        evidence: {
          coldStartDetected: false,
          ttftMs: null,
          idleMs,
          modelUsed: model,
        },
      };
    }

    // Fire a cold-start probe: measure time-to-first-token for a simple prompt
    const probePrompt = 'Hello';
    const startTime = Date.now();

    try {
      const response = await fetchWithTimeout(`${serverUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: probePrompt,
          stream: true,
          options: { temperature: 0.9, num_predict: 8 },
        }),
        timeout: this.timeoutMs,
      });

      if (!response.ok) {
        logger.debug('[HoneypotProbe][ColdStart] generate request failed', {
          serverId,
          status: response.status,
        });
        return {
          score: 0,
          evidence: {
            coldStartDetected: true,
            ttftMs: null,
            idleMs,
            modelUsed: model,
          },
        };
      }

      // Read just the first chunk to measure TTFT
      const reader = response.body?.getReader();
      if (!reader) {
        return {
          score: 0,
          evidence: {
            coldStartDetected: true,
            ttftMs: null,
            idleMs,
            modelUsed: model,
          },
        };
      }

      try {
        const { value } = await reader.read();
        const ttftMs = Date.now() - startTime;

        // Cancel the stream — we only needed TTFT
        reader.cancel();

        let score = 0;
        if (ttftMs < 1000) {
          score = 50; // Suspicious: too fast for cold-start
        } else if (ttftMs > this.maxExpectedMs) {
          score = 30; // Anomalously slow
        }

        logger.debug('[HoneypotProbe][ColdStart] cold-start measured', {
          serverId,
          ttftMs,
          idleMs,
          score,
        });

        return {
          score,
          evidence: {
            coldStartDetected: true,
            ttftMs,
            idleMs,
            modelUsed: model,
          },
        };
      } finally {
        reader.cancel().catch(() => {
          // ignore cancel errors
        });
      }
    } catch (err) {
      logger.debug('[HoneypotProbe][ColdStart] probe failed', {
        serverId,
        error: String(err),
      });
      return {
        score: 0,
        evidence: {
          coldStartDetected: true,
          ttftMs: null,
          idleMs,
          modelUsed: model,
        },
      };
    }
  }

  /** Get the last probe timestamp for a server (exposed for testing) */
  static getLastProbeAt(serverId: string): number {
    return serverLastProbeAt.get(serverId) ?? 0;
  }

  /** Set the last probe timestamp (for testing) */
  static setLastProbeAt(serverId: string, timestamp: number): void {
    serverLastProbeAt.set(serverId, timestamp);
  }

  /** Reset all timestamps (for testing) */
  static resetAllTimestamps(): void {
    serverLastProbeAt.clear();
  }
}

export interface ZeroWidthWatermarkProbeOptions {}

export interface WatermarkResult {
  score: number;
  evidence: WatermarkEvidence;
}

const SUSPICIOUS_CHARS: Array<{ code: number; name: string }> = [
  { code: 0x200b, name: 'U+200B' },
  { code: 0x200c, name: 'U+200C' },
  { code: 0x2060, name: 'U+2060' },
  { code: 0x202f, name: 'U+202F' },
  { code: 0x00a0, name: 'U+00A0' },
  { code: 0xfeff, name: 'U+FEFF' },
];

export class ZeroWidthWatermarkProbe {
  constructor(_options: ZeroWidthWatermarkProbeOptions = {}) {}

  probe(responseText: string): WatermarkResult {
    const found: string[] = [];
    const positions: number[] = [];
    const charCodes: number[] = [];

    for (let i = 0; i < responseText.length; i++) {
      const code = responseText.charCodeAt(i);

      if (code === 0x200d) {
        if (!this.isEmojiZWJSequence(responseText, i)) {
          found.push('U+200D');
          positions.push(i);
          charCodes.push(code);
        }
        continue;
      }

      const suspicious = SUSPICIOUS_CHARS.find(s => s.code === code);
      if (suspicious) {
        found.push(suspicious.name);
        positions.push(i);
        charCodes.push(code);
      }
    }

    const score = Math.min(found.length * 40, 100);

    logger.debug('[HoneypotProbe][Watermark] scan completed', {
      foundCount: found.length,
      score,
    });

    return {
      score,
      evidence: {
        found,
        positions,
        charCodes,
      },
    };
  }

  /**
   * Check if a ZWJ at position `idx` is part of a legitimate emoji ZWJ sequence.
   * Allows: regional indicator pairs (U+1F1E6–U+1F1FF), family emoji, keycap emoji.
   */
  private isEmojiZWJSequence(text: string, idx: number): boolean {
    // Regional indicator ZWJ: flag emoji like 🇺🇸 (U+1F1FA U+1F1F8)
    // Check if previous char is a regional indicator (U+1F1E6 to U+1F1FF)
    if (idx > 0) {
      const prevCode = text.charCodeAt(idx - 1);
      if (prevCode >= 0x1f1e6 && prevCode <= 0x1f1ff) {
        return true;
      }
    }
    // Check if next char is a regional indicator
    if (idx < text.length - 1) {
      const nextCode = text.charCodeAt(idx + 1);
      if (nextCode >= 0x1f1e6 && nextCode <= 0x1f1ff) {
        return true;
      }
    }
    if (idx > 0) {
      const prevCode = text.charCodeAt(idx - 1);
      if (this.isEmojiCode(prevCode)) {
        return true;
      }
    }
    return false;
  }

  private isEmojiCode(code: number): boolean {
    return (
      (code >= 0x1f600 && code <= 0x1f64f) ||
      (code >= 0x1f300 && code <= 0x1f5ff) ||
      (code >= 0x1f680 && code <= 0x1f6ff) ||
      (code >= 0x1f900 && code <= 0x1f9ff) ||
      (code >= 0x1fa00 && code <= 0x1faff) ||
      (code >= 0x2600 && code <= 0x26ff) ||
      (code >= 0x2700 && code <= 0x27bf) ||
      (code >= 0x1f1e6 && code <= 0x1f1ff)
    );
  }
}

export interface HoneypotProbeRunnerOptions {
  schema?: SchemaConformanceProbeOptions;
  coldStart?: ColdStartTimingProbeOptions;
  /** Composite score weights: must sum to 1.0 */
  weights?: {
    schema: number;
    coldStart: number;
    watermark: number;
  };
}

const DEFAULT_WEIGHTS = {
  schema: 0.4,
  coldStart: 0.3,
  watermark: 0.3,
} as const;

/**
 * Orchestrates all three Tier 1 infrastructure probes in parallel for a server.
 */
export class HoneypotProbeRunner {
  private readonly schemaProbe: SchemaConformanceProbe;
  private readonly coldStartProbe: ColdStartTimingProbe;
  private readonly watermarkProbe: ZeroWidthWatermarkProbe;
  private readonly weights: { schema: number; coldStart: number; watermark: number };

  constructor(options: HoneypotProbeRunnerOptions = {}) {
    this.schemaProbe = new SchemaConformanceProbe(options.schema);
    this.coldStartProbe = new ColdStartTimingProbe(options.coldStart);
    this.watermarkProbe = new ZeroWidthWatermarkProbe();
    this.weights = {
      schema: options.weights?.schema ?? DEFAULT_WEIGHTS.schema,
      coldStart: options.weights?.coldStart ?? DEFAULT_WEIGHTS.coldStart,
      watermark: options.weights?.watermark ?? DEFAULT_WEIGHTS.watermark,
    };
  }

  /**
   * Run all Tier 1 probes against a server.
   *
   * The watermark probe requires a text response, so it is run second
   * using the result of a generate probe.
   *
   * @param serverUrl Full URL of the server (e.g. "http://192.168.1.50:11434")
   * @param serverId  Server identifier (for cold-start tracking)
   * @param model     Model name available on the server (for cold-start probe)
   * @param suspiciousThreshold Score threshold for "suspicious" verdict (default 30)
   * @param flaggedThreshold Score threshold for "flagged" verdict (default 70)
   */
  async runAll(
    serverUrl: string,
    serverId: string,
    model: string,
    suspiciousThreshold = 30,
    flaggedThreshold = 70
  ): Promise<HoneypotProbeResult> {
    const [schemaResult, coldStartResult] = await Promise.all([
      this.schemaProbe.probe(serverUrl),
      this.coldStartProbe.probe(serverUrl, serverId, model),
    ]);

    let watermarkResult: WatermarkResult = {
      score: 0,
      evidence: { found: [], positions: [], charCodes: [] },
    };
    try {
      const response = await fetchWithTimeout(`${serverUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: 'Say hello', stream: false }),
        timeout: 10_000,
      });
      if (response.ok) {
        const data = (await response.json()) as { response?: string };
        if (data.response) {
          watermarkResult = this.watermarkProbe.probe(data.response);
        }
      }
    } catch (err) {
      logger.debug('[HoneypotProbe][Runner] watermark probe failed', {
        serverId,
        error: String(err),
      });
    }

    const compositeScore = Math.round(
      schemaResult.score * this.weights.schema +
        coldStartResult.score * this.weights.coldStart +
        watermarkResult.score * this.weights.watermark
    );

    let verdict: HoneypotProbeResult['verdict'] = 'clean';
    if (compositeScore >= flaggedThreshold) {
      verdict = 'flagged';
    } else if (compositeScore >= suspiciousThreshold) {
      verdict = 'suspicious';
    }

    logger.info('[HoneypotProbe][Runner] server probed', {
      serverId,
      schemaScore: schemaResult.score,
      coldStartScore: coldStartResult.score,
      watermarkScore: watermarkResult.score,
      compositeScore,
      verdict,
    });

    return {
      serverId,
      serverUrl,
      schemaScore: schemaResult.score,
      coldStartScore: coldStartResult.score,
      watermarkScore: watermarkResult.score,
      compositeScore,
      verdict,
      evidence: {
        schema: schemaResult.evidence,
        coldStart: coldStartResult.evidence,
        watermark: watermarkResult.evidence,
      },
      timestamp: Date.now(),
    };
  }
}
