import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  /**
   * Compile the arcade flag to a literal.
   *
   * The flag used to be read via `import.meta.env.VITE_ENABLE_GAMES` inside a
   * ternary. Vite substitutes that at build time, but the substituted value is
   * a STRING comparison, and Rollup would not treeshake the
   * `lazy(() => import('./pages/Play'))` branch — so a 22KB Play chunk plus
   * every game shipped in the bundle even with the flag off. The whole point
   * of the flag is that a store reviewer cannot find the code by unzipping the
   * APK, and "unreachable route, code still present" does not achieve that.
   *
   * Defining it as a bare `true`/`false` literal lets Rollup prove the branch
   * is dead and drop the dynamic import entirely. Verified by checking that no
   * Play chunk is emitted.
   */
  define: {
    __GAMES_ENABLED__: JSON.stringify(process.env.VITE_ENABLE_GAMES === 'true')
  },
  server: {
    host: true, // so a tunnel (ngrok/cloudflared) can reach the dev server
    port: 5173,
    proxy: {
      // keep API keys server-side even in dev
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
          charts: ['recharts'],
          i18n: ['i18next', 'react-i18next']
        }
      }
    }
  }
});
