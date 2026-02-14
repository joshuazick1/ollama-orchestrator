/**
 * tests/setup.ts
 * Global test setup file for vitest
 *
 * This file sets up test isolation without globally mocking modules.
 * Individual test files should mock specific modules as needed.
 *
 * The main isolation mechanism is:
 * 1. Setting environment variables to disable features that cause side effects
 * 2. Resetting modules between tests
 */

import { vi, beforeEach, afterEach } from 'vitest';

// Set environment variables to disable persistence and health checks for all tests
// This ensures no real disk I/O or network calls happen by default
process.env.ORCHESTRATOR_ENABLE_PERSISTENCE = 'false';
process.env.ORCHESTRATOR_HEALTH_CHECK_ENABLED = 'false';

// Reset modules between tests to ensure clean state
beforeEach(() => {
  // Clear any cached module state
  vi.resetModules();
});

afterEach(() => {
  // Clear all mocks after each test
  vi.clearAllMocks();
});
