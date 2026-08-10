// Builds the real app as a single classic script so jsdom (which has no ES
// module support) can actually execute it. Same source, same imports.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"',
    /* Mirror the store build. Without the literal, Rollup cannot prove the
       dYdX dynamic import unreachable and an IIFE has to inline its Node-heavy
       client even though the route is off. */
    __SPECULATION_ENABLED__: 'false'
  },
  build: {
    outDir: 'test/.out/iife',
    emptyOutDir: true,
    lib: { entry: 'src/main.jsx', formats: ['iife'], name: 'FBTApp', fileName: () => 'app.js' },
    cssCodeSplit: false
  }
});
