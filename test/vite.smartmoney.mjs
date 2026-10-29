import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Smart Money desk probe bundle.
 *
 * Same shape as test/vite.tokensmartmoney.mjs: the page imports client modules
 * that use extensionless specifiers and `import.meta.env` (lib/chains,
 * lib/smartMoneyClient), so Vite resolves them exactly as the app's own build
 * does. Plain node cannot run JSX.
 */
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: {
    ssr: 'test/smart-money-desk-probe.jsx',
    outDir: 'test/.out/smartmoney',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } }
  }
});
