import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:    true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include:    ['tests/**/*.test.ts'],
    exclude:    ['tests/integration/**', 'node_modules/**'],
    coverage:   { enabled: false },
    testTimeout: 15_000,
  },
});
