import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['./tests/integration/setup.ts'],
  },
});
