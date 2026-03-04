import { describe, it, expect, beforeEach } from 'vitest';

import { resolveApiKey } from '../../src/utils/api-keys.js';

describe('resolveApiKey', () => {
  beforeEach(() => {
    delete process.env.TEST_API_KEY;
    delete process.env.MY_KEY;
  });

  it('should return undefined for undefined input', () => {
    expect(resolveApiKey(undefined)).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(resolveApiKey('')).toBeUndefined();
  });

  it('should return the API key as-is for regular key', () => {
    expect(resolveApiKey('sk-test-key-123')).toBe('sk-test-key-123');
  });

  it('should return the API key as-is for key with special chars', () => {
    expect(resolveApiKey('sk-test/key+with=special@chars')).toBe('sk-test/key+with=special@chars');
  });

  it('should resolve env:VARNAME to process.env value', () => {
    process.env.TEST_API_KEY = 'my-secret-key';
    expect(resolveApiKey('env:TEST_API_KEY')).toBe('my-secret-key');
  });

  it('should return undefined if env variable does not exist', () => {
    expect(resolveApiKey('env:NON_EXISTENT_VAR')).toBeUndefined();
  });

  it('should handle env: prefix with empty variable name', () => {
    expect(resolveApiKey('env:')).toBeUndefined();
  });

  it('should return the key if it does not start with env:', () => {
    expect(resolveApiKey('normalkey')).toBe('normalkey');
    expect(resolveApiKey('12345')).toBe('12345');
  });

  it('should handle keys that look like env: but are not', () => {
    expect(resolveApiKey('env')).toBe('env');
    expect(resolveApiKey('envsomething')).toBe('envsomething');
  });
});
