import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    // Generates src/routeTree.gen.ts from src/routes/. Must come before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    // In development the API runs separately; proxying keeps everything same-origin,
    // exactly like production, where the API serves this app under one domain.
    proxy: { '/api': API_ORIGIN },
  },
});
