import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: process.env.PLATFORM_API_PROXY || 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    proxy: {
      '/api': {
        target: process.env.PLATFORM_API_PROXY || 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
});
