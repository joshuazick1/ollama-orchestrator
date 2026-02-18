/**
 * urlUtils.test.ts
 * Tests for URL utility functions
 */

import { describe, it, expect } from 'vitest';
import { normalizeServerUrl, areUrlsEquivalent } from '../../src/utils/urlUtils.js';

describe('urlUtils', () => {
  describe('normalizeServerUrl', () => {
    it('should remove trailing slashes', () => {
      const result = normalizeServerUrl('http://localhost:11434/');
      expect(result).toBe('http://localhost:11434');
    });

    it('should remove multiple trailing slashes', () => {
      const result = normalizeServerUrl('http://localhost:11434///');
      expect(result).toBe('http://localhost:11434');
    });

    it('should decode URL-encoded characters', () => {
      const result = normalizeServerUrl('http://localhost%3A11434');
      expect(result).toBe('http://localhost:11434');
    });

    it('should handle double encoding', () => {
      const result = normalizeServerUrl('http%3A%2F%2Flocalhost%3A11434');
      expect(result).toBe('http://localhost:11434');
    });

    it('should handle invalid encoding gracefully', () => {
      const result = normalizeServerUrl('http://localhost:11434%ZZ');
      expect(result).toBe('http://localhost:11434%ZZ');
    });

    it('should return URL unchanged if already normalized', () => {
      const result = normalizeServerUrl('http://localhost:11434');
      expect(result).toBe('http://localhost:11434');
    });
  });

  describe('areUrlsEquivalent', () => {
    it('should return true for identical URLs', () => {
      const result = areUrlsEquivalent('http://localhost:11434', 'http://localhost:11434');
      expect(result).toBe(true);
    });

    it('should return true for URLs with trailing slash difference', () => {
      const result = areUrlsEquivalent('http://localhost:11434/', 'http://localhost:11434');
      expect(result).toBe(true);
    });

    it('should return true for encoded vs non-encoded URLs', () => {
      const result = areUrlsEquivalent('http://localhost%3A11434', 'http://localhost:11434');
      expect(result).toBe(true);
    });

    it('should return false for different URLs', () => {
      const result = areUrlsEquivalent('http://localhost:11434', 'http://localhost:11435');
      expect(result).toBe(false);
    });
  });
});
