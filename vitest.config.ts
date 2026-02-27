import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'unit',
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/integration/**', 'tests/e2e/**', 'tests/chaos/**', 'node_modules/**'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.ts',
        'vitest.*.ts',
        '.commitlintrc.js',
        'load-servers*.mjs',
        'test-*.mjs',
        'test.ts',
        'src/index.ts',
        'src/**/index.ts',
      ],
      thresholds: {
        lines: 55,
        functions: 60,
        branches: 45,
        statements: 55,
      },
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
