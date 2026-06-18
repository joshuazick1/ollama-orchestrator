/**
 * internal-admin.test.ts
 * Tests for isInternalAdmin and isInternalUser helpers
 */

import type { Request } from 'express';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { isInternalAdmin, isInternalUser } from '../../src/middleware/auth.js';

describe('isInternalAdmin', () => {
  let originalEnableAuth: string | undefined;
  let originalOrchestratorAuth: string | undefined;

  beforeEach(() => {
    originalEnableAuth = process.env.ENABLE_AUTH;
    originalOrchestratorAuth = process.env.ORCHESTRATOR_AUTH_ENABLED;
  });

  afterEach(() => {
    if (originalEnableAuth === undefined) {
      delete process.env.ENABLE_AUTH;
    } else {
      process.env.ENABLE_AUTH = originalEnableAuth;
    }
    if (originalOrchestratorAuth === undefined) {
      delete process.env.ORCHESTRATOR_AUTH_ENABLED;
    } else {
      process.env.ORCHESTRATOR_AUTH_ENABLED = originalOrchestratorAuth;
    }
  });

  it('should return true when auth is disabled and request has no auth', () => {
    // Auth disabled: set BOTH env vars to 'false'
    process.env.ENABLE_AUTH = 'false';
    process.env.ORCHESTRATOR_AUTH_ENABLED = 'false';

    const req = {} as Request;
    expect(isInternalAdmin(req)).toBe(true);
  });

  it('should return true when auth is enabled and isAdmin is true', () => {
    process.env.ENABLE_AUTH = 'true';
    delete process.env.ORCHESTRATOR_AUTH_ENABLED;

    const req = { auth: { isAdmin: true, apiKey: 'test-key' } } as unknown as Request;
    expect(isInternalAdmin(req)).toBe(true);
  });

  it('should return false when auth is enabled and isAdmin is false', () => {
    process.env.ENABLE_AUTH = 'true';
    delete process.env.ORCHESTRATOR_AUTH_ENABLED;

    const req = { auth: { isAdmin: false, apiKey: 'test-key' } } as unknown as Request;
    expect(isInternalAdmin(req)).toBe(false);
  });

  it('should return true when auth is disabled even if isAdmin is false', () => {
    // Auth disabled: set BOTH env vars to 'false'
    process.env.ENABLE_AUTH = 'false';
    process.env.ORCHESTRATOR_AUTH_ENABLED = 'false';

    const req = { auth: { isAdmin: false, apiKey: 'test-key' } } as unknown as Request;
    expect(isInternalAdmin(req)).toBe(true);
  });
});

describe('isInternalUser', () => {
  let originalEnableAuth: string | undefined;
  let originalOrchestratorAuth: string | undefined;

  beforeEach(() => {
    originalEnableAuth = process.env.ENABLE_AUTH;
    originalOrchestratorAuth = process.env.ORCHESTRATOR_AUTH_ENABLED;
  });

  afterEach(() => {
    if (originalEnableAuth === undefined) {
      delete process.env.ENABLE_AUTH;
    } else {
      process.env.ENABLE_AUTH = originalEnableAuth;
    }
    if (originalOrchestratorAuth === undefined) {
      delete process.env.ORCHESTRATOR_AUTH_ENABLED;
    } else {
      process.env.ORCHESTRATOR_AUTH_ENABLED = originalOrchestratorAuth;
    }
  });

  it('should return true when auth is disabled and request has no user', () => {
    // Auth disabled: set BOTH env vars to 'false'
    process.env.ENABLE_AUTH = 'false';
    process.env.ORCHESTRATOR_AUTH_ENABLED = 'false';

    const req = {} as Request;
    expect(isInternalUser(req)).toBe(true);
  });

  it('should return true when auth is enabled and user is defined', () => {
    process.env.ENABLE_AUTH = 'true';
    delete process.env.ORCHESTRATOR_AUTH_ENABLED;

    const req = { user: { id: 'x', role: 'user' } } as unknown as Request;
    expect(isInternalUser(req)).toBe(true);
  });

  it('should return false when auth is enabled and user is undefined', () => {
    process.env.ENABLE_AUTH = 'true';
    delete process.env.ORCHESTRATOR_AUTH_ENABLED;

    const req = { user: undefined } as unknown as Request;
    expect(isInternalUser(req)).toBe(false);
  });
});
