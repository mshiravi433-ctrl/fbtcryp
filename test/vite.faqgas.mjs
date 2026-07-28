import { defineConfig } from 'vite';
export default defineConfig({
  build: { ssr: 'test/faq-gas.mjs', outDir: 'test/.out/faqgas', emptyOutDir: true,
    target: 'node20', rollupOptions: { output: { format: 'es' } } }
});
