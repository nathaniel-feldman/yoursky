import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const app = (p) => fileURLToPath(new URL(`./app/${p}`, import.meta.url));

export default defineConfig({
  root: app(''),
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: { main: app('index.html'), about: app('about.html') } },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['tests/**/*.test.js'],
  },
});
