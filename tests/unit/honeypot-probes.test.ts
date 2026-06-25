import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/utils/fetch-with-timeout.js');
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  SchemaConformanceProbe,
  ColdStartTimingProbe,
  ZeroWidthWatermarkProbe,
  HoneypotProbeRunner,
} from '../../../src/utils/honeypot-probes.js';
import { fetchWithTimeout } from '../../../src/utils/fetch-with-timeout.js';

function mockResponse(status = 200, body?: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body ?? {}),
  } as unknown as Response);
}

describe('SchemaConformanceProbe', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as unknown as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('scores 0 when all 7 endpoints return 200', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as unknown as Response);

    const probe = new SchemaConformanceProbe({ timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434');

    expect(result.score).toBe(0);
    expect(result.evidence.implemented).toHaveLength(7);
    expect(result.evidence.missing).toHaveLength(0);
    expect(result.evidence.totalChecked).toBe(7);
  });

  it('scores 30 when 1 endpoint is missing', async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/tags')) {
        throw new Error('network error');
      }
      return mockResponse(200, {});
    });

    const probe = new SchemaConformanceProbe({ timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434');

    expect(result.score).toBe(30);
    expect(result.evidence.missing).toContain('/api/tags');
    expect(result.evidence.implemented).toHaveLength(6);
  });

  it('scores 90 when 3 endpoints are missing', async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/version') || u.includes('/api/create') || u.includes('/api/chat')) {
        throw new Error('network error');
      }
      return mockResponse(200, {});
    });

    const probe = new SchemaConformanceProbe({ timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434');

    expect(result.score).toBe(90);
    expect(result.evidence.missing).toHaveLength(3);
  });

  it('caps score at 100 when all 7 endpoints are missing', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));

    const probe = new SchemaConformanceProbe({ timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434');

    expect(result.score).toBe(100);
    expect(result.evidence.missing).toHaveLength(7);
  });

  it('treats 404 as present (endpoint exists but model not found)', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'model not found' }),
    } as unknown as Response);

    const probe = new SchemaConformanceProbe({ timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434');

    expect(result.score).toBe(0);
    expect(result.evidence.implemented).toHaveLength(7);
  });
});

describe('ColdStartTimingProbe', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as unknown as Response);
    ColdStartTimingProbe.resetAllTimestamps();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('returns score 0 when server was recently probed (no cold-start)', async () => {
    ColdStartTimingProbe.setLastProbeAt('srv-test', Date.now());

    const probe = new ColdStartTimingProbe({ idleThresholdMs: 5 * 60 * 1000 });
    const result = await probe.probe('http://localhost:11434', 'srv-test', 'llama3:8b');

    expect(result.score).toBe(0);
    expect(result.evidence.coldStartDetected).toBe(false);
    expect(result.evidence.ttftMs).toBeNull();
  });

  it('returns coldStartDetected=true when idle threshold exceeded', async () => {
    ColdStartTimingProbe.setLastProbeAt('srv-test', Date.now() - 10 * 60 * 1000);

    const mockStreamReader = {
      read: vi.fn().mockResolvedValue({
        done: false,
        value: new Uint8Array(Buffer.from('data: {"response":"hi"}\n\n')),
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => mockStreamReader },
    } as unknown as Response);

    const probe = new ColdStartTimingProbe({
      idleThresholdMs: 5 * 60 * 1000,
      minExpectedMs: 3000,
      maxExpectedMs: 40000,
    });

    const result = await probe.probe('http://localhost:11434', 'srv-test', 'llama3:8b');

    expect(result.evidence.coldStartDetected).toBe(true);
  });

  it('resets timestamps', () => {
    ColdStartTimingProbe.setLastProbeAt('srv1', 1000);
    ColdStartTimingProbe.setLastProbeAt('srv2', 2000);
    ColdStartTimingProbe.resetAllTimestamps();
    expect(ColdStartTimingProbe.getLastProbeAt('srv1')).toBe(0);
    expect(ColdStartTimingProbe.getLastProbeAt('srv2')).toBe(0);
  });
});

describe('ZeroWidthWatermarkProbe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scores 0 for clean text with no invisible characters', () => {
    const probe = new ZeroWidthWatermarkProbe();
    const result = probe.probe('Hello, world! This is a normal response.');

    expect(result.score).toBe(0);
    expect(result.evidence.found).toHaveLength(0);
    expect(result.evidence.positions).toHaveLength(0);
  });

  it('scores 40 for one ZWSP (U+200B)', () => {
    const probe = new ZeroWidthWatermarkProbe();
    const result = probe.probe('Hello\u200bWorld');

    expect(result.score).toBe(40);
    expect(result.evidence.found).toContain('U+200B');
    expect(result.evidence.positions).toHaveLength(1);
  });

  it('scores 80 for two different invisible characters', () => {
    const probe = new ZeroWidthWatermarkProbe();
    const result = probe.probe('Hello\u200bWorld\u202Ftest');

    expect(result.score).toBe(80);
    expect(result.evidence.found).toContain('U+200B');
    expect(result.evidence.found).toContain('U+202F');
    expect(result.evidence.charCodes).toContain(0x200b);
    expect(result.evidence.charCodes).toContain(0x202f);
  });

  it('caps score at 100 for 3+ suspicious characters', () => {
    const probe = new ZeroWidthWatermarkProbe();
    const result = probe.probe('\u200b\u200c\u200d\u2060');

    expect(result.score).toBe(100);
    expect(result.evidence.found).toHaveLength(4);
  });

  it('allows ZWJ in emoji regional indicator sequences (flags)', () => {
    const probe = new ZeroWidthWatermarkProbe();
    const result = probe.probe('\u{1F1FA}\u{1F1F8}');

    expect(result.score).toBe(0);
    expect(result.evidence.found).not.toContain('U+200D');
  });

  it('flags ZWJ in non-emoji context as suspicious', () => {
    const probe = new ZeroWidthWatermarkProbe();
    const result = probe.probe('hello\u200dworld');

    expect(result.score).toBe(40);
    expect(result.evidence.found).toContain('U+200D');
  });

  it('detects U+00A0 (NBSP)', () => {
    const probe = new ZeroWidthWatermarkProbe();
    const result = probe.probe('Hello\u00a0World');

    expect(result.score).toBe(40);
    expect(result.evidence.found).toContain('U+00A0');
  });

  it('detects U+FEFF (BOM)', () => {
    const probe = new ZeroWidthWatermarkProbe();
    const result = probe.probe('\ufeffHidden text');

    expect(result.score).toBe(40);
    expect(result.evidence.found).toContain('U+FEFF');
  });

  it('detects U+2060 (Word Joiner)', () => {
    const probe = new ZeroWidthWatermarkProbe();
    const result = probe.probe('Hello\u2060World');

    expect(result.score).toBe(40);
    expect(result.evidence.found).toContain('U+2060');
  });

  it('detects U+200C (ZWNJ)', () => {
    const probe = new ZeroWidthWatermarkProbe();
    const result = probe.probe('Hello\u200cWorld');

    expect(result.score).toBe(40);
    expect(result.evidence.found).toContain('U+200C');
  });
});

describe('HoneypotProbeRunner', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ response: 'normal text' }),
    } as unknown as Response);
    ColdStartTimingProbe.resetAllTimestamps();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('aggregates scores with correct weights for a clean server', async () => {
    const mockStreamReader = {
      read: vi.fn().mockResolvedValue({
        done: false,
        value: new Uint8Array(Buffer.from('data: {"response":"hi"}\n\n')),
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    fetchSpy.mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ response: 'normal text' }),
        body: { getReader: () => mockStreamReader },
      } as unknown as Response;
    });

    const runner = new HoneypotProbeRunner({
      weights: { schema: 0.4, coldStart: 0.3, watermark: 0.3 },
    });

    // Set lastProbeAt to now so no cold-start probe fires (clean server)
    ColdStartTimingProbe.setLastProbeAt('srv-test', Date.now());

    const result = await runner.runAll('http://localhost:11434', 'srv-test', 'llama3:8b', 30, 70);

    expect(result.serverId).toBe('srv-test');
    expect(result.serverUrl).toBe('http://localhost:11434');
    expect(result.verdict).toBe('clean');
    expect(result.schemaScore).toBe(0);
    expect(result.compositeScore).toBe(0);
  });

  it('scores watermark probe on generate response text', async () => {
    const mockStreamReader = {
      read: vi.fn().mockResolvedValue({
        done: false,
        value: new Uint8Array(Buffer.from('data: {"response":"hi"}\n\n')),
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };

    fetchSpy.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/generate')) {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({ response: 'Hello\u200bWorld' }),
          body: { getReader: () => mockStreamReader },
        } as unknown as Response;
      }
      return mockResponse(200, {});
    });

    const runner = new HoneypotProbeRunner();
    const result = await runner.runAll('http://localhost:11434', 'srv-test', 'llama3:8b');

    expect(result.watermarkScore).toBe(40);
    expect(result.verdict).toBe('clean'); // composite=27 < suspicious(30)
  });

  it('returns suspicious verdict when schema is completely missing', async () => {
    fetchSpy.mockRejectedValue(new Error('all failed'));

    const runner = new HoneypotProbeRunner({
      weights: { schema: 0.4, coldStart: 0.3, watermark: 0.3 },
    });

    const result = await runner.runAll('http://localhost:11434', 'srv-test', 'llama3:8b', 30, 70);

    expect(result.schemaScore).toBe(100);
    expect(result.verdict).toBe('suspicious'); // composite=40, 30≤40<70
  });

  it('returns clean verdict when 2 endpoints are missing (score 60)', async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/api/version') || u.includes('/api/ps')) {
        throw new Error('missing');
      }
      return mockResponse(200, {});
    });

    const runner = new HoneypotProbeRunner();
    const result = await runner.runAll('http://localhost:11434', 'srv-test', 'llama3:8b', 30, 70);

    expect(result.schemaScore).toBe(60);
    expect(result.verdict).toBe('clean'); // composite=24 < suspicious(30)
  });
});
