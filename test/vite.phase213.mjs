import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { ssr: 'test/intent-ai/phase213-chat-surface-ui-probe.jsx', outDir: 'test/.out/phase213', emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } } }
});
