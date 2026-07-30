import { defineConfig } from 'vite';
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { ssr: 'test/scrolllock-probe.jsx', outDir: 'test/.out/scrolllock', emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } } }
});
