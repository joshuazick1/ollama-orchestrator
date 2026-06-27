import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'stress',
    globals: true,
    environment: 'node',
    include: ['tests/stress/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    reporters: ['verbose', 'json'],
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
