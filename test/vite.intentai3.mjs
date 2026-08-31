import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { ssr: 'test/intent-ai/phase209-command-deck-probe.jsx', outDir: 'test/.out/intentai3', emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } } }
});
