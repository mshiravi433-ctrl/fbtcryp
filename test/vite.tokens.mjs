import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    ssr: 'test/token-list.mjs',
    outDir: 'test/.out/tokens',
    emptyOutDir: true,
    target: 'node20',
    rollupOptions: { output: { format: 'es' }, external: ['jsdom'] }
  }
});
