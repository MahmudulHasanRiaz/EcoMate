#!/usr/bin/env node
/**
 * Phase 4 host-isolation E2E (two tenants + a mocked custom domain).
 *
 * Boots a mock backend (tenant registry + per-tenant storefront config), builds
 * and starts the real storefront in production mode, then drives Chromium with
 * a host resolver rule so acme.ecomate.localhost / beta.ecomate.localhost / alias / custom /
 * unknown hosts all reach the same local server while preserving Host.
 *
 * Checks:
 *  - two base-domain tenants render their own branding (no cross-tenant text)
 *  - the proxy injects x-tenant-host and the tenant id (tenant-scoped cache key)
 *    into SSR requests
 *  - a custom domain resolves through the mocked registry and is served
 *  - an alias host 301s to the canonical host (path preserved)
 *  - an unknown host is 404, never a tenant shell
 *  - platform hosts (www) are 404 at the storefront
 *
 * Usage: node scripts/saas/phase4-host-e2e.mjs [--skip-build]
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const storefrontDir = path.join(root, 'apps', 'storefront');
const requireFromStorefront = createRequire(
  path.join(storefrontDir, 'package.json'),
);
const skipBuild = process.argv.includes('--skip-build');

const TENANTS = {
  'acme.ecomate.localhost': {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Acme Store',
    kind: 'tenant',
    isAlias: false,
  },
  'beta.ecomate.localhost': {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Beta Store',
    kind: 'tenant',
    isAlias: false,
  },
  'acme.alias.localhost': {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Acme Store',
    kind: 'tenant',
    isAlias: true,
    canonicalHost: 'acme.ecomate.localhost',
  },
  'shop.localhost': {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Acme Custom',
    kind: 'custom',
    isAlias: false,
  },
};

const BASE_CONFIG = {
  store: { name: '', tagline: '', email: '', phone: '', address: '' },
  systems: [],
  currency: { code: 'BDT', symbol: '৳' },
  delivery: { charge: 0, freeDeliveryMin: 0 },
  deliveryInfo: { enabled: true, title: '', rows: [] },
  hero: { slides: [], secondaryBanner: '', secondaryBannerAlt: '' },
  social: {
    facebook: '',
    instagram: '',
    youtube: '',
    whatsapp: '',
    messengerUsername: '',
  },
  order: {
    whatsapp: '',
    callNumber: '',
    blockedPhoneMessage: 'This phone number has been blocked.',
  },
  branding: {
    storefrontFavicon: '',
    storefrontOgImage: '',
    storeLogo: '',
    adminTitle: '',
    adminFavicon: '',
    adminTagline: '',
    colors: {
      primary: '#0089CD',
      primaryDark: '#006da3',
      accent: '#E77250',
      text: '#0a0a0a',
      background: '#FFFFFF',
      success: '#22C55E',
      danger: '#EF4444',
      border: '#E5E7EB',
      shadowSoft: '0 8px 25px rgba(0,137,205,0.15)',
      shadowStrong: '0 15px 45px -5px rgba(0,137,205,0.6)',
    },
  },
  seo: { title: '', description: '', keywords: '' },
  footer: { description: '', copyright: '' },
  about: { text: '' },
  shipping: { info: '' },
  payment: { info: '' },
  meta: {
    pixelEnabled: false,
    pixelId: '',
    pixelIds: [],
    purchaseMode: 'instant',
    validatedStatus: '',
  },
  tiktok: {
    pixelEnabled: false,
    pixelCode: '',
    purchaseMode: 'instant',
    validatedStatus: '',
  },
  menu: {
    header: {
      mode: 'include',
      showAllCategories: false,
      excludedCategories: [],
      items: [],
    },
    mobile: {
      mode: 'include',
      showAllCategories: false,
      excludedCategories: [],
      items: [],
    },
    footer: { columns: [] },
  },
  faq: { items: [] },
  hours: { label: '', details: [] },
  company: {
    name: '',
    registration: '',
    certifications: '',
    teamSize: '',
    ceoName: '',
  },
  checkout: {
    districtEnabled: true,
    thanaEnabled: true,
    districtRequired: false,
    thanaRequired: false,
    emailEnabled: true,
    emailRequired: false,
  },
  districtCharges: {},
  shippingMode: 'options',
  shippingOptions: [],
  shippingZones: [],
  features: {
    sizeChart: false,
    hideOosFromArchive: false,
    maintenanceMode: false,
    defaultVariantSelected: true,
    showReviews: true,
  },
  thankYou: { title: '', subtitle: '', description: '' },
  playStoreUrl: '',
  appStoreUrl: '',
  planFeatures: ['*'],
  homepageSections: [],
  searchIndexingEnabled: true,
};

const normaliseHost = (host) =>
  String(host || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function startMockBackend(port) {
  const configRequests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock.local');
    const host = normaliseHost(
      req.headers['x-tenant-host'] || req.headers.host,
    );
    const tenant = TENANTS[host];

    if (url.pathname === '/api/tenants/resolve') {
      const requested = normaliseHost(url.searchParams.get('host'));
      const match = TENANTS[requested];
      if (!match) return json(res, 404, { message: 'Unknown host' });
      return json(res, 200, {
        kind: match.kind,
        tenantId: match.id,
        slug: requested.split('.')[0],
        canonicalHost: match.canonicalHost || requested,
        isAlias: match.isAlias,
      });
    }

    if (url.pathname === '/api/system-settings/storefront') {
      configRequests.push({
        host,
        tenantId: req.headers['x-tenant-id'] || null,
        tenantParam: url.searchParams.get('__tenant'),
      });
      if (!tenant) {
        return json(res, 403, { message: 'Tenant context is required' });
      }
      return json(res, 200, {
        ...BASE_CONFIG,
        store: { ...BASE_CONFIG.store, name: tenant.name },
        footer: {
          description: `${tenant.name} footer`,
          copyright: `© ${tenant.name}`,
        },
        canonicalDomain: `https://${host}`,
      });
    }

    if (url.pathname === '/api/entitlements/public') {
      return json(res, 200, {
        planName: 'E2E Plan',
        features: ['*'],
        accessState: 'full',
      });
    }

    if (url.pathname === '/api/cms-pages/footer') return json(res, 200, []);
    if (url.pathname === '/api/categories') return json(res, 200, []);

    // Any other backend call (tracking config, products, …): harmless empty.
    return json(res, 200, []);
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () =>
      resolve({ server, configRequests }),
    );
  });
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
    child.on('error', reject);
  });
}

async function waitFor(url, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const mockPort = Number(process.env.E2E_MOCK_PORT || 49732);
  const storefrontPort = await freePort();
  const mockBase = `http://127.0.0.1:${mockPort}`;

  const { server: mock, configRequests } = await startMockBackend(mockPort);
  console.log(`Mock backend: ${mockBase}`);

  let storefront;
  let browser;

  try {
    if (!skipBuild) {
      console.log('Building storefront…');
      await run(
        requireFromStorefront.resolve('next/dist/bin/next'),
        ['build'],
        {
          cwd: storefrontDir,
          // Bake the mock API origin into next.config rewrites so browser
          // /api/* calls (used by the config provider after hydration) hit the
          // mock too, not the compiled-in backend:4000 default.
          env: {
            ...process.env,
            // Absolute API origin for next.config rewrites (SSR + browser).
            API_URL: `${mockBase}/api`,
            // `.localhost` hostnames make lib/api-client treat the browser as
            // dev; force relative /api so client calls use the same rewrite.
            NEXT_PUBLIC_API_URL: '/api',
          },
        },
      );
    }

    // output: 'standalone' — "next start" is not supported. Run the traced
    // server and place static/public assets where it expects them (the same
    // layout as the Dockerfile).
    const standaloneRoot = path.join(storefrontDir, '.next', 'standalone');
    const standaloneApp = path.join(
      standaloneRoot,
      'apps',
      'storefront',
    );
    const copyIfExists = (from, to) => {
      if (fs.existsSync(from)) {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.cpSync(from, to, { recursive: true, force: true });
      }
    };
    copyIfExists(
      path.join(storefrontDir, '.next', 'static'),
      path.join(standaloneApp, '.next', 'static'),
    );
    copyIfExists(
      path.join(storefrontDir, 'public'),
      path.join(standaloneApp, 'public'),
    );

    const serverJs = fs.existsSync(path.join(standaloneApp, 'server.js'))
      ? path.join(standaloneApp, 'server.js')
      : path.join(standaloneRoot, 'server.js');
    if (!fs.existsSync(serverJs)) {
      throw new Error(`standalone server.js not found under ${standaloneRoot}`);
    }

    storefront = spawn(process.execPath, [serverJs], {
      cwd: path.dirname(serverJs),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(storefrontPort),
        HOSTNAME: '127.0.0.1',
        API_URL: `${mockBase}/api`,
        INTERNAL_SHARED_SECRET: 'e2e-internal-secret',
        REVALIDATION_SECRET: 'e2e-revalidation-secret',
        SAAS_PRIMARY_DOMAIN: 'ecomate.localhost',
        SAAS_BASE_DOMAINS: 'ecomate.localhost,alias.localhost',
        SAAS_FALLBACK_DOMAIN: 'alias.localhost',
        SAAS_PRIMARY_UNHEALTHY: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    storefront.stdout.on('data', (d) =>
      process.stdout.write(`[storefront] ${d}`),
    );
    storefront.stderr.on('data', (d) =>
      process.stderr.write(`[storefront] ${d}`),
    );

    await waitFor(`http://127.0.0.1:${storefrontPort}/api/health`);
    console.log(`Storefront: http://127.0.0.1:${storefrontPort}`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--host-resolver-rules=MAP * 127.0.0.1'],
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.on('pageerror', (err) =>
      console.error('[browser pageerror]', err.message),
    );
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('[browser console]', msg.text());
      }
    });

    const visit = async (host, pathname = '/about') => {
      const response = await page.goto(
        `http://${host}:${storefrontPort}${pathname}`,
        { waitUntil: 'domcontentloaded', timeout: 45_000 },
      );
      await page.waitForTimeout(300);
      const body = await page.locator('body').innerText();
      return { response, status: response?.status(), body };
    };

    const acme = await visit('acme.ecomate.localhost');
    if (!acme.body.includes('Acme Store')) {
      console.error('ACME BODY:', acme.body.slice(0, 1500));
    }
    check('acme host: 200', acme.status === 200, `status ${acme.status}`);
    check('acme host: renders Acme Store', acme.body.includes('Acme Store'));
    check('acme host: no Beta content', !acme.body.includes('Beta Store'));

    const beta = await visit('beta.ecomate.localhost');
    check('beta host: 200', beta.status === 200, `status ${beta.status}`);
    check('beta host: renders Beta Store', beta.body.includes('Beta Store'));
    check('beta host: no Acme content', !beta.body.includes('Acme Store'));

    const custom = await visit('shop.localhost');
    check(
      'custom host: 200',
      custom.status === 200,
      `status ${custom.status}`,
    );
    check(
      'custom host: renders custom branding',
      custom.body.includes('Acme Custom'),
    );

    const unknown = await visit('unknown.localhost');
    check(
      'unknown host: 404',
      unknown.status === 404,
      `status ${unknown.status}`,
    );
    check(
      'unknown host: no tenant shell',
      !unknown.body.includes('Acme Store'),
    );

    const platform = await visit('www.ecomate.localhost');
    check(
      'platform host: 404 at storefront',
      platform.status === 404,
      `status ${platform.status}`,
    );

    const aliasUrl = `http://acme.alias.localhost:${storefrontPort}/about`;
    const aliasResponse = await page.goto(aliasUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    check(
      'alias: 301 followed',
      aliasResponse?.status() === 200,
      `status ${aliasResponse?.status()}`,
    );
    check(
      'alias: lands on canonical host',
      page.url().startsWith(`http://acme.ecomate.localhost:${storefrontPort}/about`),
      page.url(),
    );
    check(
      'alias: canonical page renders Acme Store',
      (await page.locator('body').innerText()).includes('Acme Store'),
    );

    // SSR evidence: the proxy forwarded the tenant host (config endpoint) and
    // the tenant id made it into Next's cache key (__tenant=...).
    const acmeRequest = configRequests.find(
      (r) => r.host === 'acme.ecomate.localhost',
    );
    const betaRequest = configRequests.find(
      (r) => r.host === 'beta.ecomate.localhost',
    );
    const customRequest = configRequests.find(
      (r) => r.host === 'shop.localhost',
    );
    check(
      'SSR: acme config request carried its tenant host',
      Boolean(acmeRequest),
    );
    check(
      'SSR: acme cache key scoped to tenant id',
      acmeRequest?.tenantParam === TENANTS['acme.ecomate.localhost'].id,
      acmeRequest?.tenantParam || '(missing)',
    );
    check(
      'SSR: beta cache key scoped to its own tenant id',
      betaRequest?.tenantParam === TENANTS['beta.ecomate.localhost'].id,
      betaRequest?.tenantParam || '(missing)',
    );
    check(
      'SSR: custom domain carried its tenant host',
      Boolean(customRequest),
    );

    console.log(`\n${passed}/${passed + failed} checks passed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    storefront?.kill('SIGTERM');
    mock.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
