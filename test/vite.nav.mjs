import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { ssr: 'test/nav-probe.jsx', outDir: 'test/.out/nav', emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } } } });
