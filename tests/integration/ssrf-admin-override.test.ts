/**
 * ssrf-admin-override.test.ts
 * Integration tests for SSRF protection with admin override
 * Tests: admin allowPrivateNetwork override, non-admin blocking, public URL access
 */

import { createServer, type Server } from 'http';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

import {
  setupIntegrationTest,
  teardownIntegrationTest,
  makeRequest,
  loginAsAdmin,
  clearAuthCookie,
} from './setup.js';

describe('SSRF Admin Override Integration Tests', () => {
  let mockServer: Server;
  let mockServerPort: number;

  beforeAll(async () => {
    await setupIntegrationTest();
  });

  afterAll(async () => {
    await teardownIntegrationTest();
  });

  beforeEach(async () => {
    clearAuthCookie();
    // Create a mock server on a private IP range
    mockServer = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    await new Promise<void>(resolve => {
      mockServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = mockServer.address() as { port: number };
    mockServerPort = addr.port;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => mockServer.close(() => resolve()));
    clearAuthCookie();
  });

  // ============================================================
  // SCENARIO 1: Admin tests http://127.0.0.1:PORT with allowPrivateNetwork=true → allowed
  // ============================================================
  describe('Admin with allowPrivateNetwork=true', () => {
    it('1. Admin with allowPrivateNetwork=true can access private IP URL', async () => {
      await loginAsAdmin();

      const response = await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: 'ssrf-test-server',
        url: `http://127.0.0.1:${mockServerPort}`,
        type: 'ollama',
      });
      expect(response.status).toBe(200);
    });
  });

  // ============================================================
  // SCENARIO 2: Admin tests http://127.0.0.1:PORT with allowPrivateNetwork=false → blocked (400)
  // ============================================================
  describe('Admin with allowPrivateNetwork=false', () => {
    it('2. Admin with allowPrivateNetwork=false is blocked from private IP URL (400)', async () => {
      await loginAsAdmin();

      const response = await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: 'ssrf-test-server-blocked',
        url: `http://127.0.0.1:${mockServerPort}`,
        type: 'ollama',
      });
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error');
    });
  });

  // ============================================================
  // SCENARIO 3: Non-admin tests http://127.0.0.1:PORT → blocked (403)
  // ============================================================
  describe('Non-admin private IP access', () => {
    it('3. Non-admin user is blocked from private IP URL (403)', async () => {
      await loginAsAdmin();

      const csrfResp = await makeRequest('GET', '/api/orchestrator/auth/csrf-token');
      const csrfToken = csrfResp.headers.get('set-cookie')?.match(/csrf-token=([^;]+)/)?.[1];

      await makeRequest('POST', '/api/orchestrator/users', {
        username: 'ssrfuser',
        email: 'ssrfuser@example.com',
        password: 'User@Pass123!Secure2024',
        role: 'user',
      });

      clearAuthCookie();

      const loginResp = await makeRequest('GET', '/api/orchestrator/auth/csrf-token');
      const loginCsrfToken = loginResp.headers.get('set-cookie')?.match(/csrf-token=([^;]+)/)?.[1];

      await makeRequest(
        'POST',
        '/api/orchestrator/auth/login',
        { username: 'ssrfuser', password: 'User@Pass123!Secure2024' },
        { csrfToken: loginCsrfToken }
      );

      const response = await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: 'ssrf-test-server-user',
        url: `http://127.0.0.1:${mockServerPort}`,
        type: 'ollama',
      });
      expect(response.status).toBe(403);
    });
  });

  // ============================================================
  // SCENARIO 4: Public URL http://example.com → always allowed
  // ============================================================
  describe('Public URL access', () => {
    it('4. Public URL is always allowed regardless of auth', async () => {
      await loginAsAdmin();

      const response = await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: 'ssrf-public-server',
        url: 'http://example.com',
        type: 'ollama',
      });
      expect(response.status).toBe(200);
    });
  });

  // ============================================================
  // SCENARIO 5: Localhost blocked when auth disabled and allowPrivateNetwork=false → 400
  // ============================================================
  describe('Auth disabled with allowPrivateNetwork=false', () => {
    it('5. Localhost blocked when auth disabled and allowPrivateNetwork=false (400)', async () => {
      clearAuthCookie();
      await teardownIntegrationTest();

      process.env.ENABLE_AUTH = 'false';
      process.env.ORCHESTRATOR_AUTH_ENABLED = 'false';

      const { setupIntegrationTest: reSetup } = await import('./setup.js');
      await reSetup();

      const response = await makeRequest('POST', '/api/orchestrator/servers/add', {
        id: 'ssrf-no-auth-server',
        url: `http://127.0.0.1:${mockServerPort}`,
        type: 'ollama',
      });
      expect(response.status).toBe(400);
    });
  });
});
