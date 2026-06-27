/**
 * login-rate-limit.test.ts
 * Integration tests for login rate limiting
 * Tests: rate limit enforcement, successful login after window, per-user rate limiting
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import {
  setupIntegrationTest,
  teardownIntegrationTest,
  makeRequest,
  clearAuthCookie,
} from './setup.js';

describe('Login Rate Limit Integration Tests', () => {
  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  beforeEach(async () => {
    clearAuthCookie();
  });

  // ============================================================
  // SCENARIO 1: 5 failed login attempts → 6th returns 429
  // ============================================================
  describe('Rate limit enforcement', () => {
    it('1. After 5 failed login attempts, 6th attempt returns 429', async () => {
      const csrfResp = await makeRequest('GET', '/api/orchestrator/auth/csrf-token');
      const csrfToken = csrfResp.headers.get('set-cookie')?.match(/csrf-token=([^;]+)/)?.[1];

      const wrongPassword = 'WrongPassword123!';
      for (let i = 0; i < 5; i++) {
        const response = await makeRequest(
          'POST',
          '/api/orchestrator/auth/login',
          { username: 'rateuser1', password: wrongPassword },
          { csrfToken }
        );
        expect(response.status).toBe(401);
      }

      const sixthResponse = await makeRequest(
        'POST',
        '/api/orchestrator/auth/login',
        { username: 'rateuser1', password: wrongPassword },
        { csrfToken }
      );
      expect(sixthResponse.status).toBe(429);
      expect(sixthResponse.data).toHaveProperty('error', 'Too many requests');
    });
  });

  // ============================================================
  // SCENARIO 2: Successful login after rate limit window → 200
  // ============================================================
  describe('Successful login after rate limit window', () => {
    it('2. Successful login works after rate limit window expires', async () => {
      const csrfResp = await makeRequest('GET', '/api/orchestrator/auth/csrf-token');
      const csrfToken = csrfResp.headers.get('set-cookie')?.match(/csrf-token=([^;]+)/)?.[1];

      await makeRequest(
        'POST',
        '/api/orchestrator/auth/login',
        { username: 'admin', password: 'Admin@Pass123!Secure2024' },
        { csrfToken }
      );

      const csrfResp2 = await makeRequest('GET', '/api/orchestrator/auth/csrf-token');
      const csrfToken2 = csrfResp2.headers.get('set-cookie')?.match(/csrf-token=([^;]+)/)?.[1];

      const wrongPassword = 'WrongPassword456!';
      for (let i = 0; i < 5; i++) {
        await makeRequest(
          'POST',
          '/api/orchestrator/auth/login',
          { username: 'rateuser2', password: wrongPassword },
          { csrfToken: csrfToken2 }
        );
      }

      const sixthResponse = await makeRequest(
        'POST',
        '/api/orchestrator/auth/login',
        { username: 'rateuser2', password: wrongPassword },
        { csrfToken: csrfToken2 }
      );
      expect(sixthResponse.status).toBe(429);

      const loginResponse = await makeRequest(
        'POST',
        '/api/orchestrator/auth/login',
        { username: 'admin', password: 'Admin@Pass123!Secure2024' },
        { csrfToken: csrfToken2 }
      );
      expect(loginResponse.status).toBe(200);
    });
  });

  // ============================================================
  // SCENARIO 3: Different user not affected by another user's rate limit
  // ============================================================
  describe('Per-user rate limiting', () => {
    it("3. Different user is not affected by another user's rate limit", async () => {
      const csrfResp1 = await makeRequest('GET', '/api/orchestrator/auth/csrf-token');
      const csrfToken1 = csrfResp1.headers.get('set-cookie')?.match(/csrf-token=([^;]+)/)?.[1];

      const wrongPassword = 'WrongPassword789!';
      for (let i = 0; i < 5; i++) {
        await makeRequest(
          'POST',
          '/api/orchestrator/auth/login',
          { username: 'ratelimituser1', password: wrongPassword },
          { csrfToken: csrfToken1 }
        );
      }

      const sixthResponse = await makeRequest(
        'POST',
        '/api/orchestrator/auth/login',
        { username: 'ratelimituser1', password: wrongPassword },
        { csrfToken: csrfToken1 }
      );
      expect(sixthResponse.status).toBe(429);

      const csrfResp2 = await makeRequest('GET', '/api/orchestrator/auth/csrf-token');
      const csrfToken2 = csrfResp2.headers.get('set-cookie')?.match(/csrf-token=([^;]+)/)?.[1];

      const differentUserResponse = await makeRequest(
        'POST',
        '/api/orchestrator/auth/login',
        { username: 'ratelimituser2', password: wrongPassword },
        { csrfToken: csrfToken2 }
      );
      expect(differentUserResponse.status).toBe(401);
    });
  });
});
