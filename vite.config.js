import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const rawBase = process.env.VITE_BASE || '/'
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png', 'favicon.png'],
      manifest: {
        name: 'La Cartha — Administración',
        short_name: 'La Cartha',
        description: 'Administración de La Cartha by Valentina Castro',
        theme_color: '#4A1C00',
        background_color: '#FFF6E5',
        display: 'standalone',
        orientation: 'portrait',
        start_url: `${base}admin`,
        scope: base,
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          {
            src: `${base}icons/icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
})
