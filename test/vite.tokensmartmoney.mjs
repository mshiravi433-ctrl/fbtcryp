import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Token Smart Money card probe bundle.
 *
 * Same shape as test/vite.coindetail.mjs and test/vite.signalspage.mjs: the
 * probe imports client modules that use extensionless specifiers and
 * `import.meta.env` (lib/chains, lib/smartMoneyClient), so Vite resolves them
 * exactly as the app's own build does. Plain node cannot run it.
 */
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: {
    ssr: 'test/token-smart-money-probe.jsx',
    outDir: 'test/.out/tokensmartmoney',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } }
  }
});
