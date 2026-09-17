import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: {
    ssr: 'test/wallet-connect-sheet-probe.jsx',
    outDir: 'test/.out/wcsheet',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } }
  }
});
