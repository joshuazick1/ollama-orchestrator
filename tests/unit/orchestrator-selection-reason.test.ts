import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../..');

describe('selectionReason values', () => {
  it('should use load_balancer for primary selection in orchestrator.ts', () => {
    const src = readFileSync(join(projectRoot, 'src/orchestrator/orchestrator.ts'), 'utf-8');
    const primaryCallCount = (src.match(/'load_balancer'/g) || []).length;
    expect(primaryCallCount).toBeGreaterThanOrEqual(2);
  });

  it('should use load_balancer for primary selection in routing.ts', () => {
    const src = readFileSync(join(projectRoot, 'src/orchestrator/routing.ts'), 'utf-8');
    expect(src.includes("'load_balancer'")).toBe(true);
  });
});
