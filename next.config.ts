import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },

  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  async rewrites() {
    return [
      {
        source: '/api/webhooks/woo/:id/restriction-check',
        destination: '/api/woo/restriction-check',
      },
      {
        source: '/api/webhooks/woo/:id/config',
        destination: '/api/woo/plugin-config',
      },
      {
        source: '/api/webhooks/woo/:id/status',
        destination: '/api/woo/status',
      },
      {
        source: '/api/webhooks/woo/:id/incomplete-orders',
        destination: '/api/woo/incomplete-orders',
      },
      {
        source: '/api/webhooks/woo/:id/incomplete-orders/complete',
        destination: '/api/woo/incomplete-orders/complete',
      },
      {
        source: '/woo/api/restriction-check',
        destination: '/api/woo/restriction-check',
      },
      {
        source: '/woo/api/incomplete-orders',
        destination: '/api/woo/incomplete-orders',
      },
      {
        source: '/woo/api/plugin-config',
        destination: '/api/woo/plugin-config',
      },
      {
        source: '/woo/api/status',
        destination: '/api/woo/status',
      },
    ];
  },
};

export default nextConfig;
