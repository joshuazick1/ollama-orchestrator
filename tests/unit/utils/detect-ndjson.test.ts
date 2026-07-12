import { describe, it, expect } from 'vitest';
import { detectNdjsonResponse } from '../../../src/utils/fetch-with-timeout.js';

describe('detectNdjsonResponse', () => {
  it('detects NDJSON body (multiple JSON lines)', () => {
    const body =
      '{"model":"qwen3.6:latest","done":false,"message":{"content":"hi"}}\n' +
      '{"model":"qwen3.6:latest","done":false,"message":{"content":"hello"}}\n' +
      '{"model":"qwen3.6:latest","done":true}';
    const result = detectNdjsonResponse(body);
    expect(result).not.toBeNull();
    expect(result?.lineCount).toBe(3);
    expect(result?.preview).toContain('qwen3.6:latest');
  });

  it('returns null for single JSON object', () => {
    const body = '{"model":"qwen3.6:latest","message":{"content":"hello"}}';
    expect(detectNdjsonResponse(body)).toBeNull();
  });

  it('returns null for empty body', () => {
    expect(detectNdjsonResponse('')).toBeNull();
  });

  it('returns null for whitespace-only body', () => {
    expect(detectNdjsonResponse('   \n  \n  ')).toBeNull();
  });

  it('returns null for multi-line non-JSON text', () => {
    expect(detectNdjsonResponse('hello\nworld\nfoo')).toBeNull();
  });

  it('returns null when only one line is valid JSON among multiple', () => {
    expect(detectNdjsonResponse('{"a":1}\nnot-json\n{"b":2}')).toBeNull();
  });

  it('handles carriage returns and trims whitespace', () => {
    const body = '  {"a":1}\r\n  {"b":2}  ';
    const result = detectNdjsonResponse(body);
    expect(result).not.toBeNull();
    expect(result?.lineCount).toBe(2);
  });

  it('preview is truncated to 200 chars', () => {
    const longLine = JSON.stringify({ data: 'x'.repeat(500) });
    const body = `${longLine}\n${longLine}`;
    const result = detectNdjsonResponse(body);
    expect(result?.preview.length).toBeLessThanOrEqual(200);
  });
});