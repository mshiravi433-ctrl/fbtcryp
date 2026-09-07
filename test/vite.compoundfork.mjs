import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Bundles the adapter shim the Compound Base fork probe imports.
 *
 * Same reason as test/vite.aavefork.mjs: the app's modules use extensionless
 * specifiers and `import.meta.env`, so the probe has to run against a bundle
 * produced by the real resolver. Anything less would be a probe of a copy.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"development"',
    /*
     * The probe asserts the shipped defaults, so the bundle is built with the
     * flag OFF exactly as a store build is. The fork run must prove the money
     * path works with the caps at 100/500 — a probe that quietly raised them
     * would be proving a configuration nobody ships.
     */
    __COMPOUND_BASE_SUPPLY_ENABLED__: 'false'
  },
  build: {
    ssr: 'test/compound-base-fork-adapter.mjs',
    outDir: 'test/.out/compoundfork',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } }
  }
});
