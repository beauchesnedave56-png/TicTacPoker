import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isProd = process.env.NODE_ENV === 'production';

export default defineConfig({
  base: isProd ? '/TicTacPoker/' : '/',
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
