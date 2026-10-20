import { defineConfig } from 'vitest/config';

// The app's tsconfig points at Expo's, which isn't installed in this folder,
// so tell the compiler not to look for it.
export default defineConfig({
  // @ts-expect-error: Vite reads this option but leaves it out of its types.
  oxc: { tsconfig: false },
});
