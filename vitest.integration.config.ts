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
    reporters: ['verbose', 'json'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      exclude: ['node_modules/', 'dist/', 'tests/', '**/*.d.ts', '**/*.config.ts'],
    },
  },
});
