// Tests for the app's own logic that run on a computer (npm test).
// The screens are tested on a phone with Maestro instead (maestro/).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    // shared/ is a separate folder; use the app's one copy of vitest for both.
    dedupe: ['vitest'],
  },
});
