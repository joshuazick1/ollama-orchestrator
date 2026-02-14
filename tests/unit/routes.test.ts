/**
 * routes.test.ts
 * Tests for orchestrator routes
 */

import { describe, it, expect } from 'vitest';
import orchestratorRoutes from '../../src/routes/orchestrator.js';

describe('Orchestrator Routes', () => {
  it('should load routes module', () => {
    expect(orchestratorRoutes).toBeDefined();
  });

  it('should export an Express Router', () => {
    expect(orchestratorRoutes).toBeDefined();
    expect(typeof orchestratorRoutes).toBe('function');
    expect(orchestratorRoutes.get).toBeDefined();
    expect(orchestratorRoutes.post).toBeDefined();
    expect(orchestratorRoutes.patch).toBeDefined();
    expect(orchestratorRoutes.delete).toBeDefined();
  });
});
