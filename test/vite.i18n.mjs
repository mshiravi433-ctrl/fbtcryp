import { defineConfig } from 'vite';
export default defineConfig({
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { ssr: 'test/i18n-probe.jsx', outDir: 'test/.out/i18n', emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } } }
});
