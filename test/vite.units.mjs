import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The unit suite imports app modules that use extensionless specifiers
 * (`./chains`) and `import.meta.env`, neither of which plain Node resolves.
 * Bundling with the same resolver the app uses means the test exercises the
 * real module graph rather than a hand-maintained copy of it.
 */
export default defineConfig({
  /* tokenIcon.jsx is a .jsx module, so the unit bundle needs the React plugin. */
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"development"' },
  build: {
    ssr: 'test/units.mjs',
    outDir: 'test/.out/units',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'es' } }
  }
});
