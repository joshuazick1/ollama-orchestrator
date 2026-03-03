import { describe, it, expect } from 'vitest';
import {
  encodeUrlParam,
  decodeUrlParam,
  sanitizeDisplayText,
  isValidUrl,
  buildUrl,
  getDomainFromUrl,
} from '../security';

describe('security utils', () => {
  describe('encodeUrlParam', () => {
    it('should safely encode a URL parameter', () => {
      expect(encodeUrlParam('hello world')).toBe('hello%20world');
      expect(encodeUrlParam('foo/bar?baz=1')).toBe('foo%2Fbar%3Fbaz%3D1');
    });
  });

  describe('decodeUrlParam', () => {
    it('should safely decode a URL parameter', () => {
      expect(decodeUrlParam('hello%20world')).toBe('hello world');
      expect(decodeUrlParam('foo%2Fbar%3Fbaz%3D1')).toBe('foo/bar?baz=1');
    });

    it('should return the original string if decoding fails', () => {
      // % is invalid
      expect(decodeUrlParam('%')).toBe('%');
    });
  });

  describe('sanitizeDisplayText', () => {
    it('should prevent XSS by escaping HTML characters', () => {
      expect(sanitizeDisplayText('<script>alert(1)</script>')).toBe(
        '&lt;script&gt;alert(1)&lt;&#x2F;script&gt;'
      );
      expect(sanitizeDisplayText('Tom & Jerry')).toBe('Tom &amp; Jerry');
      expect(sanitizeDisplayText('"hello" \'world\'')).toBe('&quot;hello&quot; &#x27;world&#x27;');
    });
  });

  describe('isValidUrl', () => {
    it('should return true for valid HTTP/HTTPS URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path?query=1')).toBe(true);
    });

    it('should return false for invalid URLs or other protocols', () => {
      expect(isValidUrl('ftp://example.com')).toBe(false);
      expect(isValidUrl('javascript:alert(1)')).toBe(false);
      expect(isValidUrl('not a url')).toBe(false);
    });
  });

  describe('buildUrl', () => {
    it('should safely construct a URL with query parameters', () => {
      const url = buildUrl('https://api.example.com/data', {
        page: 1,
        filter: 'active',
        includeMeta: true,
      });
      expect(url).toBe('https://api.example.com/data?page=1&filter=active&includeMeta=true');
    });

    it('should ignore undefined and null values', () => {
      const url = buildUrl('https://api.example.com/data', {
        page: 1,
        // @ts-expect-error - testing invalid type
        filter: undefined,
        // @ts-expect-error - testing invalid type
        extra: null,
      });
      expect(url).toBe('https://api.example.com/data?page=1');
    });
  });

  describe('getDomainFromUrl', () => {
    it('should extract the domain safely', () => {
      expect(getDomainFromUrl('https://sub.example.com/path')).toBe('sub.example.com');
      expect(getDomainFromUrl('http://localhost:8080')).toBe('localhost');
    });

    it('should return null for invalid URLs', () => {
      expect(getDomainFromUrl('not a url')).toBeNull();
    });
  });
});
