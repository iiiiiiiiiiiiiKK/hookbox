import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// `base: './'` keeps every asset URL relative so the same build can be served by
// the Cloudflare Worker, a static host, or a plain file server without changes.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    cssCodeSplit: true,
    reportCompressedSize: false,
  },
  server: {
    port: 5173,
    strictPort: false,
    // `npm run dev:api` (wrangler dev) serves the real Worker + local D1 on 8787.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/hook': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
});
