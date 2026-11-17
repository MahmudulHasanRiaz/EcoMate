/**
 * Shared harness library for the Phase 8 E2E scenarios (E1–E9, E11).
 *
 * - Config from env (all URLs overridable; defaults target the local stack).
 * - Minimal SMTP catcher (fixed port, so the platform can point at it).
 * - Platform API client (login + MFA, tenant provisioning through the real
 *   signup → verify → provision path, status manipulation, domains).
 * - Playwright browser helpers (Chrome for Testing + host-resolver rules).
 * - Check/step reporting + per-scenario tenant cleanup (soft-delete).
 *
 * The harness assumes the stack is UP (docker compose or dev servers) and
 * does not start it, except for the SMTP catcher. Fault injection (E2/E9)
 * uses `docker compose` by default, or plain processes when
 * HARNESS_FAULT_MODE=process — see the service-lifecycle section below.
 */
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';

export const config = {
  landingUrl: process.env.LANDING_URL || 'http://localhost:3002',
  // The platform-api serves everything under the global /api prefix; the
  // base URL includes it (same normalisation as apps/landing/next.config.ts).
  platformApiUrl: normalisePlatformApiUrl(
    process.env.PLATFORM_API_URL || 'http://localhost:4100/api',
  ),
  backendUrl: process.env.BACKEND_URL || 'http://localhost:4000',
  storefrontUrl: process.env.STOREFRONT_URL || 'http://localhost:3000',
  adminUrl: process.env.ADMIN_URL || 'http://localhost:5173',
  primaryDomain: process.env.PRIMARY_DOMAIN || 'ecomate.bd',
  smtpPort: Number(process.env.SMTP_CATCHER_PORT || 1025),
  /** Host the platform-api container uses to reach the catcher. */
  smtpHostForPlatform:
    process.env.SMTP_CATCHER_HOST || 'host.docker.internal',
  chromePath:
    process.env.CHROME_PATH ||
    `${process.env.HOME}/.cache/ms-playwright/chrome-linux64/chrome`,
  composeFile:
    process.env.COMPOSE_FILE || 'docker-compose.yml',
  // Fault-injection mechanism for E2/E9: 'docker' (default) or 'process'.
  faultMode: process.env.HARNESS_FAULT_MODE || 'docker',
  backendService: process.env.BACKEND_SERVICE || 'backend',
  platformApiService: process.env.PLATFORM_API_SERVICE || 'platform-api',
  storefrontService: process.env.STOREFRONT_SERVICE || 'storefront',
  /** Platform operator login (SUPERADMIN) for setup/teardown calls. */
  platformEmail: process.env.PLATFORM_EMAIL || '',
  platformPassword: process.env.PLATFORM_PASSWORD || '',
  platformTotp: process.env.PLATFORM_TOTP || '',
  /** Shared secret for the TLS-ask endpoint (falls back to the internal secret). */
  tlsAskToken:
    process.env.TLS_ASK_TOKEN || process.env.INTERNAL_SERVICE_SECRET || '',
  internalSecret: process.env.INTERNAL_SERVICE_SECRET || '',
  headless: process.env.HEADLESS !== 'false',
  /** Unique run id so reruns never collide on slugs/emails. */
  runId: process.env.RUN_ID || randomRunId(),
};

function randomRunId() {
  return `p8${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

function normalisePlatformApiUrl(raw) {
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export class Reporter {
  constructor(scenario) {
    this.scenario = scenario;
    this.checks = [];
  }

  step(message) {
    console.log(`  → ${message}`);
  }

  check(name, ok, detail = '') {
    const mark = ok ? '✓' : '✗';
    console.log(`    ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
    this.checks.push({ name, ok, detail });
    if (!ok) throw new Error(`check failed: ${name}${detail ? ` (${detail})` : ''}`);
    return true;
  }

  /** Records a check that could not run (missing deployment config). */
  skip(name, reason) {
    console.log(`    ○ ${name} — SKIPPED: ${reason}`);
    this.checks.push({ name, ok: true, skipped: true, detail: reason });
    return true;
  }

  get passed() {
    return this.checks.filter((c) => c.ok).length;
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export async function req(base, method, path, { token, body, headers } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      // Fastify rejects an empty body when content-type is application/json,
      // so only send the header when there actually is a body.
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data, text, headers: response.headers };
}

export async function reqOk(base, method, path, opts = {}) {
  const res = await req(base, method, path, opts);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `${method} ${path} → HTTP ${res.status}: ${String(res.text).slice(0, 300)}`,
    );
  }
  return res.data;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeoutMs = 120_000, intervalMs = 2_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`,
      );
    }
    await sleep(intervalMs);
  }
}

// ---------------------------------------------------------------------------
// SMTP catcher
// ---------------------------------------------------------------------------

function decodeQuotedPrintable(input) {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

function decodePart(headers, rawBody) {
  const encoding = /content-transfer-encoding:\s*([^\s;]+)/i.exec(headers);
  const enc = encoding ? encoding[1].toLowerCase() : '7bit';
  if (enc === 'quoted-printable') return decodeQuotedPrintable(rawBody);
  if (enc === 'base64') {
    return Buffer.from(rawBody.replace(/\s/g, ''), 'base64').toString('utf8');
  }
  return rawBody;
}

/**
 * Decodes a message body, including multipart/alternative (nodemailer sends
 * text + html parts, each possibly quoted-printable with soft-wrapped long
 * lines — a raw regex over the MIME blob would miss a token split across
 * a soft line break). Returns the decoded parts joined with newlines.
 */
function decodeBody(headers, rawBody) {
  const boundary =
    /content-type:[^;\r\n]*multipart\/[^;\r\n]*;\s*boundary="?([^";\r\n]+)"?/i.exec(
      headers,
    )?.[1];
  if (!boundary) return decodePart(headers, rawBody);
  const parts = rawBody.split(`--${boundary}`);
  const decoded = [];
  for (const part of parts.slice(1)) {
    if (part.trimStart().startsWith('--')) break; // closing boundary
    const split = part.indexOf('\r\n\r\n');
    if (split < 0) {
      const lfSplit = part.indexOf('\n\n');
      if (lfSplit < 0) continue;
      decoded.push(decodePart(part.slice(0, lfSplit), part.slice(lfSplit + 2)));
    } else {
      decoded.push(decodePart(part.slice(0, split), part.slice(split + 4)));
    }
  }
  return decoded.join('\n');
}

/**
 * Minimal SMTP server: accepts any MAIL FROM / RCPT TO, captures the DATA
 * payload, decodes quoted-printable/base64, and stores messages by
 * recipient. No TLS, no auth — test-only, bound to all interfaces so a
 * containerised platform-api can reach it via host.docker.internal.
 */
export class SmtpCatcher {
  constructor(port = config.smtpPort) {
    this.port = port;
    this.messages = [];
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handle(socket));
      this.server.on('error', reject);
      this.server.listen(this.port, '0.0.0.0', () => resolve());
    });
  }

  stop() {
    return new Promise((resolve) => this.server?.close(() => resolve()));
  }

  handle(socket) {
    socket.write('220 ecomate-e2e-catcher\r\n');
    let buffer = '';
    let dataMode = false;
    let dataLines = [];
    let rcpt = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (dataMode) {
          if (line === '.') {
            dataMode = false;
            this.store(rcpt, dataLines.join('\r\n'));
            dataLines = [];
            socket.write('250 OK\r\n');
          } else {
            dataLines.push(line);
          }
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-localhost\r\n250 8BITMIME\r\n');
        } else if (upper.startsWith('MAIL FROM')) {
          socket.write('250 OK\r\n');
        } else if (upper.startsWith('RCPT TO')) {
          const m = /<([^>]*)>/.exec(line);
          rcpt = m ? m[1] : '';
          socket.write('250 OK\r\n');
        } else if (upper === 'DATA') {
          dataMode = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (upper === 'RSET') {
          dataMode = false;
          dataLines = [];
          socket.write('250 OK\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }
      }
    });
  }

  store(rcpt, raw) {
    const split = raw.indexOf('\r\n\r\n');
    const headers = split >= 0 ? raw.slice(0, split) : raw;
    const bodyRaw = split >= 0 ? raw.slice(split + 4) : '';
    const subject =
      (/^Subject:\s*(.*)$/im.exec(headers)?.[1] ?? '').trim();
    this.messages.push({
      to: rcpt,
      subject,
      headers,
      body: decodeBody(headers, bodyRaw),
      raw,
      at: new Date(),
    });
  }

  forRecipient(email) {
    const needle = email.toLowerCase();
    return this.messages.filter((m) => m.to.toLowerCase() === needle);
  }

  async waitFor(email, { subjectMatch, timeoutMs = 90_000 } = {}) {
    return waitFor(
      () => {
        const found = this.forRecipient(email).find(
          (m) => !subjectMatch || subjectMatch.test(m.subject),
        );
        return found ?? null;
      },
      { timeoutMs, intervalMs: 1_000, label: `email to ${email}` },
    );
  }
}

/** Extracts the verify token from a verification email body. */
export function extractVerifyToken(emailBody) {
  const m = /[?&]token=([0-9a-fA-F]{32,})/.exec(emailBody);
  if (!m) throw new Error('No verification token found in email body');
  return m[1];
}

// ---------------------------------------------------------------------------
// Platform API client
// ---------------------------------------------------------------------------

export async function platformLogin(email, password, totp) {
  const res = await req(config.platformApiUrl, 'POST', '/auth/login', {
    body: { email, password },
  });
  if (res.status !== 200) {
    throw new Error(`Platform login failed: HTTP ${res.status} ${res.text.slice(0, 200)}`);
  }
  if (res.data.accessToken) return res.data.accessToken;
  if (res.data.mfaRequired) {
    if (!totp) {
      throw new Error(
        'Platform account requires TOTP MFA; set PLATFORM_TOTP',
      );
    }
    const challenge = await req(config.platformApiUrl, 'POST', '/auth/mfa/challenge', {
      body: { mfaToken: res.data.mfaToken, code: totp },
    });
    if (challenge.status !== 200 || !challenge.data.accessToken) {
      throw new Error(`MFA challenge failed: HTTP ${challenge.status}`);
    }
    return challenge.data.accessToken;
  }
  throw new Error('Login did not return an access token');
}

/** Points the platform SMTP settings at the catcher (env-wins may override). */
export async function configureSmtpToCatcher(token) {
  const res = await req(config.platformApiUrl, 'PATCH', '/settings/smtp', {
    token,
    body: {
      host: config.smtpHostForPlatform,
      port: config.smtpPort,
      secure: false,
    },
  });
  return res;
}

/**
 * Provisions a tenant through the real path: public signup → verification
 * email from the catcher → verify → poll provisioning to SUCCEEDED.
 * Retries 429s (signup is 5/IP/10min) with a 60s backoff.
 */
export async function provisionTenant(ctx, slug, { password = 'correct-horse-battery', tenantName } = {}) {
  const email = `${slug}@e2e.example.test`;
  const name = tenantName ?? `${slug} E2E Store`;
  const signupBody = {
    tenantName: name,
    slug,
    ownerEmail: email,
    password,
    acceptTerms: true,
  };
  let created;
  for (let attempt = 1; attempt <= 13; attempt++) {
    const res = await req(config.platformApiUrl, 'POST', '/public/signup', {
      body: signupBody,
    });
    if (res.status === 201) {
      created = res.data;
      break;
    }
    if (res.status === 429 && attempt < 13) {
      ctx.reporter.step(
        `Signup rate-limited (attempt ${attempt}); waiting 60s…`,
      );
      await sleep(60_000);
      continue;
    }
    throw new Error(
      `Signup failed for ${slug}: HTTP ${res.status} ${res.text.slice(0, 300)}`,
    );
  }
  const message = await ctx.catcher.waitFor(email, {
    subjectMatch: /verif/i,
    timeoutMs: 120_000,
  });
  const token = extractVerifyToken(message.body);
  const verified = await reqOk(
    config.platformApiUrl,
    'GET',
    `/public/signup/verify?token=${encodeURIComponent(token)}`,
  );
  const status = await waitFor(
    async () => {
      const s = await reqOk(
        config.platformApiUrl,
        'GET',
        `/public/signup/status?token=${encodeURIComponent(token)}`,
      );
      if (s.provisioning?.status === 'SUCCEEDED') return s;
      if (s.provisioning?.status === 'FAILED') {
        throw new Error(
          `Provisioning failed for ${slug}: ${s.provisioning?.error ?? 'unknown'}`,
        );
      }
      return null;
    },
    { timeoutMs: 300_000, intervalMs: 5_000, label: `provisioning of ${slug}` },
  );
  // Neither verify nor status returns the tenant id; resolve it via the
  // operator list endpoint (exact slug match).
  const tenantId = await resolveTenantId(ctx, slug);
  // Tenant URLs: the status response carries the PRODUCTION urls
  // (https://<slug>.<primary-domain>/admin/), which only exist behind the
  // Caddy reverse proxy. When the harness runs against local dev servers
  // (base URL hostname is localhost/127.0.0.1), map the tenant host onto
  // the local base instead — e.g. http://<slug>.ecomate.bd:5173/admin/sign-in
  // for the admin vite server (base path /admin/), http://<slug>.ecomate.bd:3000/
  // for the storefront. The browser's host-resolver-rules map those hosts to
  // 127.0.0.1. (Admin dev server must allow the subdomain host: see
  // apps/admin/.env.development.local / VITE_DEV_ALLOWED_HOSTS.)
  const useLocalUrls = (base) => {
    const host = new URL(base).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  };
  const tenant = {
    id: tenantId,
    slug,
    name,
    email,
    password,
    token,
    adminUrl:
      useLocalUrls(config.adminUrl) || !status.urls?.admin
        ? tenantUrl(config.adminUrl, slug, '/admin/sign-in')
        : status.urls.admin,
    storefrontUrl:
      useLocalUrls(config.storefrontUrl) || !status.urls?.storefront
        ? tenantUrl(config.storefrontUrl, slug, '/')
        : status.urls.storefront,
  };
  ctx.tenants.push(tenant);
  return tenant;
}

/** Resolves a tenant id by exact slug via the operator list endpoint. */
export async function resolveTenantId(ctx, slug) {
  if (!ctx.operatorToken) {
    throw new Error(`Cannot resolve tenant id for ${slug}: no operator token`);
  }
  const list = await reqOk(
    config.platformApiUrl,
    'GET',
    `/tenants?search=${encodeURIComponent(slug)}&limit=10`,
    { token: ctx.operatorToken },
  );
  const items = Array.isArray(list?.data)
    ? list.data
    : Array.isArray(list?.items)
      ? list.items
      : Array.isArray(list)
        ? list
        : [];
  const id = items.find((t) => t.slug === slug)?.id ?? null;
  if (!id) throw new Error(`Could not resolve the tenant id for ${slug}`);
  return id;
}

/** Soft-deletes every tenant the run created (best-effort). */
export async function cleanupTenants(ctx) {
  if (!ctx.operatorToken) return;
  for (const tenant of ctx.tenants) {
    try {
      await req(config.platformApiUrl, 'DELETE', `/tenants/${tenant.id}`, {
        token: ctx.operatorToken,
      });
    } catch {
      // Best-effort: the tenant may already be gone.
    }
  }
}

export async function setTenantStatus(token, tenantId, status, reason) {
  return reqOk(config.platformApiUrl, 'PATCH', `/tenants/${tenantId}/status`, {
    token,
    body: { status, reason },
  });
}

// ---------------------------------------------------------------------------
// URLs & browser
// ---------------------------------------------------------------------------

/** Replaces the host of a base URL with a tenant host, keeping the port. */
export function tenantUrl(base, slugOrHost, path = '/') {
  const url = new URL(base);
  const host = slugOrHost.includes('.')
    ? slugOrHost
    : `${slugOrHost}.${config.primaryDomain}`;
  url.hostname = host;
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function hostResolverRules(hosts) {
  const unique = [...new Set(hosts)];
  return unique.map((h) => `MAP ${h} 127.0.0.1`).join(', ');
}

export async function launchBrowser(hosts) {
  // Plain HTTP on a non-localhost host is NOT a secure context, so
  // crypto.randomUUID() is undefined there — and the storefront's
  // PageViewTracker calls it on every page (checkout crashes with
  // "crypto.randomUUID is not a function", and the PDP buy box
  // intermittently never mounts). Production and staging are HTTPS, so
  // treat the harness origins as secure to match. ONE flag with a
  // comma-separated list: repeating the flag keeps only the last value.
  const ports = new Set(
    [config.storefrontUrl, config.adminUrl, config.landingUrl].map(
      (u) => new URL(u).port || '80',
    ),
  );
  const secureOrigins = [];
  for (const host of hosts) {
    for (const port of ports) {
      secureOrigins.push(`http://${host}:${port}`);
    }
  }
  const browser = await chromium.launch({
    executablePath: config.chromePath,
    headless: config.headless,
    args: [
      '--no-sandbox',
      '--no-proxy-server',
      `--host-resolver-rules=${hostResolverRules(hosts)}`,
      `--unsafely-treat-insecure-origin-as-secure=${secureOrigins.join(',')}`,
    ],
  });
  return browser;
}

/**
 * Collects console errors + failed requests + HTTP error responses on a
 * page for diagnostics. "Failed to load resource" console messages are
 * NOT recorded — they duplicate the response entries below, without a
 * URL. The response listener attributes every >= 400 with its URL, which
 * is what makes the benign filter below safe to apply.
 */
export function attachDiagnostics(page, label) {
  const errors = [];
  const httpErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().startsWith('Failed to load resource')) return;
    errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (request) =>
    errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`),
  );
  page.on('response', (response) => {
    if (response.status() >= 400) {
      // The method matters: while a tenant is SUSPENDED the subscription
      // guard blocks all WRITEs (POST 403s are expected), but reads must
      // keep working (a GET 403 is a real bug).
      httpErrors.push(
        `http ${response.status()} ${response.request().method()}: ${response.url()}`,
      );
    }
  });
  return { label, errors, httpErrors };
}

/**
 * Benign diagnostics — noise that must not fail a scenario. Each entry is
 * justified; anything else is a real failure.
 * - Google Fonts requests fail in this sandbox (the egress proxy breaks
 *   TLS to fonts.googleapis.com / fonts.gstatic.com); the pages fall back
 *   to system fonts and nothing functional depends on them.
 * - A 401 on the admin app's boot-time session probes (/auth/refresh,
 *   /auth/me, /entitlements/me) is expected before any login; the same
 *   calls succeed once logged in.
 * `extraBenign` holds scenario-specific expected failures (e.g. E5's
 * suspended-checkout 403) as regexps against the combined entry text.
 */
const BASE_BENIGN = [
  /requestfailed: https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//,
  /console: .*ERR_SSL_PROTOCOL_ERROR/,
  // 401s on the admin app's boot-time session probes (/auth/refresh,
  // /auth/me, /entitlements/me) are expected on every unauthenticated
  // page load; after login the same calls succeed. A real auth break
  // still fails the scenario's logged-in checks downstream.
  // Boot-time session probes 401 before login (refresh is a POST, me a
  // GET — the method varies, the expectation does not).
  /http 401 (GET|POST): .*\/api\/auth\/(refresh|me)$/,
  /http 401 (GET|POST): .*\/api\/entitlements\/me$/,
  // A 404 on /hr/my/profile is the designed "viewer is not an employee"
  // signal (nav-user.tsx: "404 when they are not an employee") — the
  // owner has no HR Employee record, and the query catches it to null.
  /http 404 GET: .*\/api\/hr\/my\/profile$/,
  // ERR_ABORTED is the browser cancelling an in-flight request because
  // the page navigated away or the app cancelled it (React Query on
  // unmount) — the client giving up, not a server failure. A genuine
  // failure still surfaces as an http error or a pageerror.
  /requestfailed: .* net::ERR_ABORTED$/,
];

export function diagFailures(diag, extraBenign = []) {
  const benign = [...BASE_BENIGN, ...extraBenign];
  const all = [...diag.errors, ...(diag.httpErrors ?? [])];
  return all.filter((entry) => !benign.some((re) => re.test(entry)));
}

// ---------------------------------------------------------------------------
// Tenant admin (shared by E3/E4)
// ---------------------------------------------------------------------------

export async function adminSignIn(page, tenant) {
  await page.goto(tenant.adminUrl, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(tenant.email);
  await page.getByLabel('Password').fill(tenant.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The overview page's sidebar has a "Dashboard" link (the route is
  // /op/overview but the label is "Dashboard"); "Products" is a sidebar
  // BUTTON (collapsible section), not a link — so neither /overview/ nor
  // /products/ matches a link here. Wait for the Dashboard link instead.
  await page
    .getByRole('link', { name: 'Dashboard' })
    .first()
    .waitFor({ timeout: 60_000 });
}

/**
 * Creates a product through the admin UI. `imagePath` is optional.
 * `draft: true` saves via "Save Draft" instead of "Create Product".
 */
export async function createProductViaAdmin(page, tenant, { name, slug, price, imagePath, draft = false, inStock = false }) {
  const adminBase = tenant.adminUrl.replace(/\/sign-in\/?$/, '');
  await page.goto(`${adminBase}/op/products`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByRole('button', { name: 'Add Product' }).click();
  await page.getByPlaceholder('Product name').fill(name);
  await page.getByPlaceholder('product-slug').fill(slug);
  await page.getByPlaceholder('0.00').first().fill(String(price));
  if (inStock) {
    // Managed Stock defaults to 0 units and starting stock cannot be set
    // on this form, so a fresh product shows "Out of Stock" with no
    // ADD TO CART button. Always In Stock makes it purchasable.
    // The "Availability Mode" <Label> has no htmlFor, so locate the
    // select by its ALWAYS_IN_STOCK option instead of getByLabel.
    await page
      .locator('select:has(option[value="ALWAYS_IN_STOCK"])')
      .selectOption('ALWAYS_IN_STOCK');
  }
  if (imagePath) {
    // Images live on the form's "Images" tab; the file input only exists
    // inside the MediaPicker dialog ("Browse Library"). A finished upload
    // is auto-selected (the picker adds it to localSelected), so wait for
    // the "Use (n)" button with n >= 1 rather than hunting the grid item
    // by filename — the grid img's alt is the storage key, not the name.
    await page.getByRole('tab', { name: 'Images' }).click();
    await page.getByRole('button', { name: 'Browse Library' }).first().click();
    const picker = page.getByRole('dialog', { name: 'Media Library' });
    await picker.getByText('Media Library').waitFor({ timeout: 30_000 });
    const fileInput = picker.locator('input[type="file"]').first();
    await fileInput.setInputFiles(imagePath);
    const useButton = picker.getByRole('button', {
      name: /Use \([1-9][0-9]*\)/,
    });
    await useButton.waitFor({ timeout: 60_000 });
    await useButton.click();
    await waitFor(
      async () =>
        (await page.locator('img[src*="uploads"]').count()) > 0 || null,
      { timeoutMs: 60_000, label: 'image to appear on the form' },
    );
  }
  if (draft) {
    await page.getByRole('button', { name: 'Save Draft' }).click();
    await sleep(2_000);
    return;
  }
  await page.getByRole('button', { name: 'Create Product' }).click();
  // A product with no images opens the "Review before creating" guard
  // ("No product images configured"). Its two buttons are "Continue
  // Editing" (dismisses, creates nothing) and "Create Anyway" — match
  // the confirm button EXACTLY, or the first match dismisses the guard
  // and the create silently never happens.
  try {
    const createAnyway = page.getByRole('button', {
      name: 'Create Anyway',
    });
    await createAnyway.waitFor({ state: 'visible', timeout: 5_000 });
    await createAnyway.click();
  } catch {
    // No review guard — the create went straight through.
  }
  await page.getByText(name).first().waitFor({ timeout: 60_000 });
}

// ---------------------------------------------------------------------------
// docker compose (fault injection)
// ---------------------------------------------------------------------------

export function dockerCompose(args, { env = {}, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['compose', '-f', config.composeFile, ...args],
      {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`docker compose ${args.join(' ')} timed out`));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(
          new Error(
            `docker compose ${args.join(' ')} failed (${code}): ${stderr.slice(0, 500)}`,
          ),
        );
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Service lifecycle (fault injection) — docker or plain processes
// ---------------------------------------------------------------------------
//
// HARNESS_FAULT_MODE selects the mechanism:
// - 'docker' (default): `docker compose stop/start/up` the named service.
// - 'process': the services run as plain processes (dev servers, or any
//   sandbox where docker cannot start containers). Each service needs:
//     HARNESS_<SERVICE>_PID_FILE — file the harness writes the PID to
//     HARNESS_<SERVICE>_START    — shell command that starts the service
//                                  (a launcher script; the harness spawns
//                                  it detached, so the PID is a process-
//                                  GROUP leader and stopping kills the
//                                  whole tree — the launcher need not
//                                  `exec` the server itself).
//   Extra `env` passed to start is merged in, so E9's SAAS_PRIMARY_UNHEALTHY
//   flip works in both modes — launchers must NOT hard-set flippable vars.
//
// Services: 'backend' | 'platform-api' | 'storefront'.

const SERVICES = {
  backend: {
    compose: () => config.backendService,
    pidFile: () => process.env.HARNESS_BACKEND_PID_FILE,
    startCmd: () => process.env.HARNESS_BACKEND_START,
    healthUrl: () => `${config.backendUrl}/api/health/live`,
  },
  'platform-api': {
    compose: () => config.platformApiService,
    pidFile: () => process.env.HARNESS_PLATFORM_API_PID_FILE,
    startCmd: () => process.env.HARNESS_PLATFORM_API_START,
    healthUrl: () => `${config.platformApiUrl}/health`,
  },
  storefront: {
    compose: () => config.storefrontService,
    pidFile: () => process.env.HARNESS_STOREFRONT_PID_FILE,
    startCmd: () => process.env.HARNESS_STOREFRONT_START,
    // No health endpoint: any HTTP response (even a 404 for the bare
    // localhost host) proves the server is up.
    healthUrl: () => config.storefrontUrl,
    anyStatusOk: true,
  },
};

async function serviceHealthy(name) {
  const svc = SERVICES[name];
  try {
    const res = await fetch(svc.healthUrl());
    return svc.anyStatusOk ? true : res.ok;
  } catch {
    return false;
  }
}

async function stopServiceProcess(name) {
  const svc = SERVICES[name];
  const pidFile = svc.pidFile();
  if (!pidFile) throw new Error(`HARNESS_${name.toUpperCase().replace('-', '_')}_PID_FILE is not set (process fault mode)`);
  const pid = Number((await readFile(pidFile, 'utf8')).trim());
  if (!Number.isFinite(pid)) throw new Error(`bad PID in ${pidFile}`);
  // Kill the whole process GROUP when the pid leads one: startServiceProcess
  // spawns detached, so the pid is a group leader and the group holds every
  // descendant (bash -> npx -> next-server). Killing only the leader would
  // orphan the server on its port and the next start would run against the
  // STALE server (old env — E9's SAAS_PRIMARY_UNHEALTHY flip would silently
  // not apply). A pid that leads no group (a manually started server) falls
  // back to a single-process kill.
  const killTree = (signal) => {
    try {
      process.kill(-pid, signal);
    } catch (err) {
      if (err.code !== 'ESRCH') throw err;
      process.kill(pid, signal);
    }
  };
  try {
    killTree('SIGTERM');
  } catch (err) {
    if (err.code !== 'ESRCH') throw err;
    return;
  }
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if (err.code === 'ESRCH') break;
      throw err;
    }
    if (Date.now() >= deadline) {
      killTree('SIGKILL');
      break;
    }
    await sleep(1_000);
  }
  // The leader being gone does not prove the port is free — an orphaned
  // grandchild could still be serving. Wait until the health URL stops
  // responding; if it never does, fail loudly instead of restarting
  // against a stale server.
  const portDeadline = Date.now() + 10_000;
  while (Date.now() < portDeadline) {
    if (!(await serviceHealthy(name))) return;
    await sleep(500);
  }
  if (await serviceHealthy(name)) {
    throw new Error(
      `${name} (pid ${pid}) is gone but ${svc.healthUrl()} still responds — ` +
        'an orphaned server holds the port; refusing to restart against it',
    );
  }
}

async function startServiceProcess(name, { env = {} } = {}) {
  const svc = SERVICES[name];
  const cmd = svc.startCmd();
  if (!cmd) throw new Error(`HARNESS_${name.toUpperCase().replace('-', '_')}_START is not set (process fault mode)`);
  const child = spawn('bash', ['-c', cmd], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env },
  });
  child.unref();
  // The child is a detached group leader (bash -> launcher -> server), so
  // this PID identifies the whole tree for stopServiceProcess's group kill
  // — it is NOT necessarily the server pid itself (e.g. `next start`
  // spawns next-server as a grandchild). The pid file holds the leader.
  const pidFile = svc.pidFile();
  if (pidFile) await writeFile(pidFile, String(child.pid), 'utf8');
  await waitFor(() => serviceHealthy(name), {
    timeoutMs: 180_000,
    intervalMs: 5_000,
    label: `${name} to become healthy`,
  });
}

export async function stopService(name) {
  if (config.faultMode === 'process') return stopServiceProcess(name);
  await dockerCompose(['stop', SERVICES[name].compose()]);
}

export async function startService(name, { env = {} } = {}) {
  if (config.faultMode === 'process') return startServiceProcess(name, { env });
  await dockerCompose(['start', SERVICES[name].compose()]);
}

export async function restartServices(names, { env = {} } = {}) {
  if (config.faultMode === 'process') {
    for (const name of names) await stopServiceProcess(name);
    for (const name of names) await startServiceProcess(name, { env });
    return;
  }
  await dockerCompose(
    ['up', '-d', '--force-recreate', ...names.map((n) => SERVICES[n].compose())],
    { env, timeoutMs: 300_000 },
  );
}
