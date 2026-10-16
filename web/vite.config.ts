import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Firebase and React go in files of their own. They only change when we update them,
        // so after a new PakChat version, browsers keep them and download just our own code.
        // (Screens that load later get their own small files too: see src/screens/lazy.ts.)
        codeSplitting: {
          groups: [
            // (Firebase's database part is big, so it gets a file of its own: smaller files arrive side by side.)
            { name: 'firestore', test: /node_modules[\\/]@firebase[\\/]firestore[\\/]/ },
            { name: 'firebase', test: /node_modules[\\/](@firebase|firebase)[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
})
