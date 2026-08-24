import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

const REPO_ROOT = process.cwd();

describe('scripts/sync-types.sh', () => {
  it('runtime-snapshot.ts is mirrored to frontend/src/types/generated/runtime-snapshot.ts', () => {
    const generated = join(REPO_ROOT, 'frontend/src/types/generated/runtime-snapshot.ts');
    expect(existsSync(generated), `Expected ${generated} to exist`).toBe(true);

    const content = readFileSync(generated, 'utf-8');
    expect(content).toContain('// AUTO-GENERATED — do not edit');
    expect(content).toContain('RuntimeSnapshotV1');
    expect(content).toContain('schemaVersion');
    expect(content).toContain('sequence');
    expect(content).toContain('circuitBreakerDetails');
  });

  it('generated runtime-snapshot.ts contains TupleState and TupleKey mirrors', () => {
    const generated = join(REPO_ROOT, 'frontend/src/types/generated/runtime-snapshot.ts');
    const content = readFileSync(generated, 'utf-8');
    // TupleKey and TupleState must be inlined (backend-only modules stripped)
    expect(content).toContain('TupleKey');
    expect(content).toContain('TupleState');
    // Original relative imports must NOT appear in generated output
    expect(content).not.toContain("from '../probe/probe-orchestrator.js'");
    expect(content).not.toContain("from '../probe/types.js'");
  });

  it('generated runtime-snapshot.ts exports RuntimeSnapshotV1 interface', () => {
    const generated = join(REPO_ROOT, 'frontend/src/types/generated/runtime-snapshot.ts');
    const content = readFileSync(generated, 'utf-8');
    // Must have the interface declaration
    expect(content).toMatch(/export interface RuntimeSnapshotV1/);
    // All 7 groups must be present
    expect(content).toContain('stats:');
    expect(content).toContain('metrics:');
    expect(content).toContain('circuitBreakers:');
    expect(content).toContain('servers:');
    expect(content).toContain('modelMap:');
    expect(content).toContain('inFlight:');
    expect(content).toContain('circuitBreakerDetails:');
  });

  it('orchestrator.types.ts is still mirrored alongside the new target', () => {
    const generated = join(REPO_ROOT, 'frontend/src/types/generated/orchestrator.types.ts');
    expect(existsSync(generated), `Expected ${generated} to exist`).toBe(true);
    const content = readFileSync(generated, 'utf-8');
    expect(content).toContain('// AUTO-GENERATED — do not edit');
    expect(content).toContain('ProbeEndpoint');
  });
});
