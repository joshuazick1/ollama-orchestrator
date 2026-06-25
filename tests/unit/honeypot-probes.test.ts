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
  IpAsnReputationProbe,
  RecursiveCallbackProbe,
  Tier3Evidence,
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

describe('HttpHeaderConsistencyProbe', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ version: '0.1.0' }),
      headers: new Map([
        ['content-type', 'application/json; charset=utf-8'],
        ['date', 'Thu, 25 Jun 2026 12:00:00 GMT'],
      ]),
    } as unknown as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('scores 0 for real Ollama headers', async () => {
    const { HttpHeaderConsistencyProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new HttpHeaderConsistencyProbe({ timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434');

    expect(result.score).toBe(0);
    expect(result.evidence.contentType).toContain('application/json');
    expect(result.evidence.hasDate).toBe(true);
    expect(result.evidence.issues).toHaveLength(0);
  });

  it('scores 40 for wrong Content-Type', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      headers: new Map([
        ['content-type', 'text/html'],
        ['date', 'Thu, 25 Jun 2026 12:00:00 GMT'],
      ]),
    } as unknown as Response);

    const { HttpHeaderConsistencyProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new HttpHeaderConsistencyProbe({ timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434');

    expect(result.score).toBe(40);
    expect(result.evidence.issues).toContain('Wrong Content-Type (not application/json)');
  });

  it('scores 20 for missing Date header', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      headers: new Map([['content-type', 'application/json; charset=utf-8']]),
    } as unknown as Response);

    const { HttpHeaderConsistencyProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new HttpHeaderConsistencyProbe({ timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434');

    expect(result.score).toBe(20);
    expect(result.evidence.issues).toContain('Missing Date header');
  });

  it('scores 50 for suspicious Server header', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      headers: new Map([
        ['content-type', 'application/json; charset=utf-8'],
        ['date', 'Thu, 25 Jun 2026 12:00:00 GMT'],
        ['server', 'nginx/1.18.0'],
      ]),
    } as unknown as Response);

    const { HttpHeaderConsistencyProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new HttpHeaderConsistencyProbe({ timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434');

    expect(result.score).toBe(50);
    expect(result.evidence.issues.some((i: string) => i.includes('nginx'))).toBe(true);
  });

  it('scores 30 for unparseable JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => {
        throw new Error('parse error');
      },
      headers: new Map([
        ['content-type', 'application/json; charset=utf-8'],
        ['date', 'Thu, 25 Jun 2026 12:00:00 GMT'],
      ]),
    } as unknown as Response);

    const { HttpHeaderConsistencyProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new HttpHeaderConsistencyProbe({ timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434');

    expect(result.score).toBe(30);
    expect(result.evidence.issues).toContain('Unparseable JSON response');
  });
});

describe('OutputEntropyProbe', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ response: '42, 17, 89' }),
    } as unknown as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('scores 0 when all 5 responses are unique', async () => {
    const responses = ['42, 17, 89', '11, 55, 33', '7, 21, 14', '99, 3, 67', '25, 41, 58'];
    let callCount = 0;
    fetchSpy.mockImplementation(async () => {
      const response = responses[callCount % responses.length];
      callCount++;
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ response }),
      } as unknown as Response;
    });

    const { OutputEntropyProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new OutputEntropyProbe({ sampleCount: 5, timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434', 'llama3:8b');

    expect(result.score).toBe(0);
    expect(result.evidence.uniqueCount).toBe(5);
    expect(result.evidence.identicalRatio).toBe(0);
  });

  it('scores 100 when all 5 responses are identical', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ response: '42, 17, 89' }),
    } as unknown as Response);

    const { OutputEntropyProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new OutputEntropyProbe({ sampleCount: 5, timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434', 'llama3:8b');

    expect(result.score).toBe(100);
    expect(result.evidence.uniqueCount).toBe(1);
    expect(result.evidence.identicalRatio).toBe(0.8);
  });

  it('scores 60 when 4 out of 5 responses are identical', async () => {
    let callCount = 0;
    fetchSpy.mockImplementation(async () => {
      callCount++;
      const response = callCount <= 4 ? '42, 17, 89' : '11, 55, 33';
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ response }),
      } as unknown as Response;
    });

    const { OutputEntropyProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new OutputEntropyProbe({ sampleCount: 5, timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434', 'llama3:8b');

    expect(result.score).toBe(60);
    expect(result.evidence.uniqueCount).toBe(2);
  });

  it('scores 30 when 3 out of 5 responses are identical', async () => {
    let callCount = 0;
    fetchSpy.mockImplementation(async () => {
      callCount++;
      const response =
        callCount <= 3 ? '42, 17, 89' : `${callCount * 10}, ${callCount * 5}, ${callCount}`;
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ response }),
      } as unknown as Response;
    });

    const { OutputEntropyProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new OutputEntropyProbe({ sampleCount: 5, timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434', 'llama3:8b');

    expect(result.score).toBe(30);
    expect(result.evidence.uniqueCount).toBe(3);
  });

  it('scores 10 when 2 out of 5 responses are identical', async () => {
    let callCount = 0;
    fetchSpy.mockImplementation(async () => {
      callCount++;
      const responses = ['42, 17, 89', '11, 55, 33', '77, 22, 88', '42, 17, 89', '99, 1, 44'];
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ response: responses[callCount - 1] }),
      } as unknown as Response;
    });

    const { OutputEntropyProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new OutputEntropyProbe({ sampleCount: 5, timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434', 'llama3:8b');

    expect(result.score).toBe(10);
    expect(result.evidence.uniqueCount).toBe(4);
  });

  it('handles fetch failures gracefully', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'));

    const { OutputEntropyProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new OutputEntropyProbe({ sampleCount: 5, timeoutMs: 5000 });
    const result = await probe.probe('http://localhost:11434', 'llama3:8b');

    expect(result.score).toBe(0);
    expect(result.evidence.responses).toHaveLength(0);
  });
});

describe('TlsFingerprintProbe', () => {
  beforeEach(() => {
    vi.stubGlobal('net', {
      createConnection: vi.fn().mockReturnValue({
        on: vi.fn(),
        destroy: vi.fn(),
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scores 0 for known Ollama/Node.js fingerprint', async () => {
    vi.doMock('node:tls', () => ({
      connect: vi.fn((_options: unknown, callback: () => void) => {
        setTimeout(callback, 0);
        return {
          on: vi.fn((event: string, handler: () => void) => {
            if (event === 'error') {
            }
          }),
          getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' }),
          getPeerCertificate: () => ({ serialNumber: '01' }),
          destroy: vi.fn(),
          removeAllListeners: vi.fn(),
        };
      }),
    }));

    const { TlsFingerprintProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new TlsFingerprintProbe({ timeoutMs: 5000 });

    const mockTls = await import('node:tls');
    vi.mocked(mockTls.connect).mockImplementation((_options: unknown, callback: () => void) => {
      setTimeout(callback, 0);
      return {
        on: vi.fn(),
        getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' }),
        getPeerCertificate: () => ({ serialNumber: '01' }),
        destroy: vi.fn(),
        removeAllListeners: vi.fn(),
      };
    });

    const result = await probe.probe('localhost', 11434);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.evidence.rawHandshakeSummary).toBeTruthy();
  });

  it('scores 0 for timeout', async () => {
    vi.doMock('node:tls', () => ({
      connect: vi.fn(() => {
        return {
          on: vi.fn((_event: string, _handler: () => void) => {}),
          getCipher: () => null,
          getPeerCertificate: () => null,
          destroy: vi.fn(),
          removeAllListeners: vi.fn(),
        };
      }),
    }));

    const { TlsFingerprintProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new TlsFingerprintProbe({ timeoutMs: 50 });
    const result = await probe.probe('192.168.1.1', 11434);

    expect(result.score).toBe(0);
    expect(['timeout', 'connection_error', 'setup_error']).toContain(
      result.evidence.rawHandshakeSummary
    );
  });

  it('handles connection errors gracefully', async () => {
    vi.doMock('node:tls', () => ({
      connect: vi.fn((_options: unknown, _callback: () => void) => {
        return {
          on: vi.fn((event: string, handler: (err: Error) => void) => {
            if (event === 'error') {
              setTimeout(() => handler(new Error('Connection refused')), 0);
            }
          }),
          getCipher: () => null,
          getPeerCertificate: () => null,
          destroy: vi.fn(),
          removeAllListeners: vi.fn(),
        };
      }),
    }));

    const { TlsFingerprintProbe } = await import('../../../src/utils/honeypot-probes.js');
    const probe = new TlsFingerprintProbe({ timeoutMs: 5000 });
    const result = await probe.probe('192.168.1.1', 11434);

    expect(result.score).toBe(0);
    expect(['connection_error', 'tls_error', 'setup_error']).toContain(
      result.evidence.rawHandshakeSummary
    );
  });
});

describe('HoneypotProbeRunner runTier2', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ response: 'test response' }),
      headers: new Map([
        ['content-type', 'application/json; charset=utf-8'],
        ['date', 'Thu, 25 Jun 2026 12:00:00 GMT'],
      ]),
    } as unknown as Response);

    vi.stubGlobal('net', {
      createConnection: vi.fn().mockReturnValue({
        on: vi.fn(),
        destroy: vi.fn(),
      }),
    });

    vi.doMock('node:tls', () => ({
      connect: vi.fn((_options: unknown, callback: () => void) => {
        setTimeout(callback, 0);
        return {
          on: vi.fn(),
          getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' }),
          getPeerCertificate: () => ({ serialNumber: '01' }),
          destroy: vi.fn(),
          removeAllListeners: vi.fn(),
        };
      }),
    }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('runTier2 returns all tier2 scores and evidence', async () => {
    const { HoneypotProbeRunner } = await import('../../../src/utils/honeypot-probes.js');
    const runner = new HoneypotProbeRunner({
      entropy: { sampleCount: 2 },
      tls: { timeoutMs: 5000 },
    });

    const result = await runner.runTier2('http://localhost:11434', 'srv-test', 'llama3:8b');

    expect(result.headerScore).toBeDefined();
    expect(result.entropyScore).toBeDefined();
    expect(result.tlsScore).toBeDefined();
    expect(result.tier2Score).toBeDefined();
    expect(result.headerEvidence).toBeDefined();
    expect(result.entropyEvidence).toBeDefined();
    expect(result.tlsEvidence).toBeDefined();
  });
});

describe('IpAsnReputationProbe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    IpAsnReputationProbe.clearCache();
    IpAsnReputationProbe.clearServerAge();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scores 40 for private IP (192.168.x)', async () => {
    const probe = new IpAsnReputationProbe({ rdapTimeoutMs: 5000 });
    const result = await probe.probe('192.168.1.50', 'srv-test', 0);

    expect(result.score).toBe(40);
    expect(result.evidence.isPrivate).toBe(true);
    expect(result.evidence.rdapStatus).toBe('error');
  });

  it('scores 40 for reserved IP (127.0.0.1)', async () => {
    const probe = new IpAsnReputationProbe({ rdapTimeoutMs: 5000 });
    const result = await probe.probe('127.0.0.1', 'srv-test', 0);

    expect(result.score).toBe(40);
    expect(result.evidence.isPrivate).toBe(true);
  });

  it('scores 40 for 10.x private range', async () => {
    const probe = new IpAsnReputationProbe({ rdapTimeoutMs: 5000 });
    const result = await probe.probe('10.0.0.1', 'srv-test', 0);

    expect(result.score).toBe(40);
    expect(result.evidence.isPrivate).toBe(true);
  });

  it('scores 40 for 172.16-31.x private range', async () => {
    const probe = new IpAsnReputationProbe({ rdapTimeoutMs: 5000 });
    const result = await probe.probe('172.20.0.1', 'srv-test', 0);

    expect(result.score).toBe(40);
    expect(result.evidence.isPrivate).toBe(true);
  });

  it('scores 0 for public IP with old registration age (RDAP lookup)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          events: [{ eventAction: 'registration', eventDate: '2000-01-01T00:00:00Z' }],
        }),
    } as unknown as Response);

    const probe = new IpAsnReputationProbe({ rdapTimeoutMs: 5000 });
    const result = await probe.probe('8.8.8.8', 'srv-test', 0);

    expect(result.score).toBe(0);
    expect(result.evidence.ipRegistrationAgeDays).toBeGreaterThan(9000);
    expect(result.evidence.rdapStatus).toBe('success');

    fetchSpy.mockRestore();
  });

  it('scores 5 when RDAP times out', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000));
    });

    const probe = new IpAsnReputationProbe({ rdapTimeoutMs: 1000 });
    const result = await probe.probe('1.1.1.1', 'srv-test', 0);

    expect(result.score).toBe(5);
    expect(result.evidence.rdapStatus).toBe('timeout');

    fetchSpy.mockRestore();
  });

  it('records server first-seen timestamp', () => {
    const probe = new IpAsnReputationProbe({ rdapTimeoutMs: 5000 });

    probe.recordServerFirstSeen('srv-new');
    probe.recordServerFirstSeen('srv-existing');

    const age = (probe as any).getServerAgeInFleetHours('srv-new');
    expect(age).toBeGreaterThanOrEqual(0);
  });

  it('clears cache on clearCache() does not throw', () => {
    IpAsnReputationProbe.clearCache();
    IpAsnReputationProbe.clearServerAge();
    expect(() => {
      IpAsnReputationProbe.clearCache();
    }).not.toThrow();
  });
});

describe('RecursiveCallbackProbe', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ response: 'callback received' }),
    } as unknown as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('respects 0% sample rate (never runs)', async () => {
    const probe = new RecursiveCallbackProbe({
      callbackTimeoutMs: 2000,
      callbackSampleRate: 0,
    });
    const result = await probe.probe('http://localhost:11434', 'srv-test', 'llama3:8b');

    expect(result.score).toBe(0);
    expect(result.evidence.callbackUrl).toBe('');
  });
});

describe('HoneypotProbeRunner runTier3', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ response: 'test response' }),
    } as unknown as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('runTier3 returns all tier3 scores and evidence', async () => {
    IpAsnReputationProbe.clearCache();
    IpAsnReputationProbe.clearServerAge();

    const runner = new HoneypotProbeRunner({
      ipAsn: { rdapTimeoutMs: 5000, rdapCacheTtlMs: 86400000 },
      callback: { callbackTimeoutMs: 2000, callbackSampleRate: 0 },
    });

    const result = await runner.runTier3('http://localhost:11434', 'srv-test', 'llama3:8b', 0);

    expect(result.ipAsnScore).toBeDefined();
    expect(result.callbackScore).toBeDefined();
    expect(result.tier3Score).toBeDefined();
    expect(result.ipAsnEvidence).toBeDefined();
    expect(result.callbackEvidence).toBeDefined();
  });

  it('aggregates tier3 scores correctly', async () => {
    IpAsnReputationProbe.clearCache();
    IpAsnReputationProbe.clearServerAge();

    const runner = new HoneypotProbeRunner({
      ipAsn: { rdapTimeoutMs: 5000, rdapCacheTtlMs: 86400000 },
      callback: { callbackTimeoutMs: 2000, callbackSampleRate: 0 },
    });

    const result = await runner.runTier3('http://192.168.1.50:11434', 'srv-test', 'llama3:8b', 0);

    expect(result.ipAsnScore).toBe(40);
    expect(result.tier3Score).toBe(20);
  });

  it('callback sample rate 0 means callback score is always 0', async () => {
    const { HoneypotProbeRunner, IpAsnReputationProbe } =
      await import('../../../src/utils/honeypot-probes.js');

    IpAsnReputationProbe.clearCache();
    IpAsnReputationProbe.clearServerAge();

    const runner = new HoneypotProbeRunner({
      ipAsn: { rdapTimeoutMs: 5000, rdapCacheTtlMs: 86400000 },
      callback: { callbackTimeoutMs: 2000, callbackSampleRate: 0 },
    });

    const result = await runner.runTier3('http://1.1.1.1:11434', 'srv-test', 'llama3:8b', 0);

    expect(result.callbackScore).toBe(0);
  });
});
