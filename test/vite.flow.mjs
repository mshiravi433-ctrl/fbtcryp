import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: { ssr: 'test/first-launch-flow.jsx', outDir: 'test/.out/flow', emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } } }
});
