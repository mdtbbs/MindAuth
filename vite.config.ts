import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'frontend'),
  build: {
    outDir: resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'frontend/index.html'),
        admin: resolve(__dirname, 'frontend/admin.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
