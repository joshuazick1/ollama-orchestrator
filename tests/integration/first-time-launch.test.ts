/**
 * first-time-launch.test.ts
 * Integration tests for first-time launch setup wizard flow
 * Tests: empty user DB redirect, /auth/me needsSetup, POST /setup validation,
 * weak password rejection, invalid username rejection, post-setup state
 */

import fs from 'fs';
import path from 'path';

import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  setupIntegrationTest,
  teardownIntegrationTest,
  makeRequest,
  getCsrfToken,
} from './setup.js';

describe('First-Time Launch Integration Tests', () => {
  // Path to the user store database
  const USER_DB_PATH = path.join(process.cwd(), 'data', 'users.db');
  const USER_DB_BAK_PATH = path.join(process.cwd(), 'data', 'users.db.test-bak');

  let originalEnableAuth: string | undefined;

  beforeAll(async () => {
    // Ensure auth is enabled for these tests
    originalEnableAuth = process.env.ENABLE_AUTH;
    process.env.ENABLE_AUTH = 'true';
    await setupIntegrationTest();
  });

  afterAll(async () => {
    // Restore original ENABLE_AUTH
    if (originalEnableAuth === undefined) {
      delete process.env.ENABLE_AUTH;
    } else {
      process.env.ENABLE_AUTH = originalEnableAuth;
    }
    await teardownIntegrationTest();
  });

  /**
   * Backup the user DB before each test
   */
  beforeEach(() => {
    if (fs.existsSync(USER_DB_PATH)) {
      fs.copyFileSync(USER_DB_PATH, USER_DB_BAK_PATH);
      fs.unlinkSync(USER_DB_PATH);
    }
  });

  /**
   * Restore the user DB after each test
   */
  afterEach(() => {
    if (fs.existsSync(USER_DB_BAK_PATH)) {
      if (fs.existsSync(USER_DB_PATH)) {
        fs.unlinkSync(USER_DB_PATH);
      }
      fs.renameSync(USER_DB_BAK_PATH, USER_DB_PATH);
    }
  });

  // ============================================================
  // SCENARIO 1: With empty user DB, GET / redirects to /setup (302)
  // ============================================================
  describe('Empty user DB redirect scenarios', () => {
    it('1. GET / redirects to /setup with empty user DB (302)', async () => {
      const response = await makeRequest('GET', '/');
      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('/setup');
    });
  });

  // ============================================================
  // SCENARIO 2: With empty user DB, GET /api/orchestrator/auth/me returns needsSetup: true
  // ============================================================
  describe('Auth /me endpoint with empty user DB', () => {
    it('2. GET /api/orchestrator/auth/me returns needsSetup: true with empty user DB', async () => {
      const response = await makeRequest('GET', '/api/orchestrator/auth/me');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('needsSetup', true);
    });
  });

  // ============================================================
  // SCENARIO 3: With empty user DB, POST /api/orchestrator/setup with valid input returns 200
  // ============================================================
  describe('Setup endpoint with valid input', () => {
    it('3. POST /api/orchestrator/setup with valid credentials returns 200', async () => {
      const csrfToken = await getCsrfToken();
      const response = await makeRequest(
        'POST',
        '/api/orchestrator/setup',
        {
          username: 'admin',
          email: 'admin@example.com',
          password: 'Admin@Pass123!Secure2024',
        },
        { csrfToken }
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });
  });

  // ============================================================
  // SCENARIO 4: After setup, subsequent /auth/me returns needsSetup: false
  // ============================================================
  describe('Post-setup /auth/me state', () => {
    it('4. After setup, /auth/me returns needsSetup: false', async () => {
      // First perform setup
      const csrfToken = await getCsrfToken();
      await makeRequest(
        'POST',
        '/api/orchestrator/setup',
        {
          username: 'newadmin',
          email: 'newadmin@example.com',
          password: 'Admin@Pass123!Secure2024',
        },
        { csrfToken }
      );

      // Now check /auth/me
      const response = await makeRequest('GET', '/api/orchestrator/auth/me');
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('needsSetup', false);
      expect(response.data.user).toHaveProperty('username', 'newadmin');
    });
  });

  // ============================================================
  // SCENARIO 5: After setup, setup endpoint returns 403
  // ============================================================
  describe('Post-setup setup endpoint rejection', () => {
    it('5. After setup, POST /api/orchestrator/setup returns 403', async () => {
      // First perform setup
      const csrfToken = await getCsrfToken();
      await makeRequest(
        'POST',
        '/api/orchestrator/setup',
        {
          username: 'anotheradmin',
          email: 'another@example.com',
          password: 'Admin@Pass123!Secure2024',
        },
        { csrfToken }
      );

      // Try to setup again
      const response = await makeRequest(
        'POST',
        '/api/orchestrator/setup',
        {
          username: 'shouldfail',
          email: 'fail@example.com',
          password: 'Admin@Pass123!Secure2024',
        },
        { csrfToken }
      );
      expect(response.status).toBe(403);
      expect(response.data).toHaveProperty('error', 'Setup already completed');
    });
  });

  // ============================================================
  // SCENARIO 6: Weak password rejected (≤16 chars)
  // ============================================================
  describe('Password validation', () => {
    it('6. Weak password (≤16 chars) is rejected', async () => {
      const csrfToken = await getCsrfToken();

      // Test with 16 char password (minimum boundary - should fail)
      const response = await makeRequest(
        'POST',
        '/api/orchestrator/setup',
        {
          username: 'testuser1',
          email: 'test1@example.com',
          password: 'Admin@Pass123!', // 15 chars - too short
        },
        { csrfToken }
      );
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error', 'Invalid input');
    });

    it('6b. Password at exactly 16 chars is accepted', async () => {
      const csrfToken = await getCsrfToken();

      // Test with 16 char password (exactly at minimum - should pass)
      const response = await makeRequest(
        'POST',
        '/api/orchestrator/setup',
        {
          username: 'testuser16',
          email: 'test16@example.com',
          password: 'Admin@Pass123!!', // 16 chars - exactly at minimum
        },
        { csrfToken }
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });
  });

  // ============================================================
  // SCENARIO 7: Invalid username (special chars) rejected
  // ============================================================
  describe('Username validation', () => {
    it('7. Invalid username with special characters is rejected', async () => {
      const csrfToken = await getCsrfToken();

      // Test with invalid username containing special characters
      const response = await makeRequest(
        'POST',
        '/api/orchestrator/setup',
        {
          username: 'admin@#$%',
          email: 'invalidadmin@example.com',
          password: 'Admin@Pass123!Secure2024',
        },
        { csrfToken }
      );
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error', 'Invalid input');
    });

    it('7b. Valid username with allowed characters is accepted', async () => {
      const csrfToken = await getCsrfToken();

      // Test with valid username (alphanumeric, underscore, hyphen)
      const response = await makeRequest(
        'POST',
        '/api/orchestrator/setup',
        {
          username: 'valid-admin_123',
          email: 'valid@example.com',
          password: 'Admin@Pass123!Secure2024',
        },
        { csrfToken }
      );
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('success', true);
    });
  });
});
