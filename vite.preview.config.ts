import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: resolve(projectRoot, 'frontend'),
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'frontend/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4002',
        changeOrigin: true,
      },
    },
  },
});
