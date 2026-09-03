import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Signals-page DOM probe bundle.
 *
 * Built the same way as test/vite.coindetail.mjs and test/vite.signalintel.mjs:
 * the probe imports client modules that use extensionless specifiers and
 * `import.meta.env`, plus server modules that reach for Node built-ins, so
 * Vite resolves the former and externalizes the latter exactly as the app's
 * own build does. Running it as plain node cannot work — src/lib/ai.js imports
 * './backtest' with no extension.
 */
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: {
    ssr: 'test/signals-page-probe.jsx',
    outDir: 'test/.out/signalspage',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } }
  }
});
