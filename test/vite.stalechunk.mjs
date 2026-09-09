import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: {
    ssr: 'test/stale-chunk-loop-probe.jsx',
    outDir: 'test/.out/stalechunk',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } }
  }
});
