import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    // Generates src/routeTree.gen.ts from src/routes/. Must come before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    // Installable, with the app shell cached (Blueprint C9, 4 "PWA": generateSW). Only the shell:
    // API responses are never cached, so nothing financial is ever shown stale from a cache.
    VitePWA({
      strategies: 'generateSW',
      // A new version waits until the person chooses to reload (UpdatePrompt), so a form being
      // filled in is never reloaded away.
      registerType: 'prompt',
      // Registered from the app's own code (virtual:pwa-register/react); an injected inline
      // script would break the CSP.
      injectRegister: false,
      manifest: {
        id: '/',
        name: 'FairShare',
        short_name: 'FairShare',
        description: 'Split shared expenses with friends, roommates and trip groups.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // The splash behind the icon while the installed app opens: the logo's tile teal.
        background_color: '#0E7C6B',
        theme_color: '#0e7c6b',
        icons: [
          { src: '/icons/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Any app address works offline from the cached shell; the API is never answered by it.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    // Never inline assets as data: URIs (Vite's default for files under 4 KB): the CSP allows
    // fonts and images from our own origin only, so an inlined font subset would be blocked.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    // In development the API runs separately; proxying keeps everything same-origin,
    // exactly like production, where the API serves this app under one domain.
    proxy: { '/api': API_ORIGIN },
  },
});
