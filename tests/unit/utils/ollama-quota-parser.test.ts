import { describe, it, expect } from 'vitest';

import { parseOllamaCloudQuota } from '../../../src/utils/ollama-quota-parser.js';

describe('ollama-quota-parser', () => {
  describe('parseOllamaCloudQuota', () => {
    describe('plain format (HTTP 429: you ...)', () => {
      it('should parse weekly quota from plain format', () => {
        const message = 'HTTP 429: you (amohsen2011) have reached your weekly usage limit, please upgrade your plan';
        const result = parseOllamaCloudQuota(message);
        expect(result).toEqual({ upstreamUserId: 'amohsen2011', quotaType: 'weekly' });
      });

      it('should parse session quota from plain format', () => {
        const message = 'HTTP 429: you (user123) have reached your session usage limit, try again later';
        const result = parseOllamaCloudQuota(message);
        expect(result).toEqual({ upstreamUserId: 'user123', quotaType: 'session' });
      });

      it('should parse monthly quota from plain format', () => {
        const message = 'HTTP 429: you (dev456) have reached your monthly usage limit, please upgrade';
        const result = parseOllamaCloudQuota(message);
        expect(result).toEqual({ upstreamUserId: 'dev456', quotaType: 'monthly' });
      });
    });

    describe('wrapped format (HTTP 429: 429 Too Many Requests: you ...)', () => {
      it('should parse weekly quota from wrapped format', () => {
        const message = 'HTTP 429: 429 Too Many Requests: you (amohsen2011) have reached your weekly usage limit, ... (api_error)';
        const result = parseOllamaCloudQuota(message);
        expect(result).toEqual({ upstreamUserId: 'amohsen2011', quotaType: 'weekly' });
      });

      it('should parse session quota from wrapped format', () => {
        const message = 'HTTP 429: 429 Too Many Requests: you (testuser) have reached your session usage limit, ... (api_error)';
        const result = parseOllamaCloudQuota(message);
        expect(result).toEqual({ upstreamUserId: 'testuser', quotaType: 'session' });
      });

      it('should parse monthly quota from wrapped format', () => {
        const message = 'HTTP 429: 429 Too Many Requests: you (developer) have reached your monthly usage limit, ... (api_error)';
        const result = parseOllamaCloudQuota(message);
        expect(result).toEqual({ upstreamUserId: 'developer', quotaType: 'monthly' });
      });
    });

    describe('401 authentication errors', () => {
      it('should return null for 401 unauthorized (not a quota error)', () => {
        const message = 'HTTP 401: unauthorized - invalid API key';
        const result = parseOllamaCloudQuota(message);
        expect(result).toBeNull();
      });

      it('should return null for 401 authentication failure', () => {
        const message = 'HTTP 401: authentication failed - credentials are invalid';
        const result = parseOllamaCloudQuota(message);
        expect(result).toBeNull();
      });

      it('should return null for 401 without quota pattern', () => {
        const message = '401 Unauthorized: you do not have access to this resource';
        const result = parseOllamaCloudQuota(message);
        expect(result).toBeNull();
      });
    });

    describe('non-quota 429 rate limit errors', () => {
      it('should return null for generic rate limit without quota format', () => {
        const message = 'HTTP 429: Rate limit exceeded, please try again later';
        const result = parseOllamaCloudQuota(message);
        expect(result).toBeNull();
      });

      it('should return null for 429 without the quota pattern', () => {
        const message = '429 Too Many Requests - server is busy';
        const result = parseOllamaCloudQuota(message);
        expect(result).toBeNull();
      });

      it('should return null for 429 with different wording', () => {
        const message = 'HTTP 429: you have exceeded the rate limit';
        const result = parseOllamaCloudQuota(message);
        expect(result).toBeNull();
      });
    });

    describe('edge cases - null returns', () => {
      it('should return null for empty string', () => {
        const result = parseOllamaCloudQuota('');
        expect(result).toBeNull();
      });

      it('should return null for string without parentheses', () => {
        const message = 'HTTP 429: you have reached your weekly usage limit';
        const result = parseOllamaCloudQuota(message);
        expect(result).toBeNull();
      });

      it('should return null for string with unmatched parentheses', () => {
        const message = 'HTTP 429: you (user have reached your weekly usage limit';
        const result = parseOllamaCloudQuota(message);
        expect(result).toBeNull();
      });

      it('should return null for whitespace-only string', () => {
        const result = parseOllamaCloudQuota('   ');
        expect(result).toBeNull();
      });

      it('should return null for null/undefined-like input', () => {
        const result = parseOllamaCloudQuota('null');
        expect(result).toBeNull();
      });
    });

    describe('case insensitivity', () => {
      it('should match with uppercase YOU', () => {
        const message = 'HTTP 429: YOU (user1) have reached your weekly usage limit';
        const result = parseOllamaCloudQuota(message);
        expect(result).toEqual({ upstreamUserId: 'user1', quotaType: 'weekly' });
      });

      it('should match with uppercase QUOTA TYPE', () => {
        const message = 'HTTP 429: you (user1) have reached your WEEKLY usage limit';
        const result = parseOllamaCloudQuota(message);
        expect(result).toEqual({ upstreamUserId: 'user1', quotaType: 'WEEKLY' });
      });
    });

    describe('complex user IDs', () => {
      it('should handle user ID with numbers and underscores', () => {
        const message = 'HTTP 429: you (user_123_test) have reached your weekly usage limit';
        const result = parseOllamaCloudQuota(message);
        expect(result).toEqual({ upstreamUserId: 'user_123_test', quotaType: 'weekly' });
      });

      it('should handle user ID with hyphens', () => {
        const message = 'HTTP 429: you (my-user-2024) have reached your session usage limit';
        const result = parseOllamaCloudQuota(message);
        expect(result).toEqual({ upstreamUserId: 'my-user-2024', quotaType: 'session' });
      });
    });
  });
});
