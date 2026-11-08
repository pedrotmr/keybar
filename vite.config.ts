import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import artifacts from './extension-artifacts.json';
import manifest from './src/manifest.json';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, artifacts.popupHtml),
        background: path.resolve(__dirname, artifacts.background.entry),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? manifest.background.service_worker : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
