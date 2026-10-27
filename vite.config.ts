import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative Pfade, damit die App unter https://<name>.github.io/Lagebild/ und lokal gleich funktioniert.
  base: './',
  build: {
    target: 'es2022',
    // Kartendaten nicht als Base64 ins JS einbetten, sondern als eigene Dateien (cachebar, offline-fähig).
    assetsInlineLimit: 0
  },
  plugins: [
    VitePWA({
      // Neue Versionen übernehmen beim nächsten Öffnen, ohne laufende Wiedergabe neu zu laden.
      registerType: 'autoUpdate',
      injectRegister: 'script',
      manifest: {
        name: 'Lagebild',
        short_name: 'Lagebild',
        description: 'Dein tägliches News-Update mit Globus, Stimme und Untertiteln.',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#05070a',
        theme_color: '#05070a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // App, Karten, deutsche Schriftschnitte und Demo sofort offline verfügbar
        globPatterns: ['**/*.{js,css,html}', 'assets/countries-*.json', 'assets/*-latin-*.woff2', 'assets/*-latin-ext-*.woff2', 'icons/apple-touch-icon.png', 'demo/*.json'],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Tages-Updates: immer zuerst frisch aus dem Netz, offline aus dem Cache
            urlPattern: ({ url }) => /\/data\/[^/]+\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'lagebild-daten', networkTimeoutSeconds: 4, expiration: { maxEntries: 60 } }
          },
          {
            // Sprachaufnahmen ändern sich nie; Range-Anfragen von Safari aus dem Cache bedienen
            urlPattern: ({ url }) => url.pathname.includes('/data/audio/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'lagebild-audio',
              rangeRequests: true,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 21 }
            }
          },
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: { cacheName: 'lagebild-fonts', expiration: { maxEntries: 60 } }
          }
        ]
      }
    })
  ]
});
