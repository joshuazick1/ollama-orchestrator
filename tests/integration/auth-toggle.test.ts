/**
 * auth-toggle.test.ts
 * Integration tests for ENABLE_AUTH toggle behavior
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import { resetOrchestratorInstance } from '../../src/orchestrator/orchestrator-instance.js';
import {
  setupIntegrationTest,
  teardownIntegrationTest,
  makeRequest,
  loginAsAdmin,
  clearAuthCookie,
} from './setup.js';

describe('ENABLE_AUTH Toggle Integration Tests', () => {
  let originalEnableAuth: string | undefined;
  let originalOrchestratorAuth: string | undefined;

  beforeAll(async () => {
    originalEnableAuth = process.env.ENABLE_AUTH;
    originalOrchestratorAuth = process.env.ORCHESTRATOR_AUTH_ENABLED;
  });

  afterAll(async () => {
    process.env.ENABLE_AUTH = originalEnableAuth ?? 'true';
    if (originalOrchestratorAuth !== undefined) {
      process.env.ORCHESTRATOR_AUTH_ENABLED = originalOrchestratorAuth;
    } else {
      delete process.env.ORCHESTRATOR_AUTH_ENABLED;
    }
    await teardownIntegrationTest();
  });

  beforeEach(async () => {
    clearAuthCookie();
    resetOrchestratorInstance();
    process.env.ENABLE_AUTH = 'true';
    delete process.env.ORCHESTRATOR_AUTH_ENABLED;
    await setupIntegrationTest();
  });

  afterEach(async () => {
    await teardownIntegrationTest();
  });

  // ============================================================
  // SCENARIO 1: When ENABLE_AUTH=true, unauthenticated request to admin endpoint → 401
  // ============================================================
  describe('ENABLE_AUTH=true unauthenticated behavior', () => {
    it('1. When ENABLE_AUTH=true, unauthenticated request to admin endpoint returns 401', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/servers');
      expect(response.status).toBe(401);
      expect(response.data).toHaveProperty('error', 'Authentication required');
    });
  });

  // ============================================================
  // SCENARIO 2: When ENABLE_AUTH=true, authenticated admin → 200
  // ============================================================
  describe('ENABLE_AUTH=true authenticated admin behavior', () => {
    it('2. When ENABLE_AUTH=true, authenticated admin request returns 200', async () => {
      await loginAsAdmin();
      const response = await makeRequest('GET', '/api/orchestrator/servers');
      expect(response.status).toBe(200);
    });
  });

  // ============================================================
  // SCENARIO 3: When ENABLE_AUTH=true, non-admin user → 403
  // ============================================================
  describe('ENABLE_AUTH=true non-admin behavior', () => {
    it('3. When ENABLE_AUTH=true, non-admin user request returns 403', async () => {
      const csrfTokenResp = await makeRequest('GET', '/api/orchestrator/auth/csrf-token');
      const csrfToken = csrfTokenResp.headers.get('set-cookie')?.match(/csrf-token=([^;]+)/)?.[1];

      await makeRequest(
        'POST',
        '/api/orchestrator/auth/login',
        { username: 'admin', password: 'Admin@Pass123!Secure2024' },
        { csrfToken }
      );

      await makeRequest('POST', '/api/orchestrator/users', {
        username: 'regularuser',
        email: 'user@example.com',
        password: 'User@Pass123!Secure2024',
        role: 'user',
      });

      clearAuthCookie();

      const csrfToken2Resp = await makeRequest('GET', '/api/orchestrator/auth/csrf-token');
      const csrfToken2 = csrfToken2Resp.headers.get('set-cookie')?.match(/csrf-token=([^;]+)/)?.[1];

      await makeRequest(
        'POST',
        '/api/orchestrator/auth/login',
        { username: 'regularuser', password: 'User@Pass123!Secure2024' },
        { csrfToken: csrfToken2 }
      );

      const response = await makeRequest('GET', '/api/orchestrator/servers');
      expect(response.status).toBe(403);
      expect(response.data).toHaveProperty('error', 'Forbidden');
    });
  });

  // ============================================================
  // SCENARIO 4: When ENABLE_AUTH=false, all endpoints accessible
  // ============================================================
  describe('ENABLE_AUTH=false behavior', () => {
    it('4. When ENABLE_AUTH=false, unauthenticated request to admin endpoint returns 200', async () => {
      await teardownIntegrationTest();

      process.env.ENABLE_AUTH = 'false';
      process.env.ORCHESTRATOR_AUTH_ENABLED = 'false';
      resetOrchestratorInstance();
      await setupIntegrationTest();

      const response = await makeRequest('GET', '/api/orchestrator/servers');
      expect(response.status).toBe(200);
    });
  });
});
