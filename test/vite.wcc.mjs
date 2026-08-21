import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins:[react()], define:{'process.env.NODE_ENV':'"development"'},
  build:{ ssr:'test/wallet-command-center-probe.jsx', outDir:'test/.out/wcc', emptyOutDir:true,
    rollupOptions:{output:{format:'es'}} } });
