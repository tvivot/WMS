import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // base '/' es crítico: los assets resuelven desde la raíz del dominio,
  // que es donde NestJS sirve los estáticos.
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // Solo en dev: proxy al API. En prod es mismo origen (Nest sirve ambos).
    proxy: {
      '/api': 'http://localhost:3000',
      // Imágenes subidas (portadas) las sirve el API bajo /uploads.
      '/uploads': 'http://localhost:3000',
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['brand/*'],
      manifest: {
        name: 'WMS Grupal — Devoluciones',
        short_name: 'WMS Grupal',
        description: 'WMS Grupal — gestión de devoluciones de libros.',
        display: 'standalone',
        start_url: '/',
        background_color: '#ffffff',
        theme_color: '#0b0b0b',
        icons: [
          { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/brand/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
});
