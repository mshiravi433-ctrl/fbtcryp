import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { ssr: 'test/intent-ai/phase201-ai-panel-upgrade-probe.jsx', outDir: 'test/.out/intentai2', emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } } }
});
