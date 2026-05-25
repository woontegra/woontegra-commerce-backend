import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    setupFiles:  ['./tests/integration/setup.ts', './tests/setup.ts'],
    globalTeardown: './tests/integration/teardown.ts',
    include:     ['tests/integration/**/*.integration.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    maxWorkers:      1,
    pool:            'forks',
  },
});
