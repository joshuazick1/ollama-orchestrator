import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'chaos',
    globals: true,
    environment: 'node',
    include: ['tests/chaos/**/*.test.ts'],
    exclude: ['node_modules/**'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
