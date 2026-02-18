/**
 * routes.test.ts
 * Tests for orchestrator routes
 */

import { describe, it, expect } from 'vitest';
import * as orchestratorRoutes from '../../src/routes/orchestrator.js';

describe('Orchestrator Routes', () => {
  it('should load routes module', () => {
    expect(orchestratorRoutes).toBeDefined();
  });

  it('should export monitoring router', () => {
    expect(orchestratorRoutes.monitoringRouter).toBeDefined();
    expect(typeof orchestratorRoutes.monitoringRouter).toBe('function');
    expect(orchestratorRoutes.monitoringRouter.get).toBeDefined();
  });

  it('should export admin router', () => {
    expect(orchestratorRoutes.adminRouter).toBeDefined();
    expect(typeof orchestratorRoutes.adminRouter).toBe('function');
    expect(orchestratorRoutes.adminRouter.get).toBeDefined();
  });
});
