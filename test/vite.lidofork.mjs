import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Bundle the real Lido adapter for the Ethereum mainnet fork probe. */
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"development"',
    __LIDO_STAKE_ENABLED__: 'false'
  },
  build: {
    ssr: 'test/lido-fork-adapter.mjs',
    outDir: 'test/.out/lidofork',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } }
  }
});
