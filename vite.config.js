import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  root: '.',
  server: {
    port: 8080,
    open: true,
    strictPort: true,
    host: 'localhost'
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
