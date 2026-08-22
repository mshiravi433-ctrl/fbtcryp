import { defineConfig } from 'vite';

/**
 * The client probe imports app modules that use extensionless specifiers
 * (`./apiBase`) and `import.meta.env`, neither of which plain Node resolves.
 * Bundling with the same resolver the app uses means the test exercises the
 * real module graph rather than a hand-maintained copy of it.
 */
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"development"' },
  build: {
    ssr: 'test/solana-client-probe.mjs',
    outDir: 'test/.out/solana-client',
    emptyOutDir: true,
    /*
     * The root config's build.target is 'es2020' for the browser bundle;
     * this bundle runs under Node, where top-level await is fine. Without
     * the override esbuild refuses the TLA the probe uses.
     */
    target: 'node20',
    rollupOptions: { output: { format: 'es' } }
  }
});
