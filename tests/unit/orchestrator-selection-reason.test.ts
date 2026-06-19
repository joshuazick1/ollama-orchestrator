import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/storage/metrics-store.js');

describe('selectionReason values', () => {
  it('should use load_balancer for primary selection in orchestrator.ts', async () => {
    const mod = await import('../src/orchestrator/orchestrator.js');
    const src = mod.Orchestrator?.toString() ?? '';
    const primarySelectionCode = src.includes('load_balancer');
    expect(primarySelectionCode).toBe(true);
  });

  it('should use load_balancer for primary selection in routing.ts', async () => {
    const mod = await import('../src/orchestrator/routing.js');
    const src = mod.RoutingPipeline?.toString() ?? '';
    const primarySelectionCode = src.includes('load_balancer');
    expect(primarySelectionCode).toBe(true);
  });
});
