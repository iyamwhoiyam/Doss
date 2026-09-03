import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true, ws: false },
      '/files': { target: API, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1200 },
});
