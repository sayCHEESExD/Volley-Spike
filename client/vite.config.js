import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Dev server only: tell the page it runs in Boxity's 'local' environment. Never part of a
// production build (Boxity injects the real environment into the pages it serves).
const LOCAL_ENV = { env: 'local', apiUrl: 'http://localhost:4000', playUrl: 'http://localhost:2567', portalUrl: 'http://localhost:3000', staticUrl: 'https://static.bloxity.io' };
const boxityLocalEnv = {
  name: 'boxity-local-env',
  apply: 'serve',
  transformIndexHtml: () => [{ tag: 'script', children: `window.BLOXITY_ENV = ${JSON.stringify(LOCAL_ENV)};`, injectTo: 'head-prepend' }],
};

export default defineConfig({
  root: here,
  plugins: [boxityLocalEnv],
  base: './',
  publicDir: path.join(here, 'public'),
  resolve: { alias: { '@shared': path.join(here, '..', 'shared') } },
  server: { port: 5173, host: true, fs: { allow: [path.join(here, '..')] } },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
    reportCompressedSize: false,
  },
});
