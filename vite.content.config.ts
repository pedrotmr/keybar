import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import artifacts from './extension-artifacts.json';

export function contentConfig(surface: 'commands' | 'tabs') {
  const { entry, file: fileName } = artifacts.contentSurfaces[surface];

  return defineConfig({
    configFile: false,
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      cssCodeSplit: false,
      lib: {
        entry: path.resolve(__dirname, entry),
        name: 'CommandCenterOverlay',
        formats: ['iife'],
        fileName: () => fileName,
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });
}
