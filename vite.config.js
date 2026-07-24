import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // needed so Telegram (via ngrok/tunnel) can reach the dev server
    port: 5173
  }
});
