import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // so a tunnel (ngrok/cloudflared) can reach the dev server
    port: 5173,
    proxy: {
      // keep API keys server-side even in dev
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
          charts: ['recharts'],
          i18n: ['i18next', 'react-i18next']
        }
      }
    }
  }
});
