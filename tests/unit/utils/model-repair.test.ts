import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  attemptModelRepair,
  matchesAny,
  CORRUPTED_MODEL_PATTERNS,
  RUNNER_CRASH_PATTERNS,
} from '../../../src/utils/model-repair.js';

/* ─── matchesAny ────────────────────────────────────────────────────── */

describe('matchesAny', () => {
  const patterns = ['hello world', 'foo bar'] as const;

  it('returns true when error message contains a pattern (case-insensitive)', () => {
    expect(matchesAny('ERROR: hello World something', patterns)).toBe(true);
  });

  it('returns true for exact match', () => {
    expect(matchesAny('foo bar', patterns)).toBe(true);
  });

  it('returns false when no pattern matches', () => {
    expect(matchesAny('baz qux', patterns)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(matchesAny('', patterns)).toBe(false);
  });

  it('handles patterns that are substrings of other words', () => {
    expect(matchesAny('hello world!!!', patterns)).toBe(true);
  });
});

/* ─── Pattern constants ─────────────────────────────────────────────── */

describe('CORRUPTED_MODEL_PATTERNS', () => {
  it('includes unable to load model', () => {
    expect(CORRUPTED_MODEL_PATTERNS).toContain('unable to load model');
  });

  it('includes failed to load model', () => {
    expect(CORRUPTED_MODEL_PATTERNS).toContain('failed to load model');
  });

  it('includes llm server loading model', () => {
    expect(CORRUPTED_MODEL_PATTERNS).toContain('llm server loading model');
  });

  it('matches typical Ollama model load error', () => {
    const err = 'Error: unable to load model /root/.ollama/models/blobs/sha256-xxx: file does not exist';
    expect(matchesAny(err, CORRUPTED_MODEL_PATTERNS)).toBe(true);
  });

  it('matches failed to load model error', () => {
    const err = 'failed to load model: qwen3.6:latest - corrupted blob detected';
    expect(matchesAny(err, CORRUPTED_MODEL_PATTERNS)).toBe(true);
  });
});

describe('RUNNER_CRASH_PATTERNS', () => {
  it('includes runner process has terminated', () => {
    expect(RUNNER_CRASH_PATTERNS).toContain('runner process has terminated');
  });

  it('includes fatal model server error', () => {
    expect(RUNNER_CRASH_PATTERNS).toContain('fatal model server error');
  });

  it('matches typical runner crash message', () => {
    const err = 'runner process has terminated with exit code 139';
    expect(matchesAny(err, RUNNER_CRASH_PATTERNS)).toBe(true);
  });

  it('matches llama runner crash', () => {
    const err = 'llama runner process crashed: SIGSEGV';
    expect(matchesAny(err, RUNNER_CRASH_PATTERNS)).toBe(true);
  });
});

/* ─── attemptModelRepair ────────────────────────────────────────────── */

describe('attemptModelRepair', () => {
  const serverUrl = 'http://mock-ollama:11434';
  const modelName = 'qwen3.6:latest';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('succeeds when delete (200) and pull (success) both work', async () => {
    // Mock global fetch
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    // First call: DELETE /api/delete
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 200 })
    );

    // Second call: POST /api/pull → NDJSON success stream
    const pullBody =
      '{"status":"pulling manifest"}\n' +
      '{"status":"success"}\n';
    fetchMock.mockResolvedValueOnce(
      new Response(pullBody, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    );

    const result = await attemptModelRepair(serverUrl, modelName, 5000, 10000);

    expect(result.success).toBe(true);
    expect(result.action).toBe('removed-and-pulled');

    // Verify correct API calls
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const deleteCall = fetchMock.mock.calls[0];
    expect(deleteCall[0]).toBe(`${serverUrl}/api/delete`);
    expect(deleteCall[1]?.method).toBe('DELETE');
    expect(JSON.parse(deleteCall[1]?.body as string)).toEqual({ name: modelName });

    const pullCall = fetchMock.mock.calls[1];
    expect(pullCall[0]).toBe(`${serverUrl}/api/pull`);
    expect(pullCall[1]?.method).toBe('POST');
    expect(JSON.parse(pullCall[1]?.body as string)).toEqual({ name: modelName });
  });

  it('continues to pull even when delete returns 404 (model already gone)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 404 })
    );

    fetchMock.mockResolvedValueOnce(
      new Response('{"status":"success"}\n', { status: 200 })
    );

    const result = await attemptModelRepair(serverUrl, modelName, 5000, 10000);
    expect(result.success).toBe(true);
    expect(result.action).toBe('removed-and-pulled');
  });

  it('returns failure when pull returns HTTP error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"model not found in registry"}', { status: 500 })
    );

    const result = await attemptModelRepair(serverUrl, modelName, 5000, 10000);

    expect(result.success).toBe(false);
    expect(result.action).toBe('pull-failed');
    expect(result.error).toContain('500');
  });

  it('returns failure when pull stream does not report success', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    // Pull completes but no "success" status
    fetchMock.mockResolvedValueOnce(
      new Response('{"status":"pulling manifest"}\n{"status":"downloading"}\n', { status: 200 })
    );

    const result = await attemptModelRepair(serverUrl, modelName, 5000, 10000);

    expect(result.success).toBe(false);
    expect(result.action).toBe('pull-failed');
    expect(result.error).toContain('without success status');
  });

  it('returns failure when pull reports error status', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    // Pull reports error
    fetchMock.mockResolvedValueOnce(
      new Response(
        '{"status":"error","error":"connection timeout"}\n',
        { status: 200 }
      )
    );

    const result = await attemptModelRepair(serverUrl, modelName, 5000, 10000);

    expect(result.success).toBe(false);
    expect(result.action).toBe('pull-failed');
    expect(result.error).toContain('connection timeout');
  });

  it('returns failure when fetch throws (network error)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    // Pull throws
    fetchMock.mockRejectedValueOnce(new Error('fetch failed: ECONNREFUSED'));

    const result = await attemptModelRepair(serverUrl, modelName, 5000, 10000);

    expect(result.success).toBe(false);
    expect(result.action).toBe('pull-failed');
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('handles delete error gracefully and still tries pull', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    fetchMock.mockRejectedValueOnce(new Error('Connection refused'));

    fetchMock.mockResolvedValueOnce(
      new Response('{"status":"success"}\n', { status: 200 })
    );

    const result = await attemptModelRepair(serverUrl, modelName, 5000, 10000);

    expect(result.success).toBe(true);
    expect(result.action).toBe('removed-and-pulled');
  });
});
