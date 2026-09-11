import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Signals token-picker probe bundle.
 *
 * Built the same way as test/vite.signalspage.mjs: the probe imports client
 * modules that use extensionless specifiers and `import.meta.env`, so Vite
 * resolves them exactly as the app's own build does.
 */
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: {
    ssr: 'test/signals-token-picker-probe.jsx',
    outDir: 'test/.out/signalspicker',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } }
  }
});
