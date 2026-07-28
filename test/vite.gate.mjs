import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { ssr: 'test/guide-gate.jsx', outDir: 'test/.out/gate', emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } } }
});
