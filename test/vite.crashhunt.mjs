import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Signals crash-hunt probe bundle — same recipe as test/vite.signalspage.mjs. */
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: {
    ssr: 'test/signals-crash-hunt-probe.jsx',
    outDir: 'test/.out/crashhunt',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } }
  }
});
