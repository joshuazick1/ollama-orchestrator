import { describe, it, expect } from 'vitest';
import { isValidModelName, filterValidModels } from '../../src/utils/model-validator.js';

describe('model-validator', () => {
  describe('isValidModelName', () => {
    it('accepts normal model names', () => {
      expect(isValidModelName('llama3.2:1b-instruct-q4_K_M')).toBe(true);
      expect(isValidModelName('mistral:7b')).toBe(true);
      expect(isValidModelName('codellama:34b')).toBe(true);
    });

    it('rejects URLs', () => {
      expect(isValidModelName('http://evil.com/model')).toBe(false);
      expect(isValidModelName('https://phishing.xyz/payload')).toBe(false);
    });

    it('rejects IP addresses', () => {
      expect(isValidModelName('192.168.1.1')).toBe(false);
      expect(isValidModelName('10.0.0.1:model')).toBe(false);
    });

    it('rejects attack/leak patterns', () => {
      expect(isValidModelName('model:cloud')).toBe(false);
      expect(isValidModelName('cloud-attack')).toBe(false);
      expect(isValidModelName('leak-credentials')).toBe(false);
      expect(isValidModelName('malware-payload')).toBe(false);
    });

    it('rejects suspicious hashes', () => {
      expect(isValidModelName('a'.repeat(32))).toBe(false);
    });

    it('rejects empty or oversized names', () => {
      expect(isValidModelName('')).toBe(false);
      expect(isValidModelName('x'.repeat(201))).toBe(false);
    });

    it('rejects executable extensions', () => {
      expect(isValidModelName('payload.exe')).toBe(false);
      expect(isValidModelName('script.sh')).toBe(false);
    });
  });

  describe('filterValidModels', () => {
    it('filters out suspicious names and keeps normal ones', () => {
      const input = ['llama3', 'http://evil.com/model', 'mistral', '192.168.1.1'];
      const result = filterValidModels(input);
      expect(result).toEqual(['llama3', 'mistral']);
    });
  });
});
