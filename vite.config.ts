import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Pastime',
        short_name: 'Pastime',
        description: 'Track the shows, movies, books and games you watch, read and play.',
        theme_color: '#eef0eb',
        background_color: '#eef0eb',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Include the self-hosted fonts so the app looks right offline.
        globPatterns: ['**/*.{js,css,html,woff2}'],
        runtimeCaching: [
          {
            // Cover art only (never API responses): keep it so the library looks right offline.
            urlPattern: /^https:\/\/(upload\.wikimedia\.org|static\.tvmaze\.com|covers\.openlibrary\.org|coverartarchive\.org|[a-z0-9-]+\.us\.archive\.org|image\.tmdb\.org|media\.rawg\.io|s4\.anilist\.co|[a-z0-9-]+\.mzstatic\.com)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'covers',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
