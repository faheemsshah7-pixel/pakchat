import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The tests against a real Phoenix server only run with `npm run test:server`.
    exclude: process.env.PAKCHAT_E2E ? ['node_modules/**'] : ['node_modules/**', 'test/e2e/**'],
    testTimeout: 30_000,
  },
});
