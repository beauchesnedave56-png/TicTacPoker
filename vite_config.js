import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: '.',
  server: {
    port: 8080,
    open: true,
    strictPort: true,
    host: true // écoute sur le réseau local, pas seulement localhost — nécessaire pour tester depuis un téléphone
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
