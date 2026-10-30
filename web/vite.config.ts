import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.8.0') },
  // The shared core lives next door (../shared), outside this folder.
  server: { fs: { allow: ['..'] } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        // React and the shared core go in files of their own. They change less often than
        // the screens, so after an update browsers keep them and download only what changed.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'core', test: /[\\/]shared[\\/]src[\\/]|node_modules[\\/]phoenix[\\/]/ },
          ],
        },
      },
    },
  },
})
