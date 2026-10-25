import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';

// Stamp the service worker with a build id, so each deploy installs a new worker that
// re-caches the app and drops the previous version's files.
const stampServiceWorker = {
  name: 'stamp-sw',
  apply: 'build',
  writeBundle({ dir }) {
    const file = `${dir}/sw.js`;
    writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD__', Date.now().toString(36)));
  },
};

export default defineConfig({
  base: './',
  plugins: [stampServiceWorker],
});
