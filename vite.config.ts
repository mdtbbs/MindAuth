import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, 'frontend'),
  build: {
    outDir: resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    // Emit source maps so production stack traces (ErrorBoundary, Sentry-style
    // reporting) map back to original TSX instead of minified bundles
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'frontend/index.html'),
        admin: resolve(__dirname, 'frontend/admin.html'),
      },
      output: {
        // Split the stable React runtime into its own long-cached chunk so
        // business-code changes don't invalidate it
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'frontend/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
    },
  },
});
