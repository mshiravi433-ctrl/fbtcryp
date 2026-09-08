import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"development"',
    __MORPHO_BASE_SUPPLY_ENABLED__: 'false'
  },
  build: {
    ssr: 'test/morpho-base-fork-adapter.mjs',
    outDir: 'test/.out/morphofork',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } }
  }
});
