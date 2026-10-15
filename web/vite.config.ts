import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Firebase is a big library, so our app file is about 0.7 MB. That's fine; don't warn about it.
  build: { chunkSizeWarningLimit: 1000 },
})
