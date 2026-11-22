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

/**
 * Content-Security-Policy for the landing site (enforcing, Phase 8).
 *
 * - `script-src 'unsafe-inline'` is required: Next.js App Router ships its
 *   RSC flight payload as inline scripts, and this app has no nonce
 *   plumbing (a nonce-based policy is a follow-up, not a launch blocker —
 *   the landing renders no user-controlled HTML anywhere).
 * - Turnstile (signup bot check) needs its script, frame, and connect
 *   origins on challenges.cloudflare.com.
 * - Video embeds (client-review slider click-to-play, blog and
 *   case-study detail pages) frame YouTube's privacy-enhanced
 *   player and Vimeo's player — both are allowlisted in `frame-src`
 *   only; nothing else about the policy is loosened for them.
 * - `img-src https:` allows a remotely hosted brand logo (NEXT_PUBLIC_LOGO_URL);
 *   the logo URL itself is allowlisted in lib/branding.ts.
 * - `media-src 'self' https:` lets <video> load from the API origin (the
 *   console picker stores absolute media-library URLs) and from direct
 *   .mp4/.webm links — same breadth as `img-src`. Without it, cross-origin
 *   video falls back to `default-src 'self'` and is blocked.
 * - No other third party is loaded: system fonts only, no analytics.
 */
export const LANDING_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "media-src 'self' https:",
  "font-src 'self'",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export const LANDING_SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: LANDING_CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: LANDING_SECURITY_HEADERS,
      },
    ];
  },
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
