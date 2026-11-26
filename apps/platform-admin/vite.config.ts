import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      // Central auth (Phase 4): same-origin /api/better-auth/* goes to
      // the auth service, BEFORE the catch-all /api/* below (Vite
      // matches proxy keys in insertion order). Mirrors the Caddy
      // override on the console host. Dev-only: production routing is
      // Caddy's, not this file's.
      '/api/better-auth': {
        target: process.env.PLATFORM_AUTH_PROXY || 'http://localhost:4200',
        changeOrigin: true,
      },
      '/api': {
        target: process.env.PLATFORM_API_PROXY || 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    proxy: {
      '/api/better-auth': {
        target: process.env.PLATFORM_AUTH_PROXY || 'http://localhost:4200',
        changeOrigin: true,
      },
      '/api': {
        target: process.env.PLATFORM_API_PROXY || 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
});
