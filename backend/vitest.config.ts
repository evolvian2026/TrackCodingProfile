import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    setupFiles: ['tests/setup.ts'],
    // The integration suites share one PostgreSQL database and truncate it
    // between cases, so test *files* must not run concurrently.
    fileParallelism: false,
  },
});
