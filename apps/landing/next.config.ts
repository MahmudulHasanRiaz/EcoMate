import type { NextConfig } from 'next';

// The landing app is the public SaaS front door. Browser calls go to the same
// origin (/api/*) and are rewritten to the platform control plane, so no CORS
// surface is exposed.
const configured = (
  process.env.PLATFORM_API_URL || 'http://localhost:4100/api'
).replace(/\/+$/, '');
const platformApi = configured.endsWith('/api')
  ? configured
  : `${configured}/api`;

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${platformApi}/:path*`,
      },
    ];
  },
};

export default nextConfig;
