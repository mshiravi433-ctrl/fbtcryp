import { defineConfig } from 'vite';

/**
 * Signal-intelligence probe bundle.
 * The probe imports client modules that use extensionless specifiers
 * (`./backtest`) and `import.meta.env` plus server modules that import
 * Node built-ins — Vite resolves the former and externalizes the latter,
 * exactly like the app's own build does.
 */
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"development"' },
  build: {
    ssr: 'test/signals-intel-probe.mjs',
    outDir: 'test/.out/signalintel',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } }
  }
});
