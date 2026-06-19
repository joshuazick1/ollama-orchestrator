/**
 * Integration test setup
 * Starts the server and provides utilities for testing API endpoints
 */

import 'dotenv/config';

import { createServer } from 'http';
import { AddressInfo } from 'net';

import cookieParser from 'cookie-parser';
import express from 'express';

import { getConfigManager } from '../../src/config/config.js';
import { getPrometheusMetrics } from '../../src/controllers/metrics-controller.js';
import {
  getOrchestratorInstance,
  resetOrchestratorInstance,
} from '../../src/orchestrator/orchestrator-instance.js';
import router from '../../src/routes/orchestrator.js';

// Test server instance
let server: ReturnType<typeof createServer>;
let baseUrl: string;
let orchestrator: ReturnType<typeof getOrchestratorInstance> | undefined;
let authCookie: string | undefined;

/**
 * Login as admin and store the auth cookie for subsequent requests.
 * Uses ADMIN_USERNAME and ADMIN_PASSWORD from environment.
 */
export async function loginAsAdmin(): Promise<string> {
  const csrfToken = await getCsrfToken();

  const adminUsername = process.env.ADMIN_USERNAME ?? 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD ?? 'Admin@Pass123!Secure2024';

  const response = await fetch(`${baseUrl}/api/orchestrator/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });

  if (!response.ok) {
    throw new Error(`Admin login failed: ${response.status} ${await response.text()}`);
  }

  const setCookie = response.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/auth_token=([^;]+)/);
  if (!match) {
    throw new Error('auth_token cookie not returned by login endpoint');
  }

  authCookie = `auth_token=${match[1]}`;
  return authCookie;
}

/**
 * Get the stored auth cookie (must call loginAsAdmin first).
 */
export function getAuthCookie(): string | undefined {
  return authCookie;
}

/**
 * Clear the stored auth cookie.
 */
export function clearAuthCookie(): void {
  authCookie = undefined;
}

/**
 * Setup integration test environment
 */
export async function setupIntegrationTest() {
  resetOrchestratorInstance();
  getConfigManager().updateConfig({ enablePersistence: false });
  orchestrator = getOrchestratorInstance();
  orchestrator.setSuppressPersistence(true);

  // Create Express app
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    next();
  });
  app.use('/api', router);
  app.use('/api/orchestrator', router);

  // Add Prometheus metrics endpoint
  app.get('/metrics', getPrometheusMetrics);

  // Health check endpoints (mirrors src/index.ts handlers)
  app.get('/health', (_req, res) => {
    const stats = orchestrator!.getStats();
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      orchestrator: stats,
    });
  });

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/health/ready', (_req, res) => {
    const servers = orchestrator!.getServers();
    const hasHealthy = servers.some((s: any) => s.healthy);
    if (hasHealthy) {
      res.json({ status: 'ready', healthyServers: servers.filter((s: any) => s.healthy).length });
    } else {
      res.status(503).json({
        status: 'not_ready',
        reason: 'No healthy servers available',
        totalServers: servers.length,
      });
    }
  });

  // Add error handling middleware
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('Integration test error:', err);
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON payload' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  // Start server
  server = createServer(app);
  await new Promise<void>(resolve => {
    server.listen(0, 'localhost', () => resolve());
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://localhost:${address.port}`;

  return { orchestrator, baseUrl };
}

export function getIntegrationTestBaseUrl(): string {
  if (!baseUrl) {
    throw new Error('setupIntegrationTest not called');
  }
  return baseUrl;
}

/**
 * Fetch a CSRF token from the test server's /csrf-token endpoint.
 * Returns the token value (64-char hex string).
 * Throws if the endpoint doesn't return a csrf-token cookie.
 */
export async function getCsrfToken(): Promise<string> {
  const response = await fetch(`${baseUrl}/api/orchestrator/auth/csrf-token`, {
    credentials: 'include',
  });
  const setCookie = response.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/csrf-token=([^;]+)/);
  if (!match) {
    throw new Error('CSRF token not returned by /csrf-token endpoint');
  }
  return match[1];
}

/**
 * Teardown integration test environment
 */
export async function teardownIntegrationTest() {
  if (server) {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  }
  if (orchestrator) {
    await orchestrator.shutdown();
    orchestrator = undefined;
  }
  resetOrchestratorInstance();
}

/**
 * Helper to make HTTP requests in tests
 */
export async function makeRequest(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: any,
  options?: {
    headers?: Record<string, string>;
    rawBody?: string;
    csrfToken?: string;
  }
): Promise<{ status: number; data: any; headers: Headers }> {
  const url = `${baseUrl}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      ...(options?.rawBody !== undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options?.csrfToken ? { 'x-csrf-token': options.csrfToken } : {}),
      ...(authCookie ? { Cookie: authCookie } : {}),
      ...(options?.headers ?? {}),
    },
    body:
      options?.rawBody !== undefined
        ? options.rawBody
        : body !== undefined
          ? JSON.stringify(body)
          : undefined,
  });

  let data: unknown;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  } else {
    try {
      data = await response.text();
    } catch {
      data = null;
    }
  }

  return {
    status: response.status,
    data,
    headers: response.headers,
  };
}
