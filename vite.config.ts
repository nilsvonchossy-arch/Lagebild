import { defineConfig } from 'vite';

export default defineConfig({
  // Relative Pfade, damit die App unter https://<name>.github.io/Lagebild/ und lokal gleich funktioniert.
  base: './',
  build: {
    target: 'es2022',
    // Kartendaten nicht als Base64 ins JS einbetten, sondern als eigene Dateien (cachebar, offline-fähig).
    assetsInlineLimit: 0
  }
});
