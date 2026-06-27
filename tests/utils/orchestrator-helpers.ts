/**
 * orchestrator-helpers.ts
 *
 * Test helpers for orchestrator utilities removed during the probe refactor (commit 416a016).
 * These pure functions were originally private methods on AIOrchestrator and are now extracted
 * here for tests that need them.
 *
 * See .sisyphus/plans/test-failure-cleanup.md for context.
 */

export function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export function extractModelsFromResponse(response: unknown): string[] {
  if (!response || typeof response !== 'object') {
    return [];
  }
  const resp = response as { models?: unknown };
  if (!resp.models || !Array.isArray(resp.models)) {
    return [];
  }
  return resp.models
    .map((m: unknown) => {
      if (typeof m === 'string') {
        return m;
      }
      if (typeof m === 'object' && m !== null) {
        const record = m as Record<string, unknown>;
        return (
          (record['model'] as string | undefined) ?? (record['name'] as string | undefined) ?? null
        );
      }
      return null;
    })
    .filter(Boolean) as string[];
}
