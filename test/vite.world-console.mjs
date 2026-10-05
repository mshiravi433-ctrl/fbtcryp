import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { ssr: 'test/intent-ai/world-console-probe.jsx', outDir: 'test/.out/world-console', emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } } }
});
