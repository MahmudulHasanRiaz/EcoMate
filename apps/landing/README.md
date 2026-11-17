# EcoMate landing (SaaS front door)

Public SaaS front door: the v3 marketing landing (design ported ~99% from
EcoMate-Landing, content adapted to multi-tenant SaaS), the signup wizard,
and the lead form.

```bash
npm run landing:dev   # http://localhost:3002
```

It calls the platform API through a same-origin `/api/*` rewrite
(`PLATFORM_API_URL`, default `http://localhost:4100/api`), so no CORS surface is
exposed. Server-side fetches (live plans, managed content) never throw: a
downed API yields no pricing section and built-in fallback copy, never a
failed page.

## The v3 design

- Dark-first indigo design system (`app/globals.css`, plain CSS — no
  Tailwind): `mk-*` tokens/components + the motion system, ported verbatim
  from the EcoMate-Landing reference. Accent is the reference indigo
  (`#4f46e5` light / `#6366f1` dark), per Boss's decision — NOT the
  EcoMate brand blue.
- 15 sections in fixed order (`components/v3/LandingV3.tsx`): hero,
  10 capability sections, getting started, trust, pricing, FAQ, lead form.
- Fonts via `next/font`: Inter, Instrument Serif, Hind Siliguri (Bangla),
  JetBrains Mono. Theme persists in `localStorage['ecomate-theme']`
  (dark default; a before-paint script in `app/layout.tsx` avoids a
  light flash).
- Locale is client state (`en` / `bn`, no URL prefixes — platform email
  links hit `/verify-email`). Bangla copy follows the "Smart Mix" rule:
  easy English words Bangladeshis understand (project, order, trial,
  plan, store, ...) stay in English (Latin script) inside Bangla
  sentences; pure Bangla only where the English word is not commonly
  understood.
- Interactive demos hold local state only (`lib/demoLogic.ts`): packing
  scan, revenue protection, courier booking, store sync switches.

## Content model

- Built-in fallback: `data/landingContent.ts` (en + bn, 21 keys). This
  file is the seed for the managed content and the fallback when the
  platform API is down or a section is unmanaged — the landing never
  breaks on content.
- Managed content (Landing CMS): the platform console edits landing copy;
  the landing fetches it server-side from `GET /public/landing-content`
  (5-minute revalidate) and merges it over the fallback
  (`lib/landing-content.ts`): per-field merge for hero/contact/
  capabilities, full-list replace for FAQ/testimonials/partners.
  Manageable: hero + CTA copy, capability items, testimonials, partners,
  FAQ items, contact info — all bilingual. Design/structure/section order
  stays in code.
- Pricing is live: `GET /public/plans` (`lib/plans.ts`). No tier
  selector, no "custom implementation" variant. Empty list → the section
  hides itself.

## Signup flow

1. `/signup` — store name + address, owner account, review/terms.
2. The platform sends a verification link (`PLATFORM_LANDING_URL` +
   `/verify-email?token=...`).
3. `/verify-email` confirms the token and shows the verified state.

CAPTCHA is Cloudflare Turnstile when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (this app)
and `TURNSTILE_SECRET_KEY` (platform API) are set; local development runs
without it. Rate limits live in the platform API.

When no site key is configured in a production build, the wizard shows an
honest "Signup is temporarily unavailable" state instead of the form
(`lib/verification.ts`) — users must never fill 3 steps and then fail with
a "complete the challenge" error for a challenge that never appeared. The
platform distinguishes "verification not configured" (HTTP 503,
`code: 'captcha_not_configured'`) from a genuine challenge failure (400);
fail-closed behaviour is kept (no bypass). The lead form is different:
Turnstile there is verify-if-present, never required.

## Lead form

The home page's closing section posts to `POST /public/leads`
(`{ name, contact, message?, monthlyOrders?, turnstileToken? }`). Leads
are listed in the platform console. No Meta Pixel, no CAPI dedup.

## Intentionally NOT ported from EcoMate-Landing

Drizzle/NextAuth/CMS/blog/admin, locale-prefixed routes, Meta Pixel,
ConsentBanner, the reference Turnstile (ref/getToken style — the SaaS
callback-style widget is used instead), the tier selector, the "custom
implementation" pricing variant, and the Blog link.

## Tests

```bash
npm run test --workspace=landing   # vitest, lib-only (node env)
```

Covers plans/branding/validation, the demo logic, the v3 content shape
(both locales), the managed-content merge/fallback, and the verification
availability rule. Component behaviour is verified with headless
screenshots + interaction smoke against a local dev server (see the
redesign plan §11).
