import { createRequire } from 'node:module';

import { defineConfig } from 'vitest/config';

// Playwright isn't a dependency of the site: use the one installed on the machine.
const require = createRequire(import.meta.url);
const playwright = require.resolve('playwright', { paths: [process.cwd(), ...(process.env.NODE_PATH ?? '').split(':').filter(Boolean)] });

export default defineConfig({
  resolve: { alias: { playwright } },
  test: { include: ['e2e/**/*.e2e.ts'], environment: 'node', testTimeout: 120_000, hookTimeout: 60_000 },
});
