import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { ssr: 'test/intent-ai/intent-os-repair-probe.jsx', outDir: 'test/.out/intent-os-repair', emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } } }
});
