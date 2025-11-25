import path from "path"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      // Proxy Socket.IO connections to wrangler dev server
      '/socket.io': {
        target: 'http://localhost:8787',
        ws: true,
        changeOrigin: true
      },
      // Proxy WebSocket connections to wrangler dev server
      '/ws': {
        target: 'http://localhost:8787',
        ws: true,
        changeOrigin: true
      },
      // Proxy API calls to wrangler dev server
      '/api': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
      '/setup': 'http://localhost:8787',
      '/users': 'http://localhost:8787',
      '/sandbox': 'http://localhost:8787'
    }
  },
  build: {
    outDir: '../public',
    emptyOutDir: true
  }
})
