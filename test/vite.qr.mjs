import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { ssr: 'test/qr-camera-probe.jsx', outDir: 'test/.out/qr', emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } } }
});
