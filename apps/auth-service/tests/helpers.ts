// Shared helpers for the auth-service test suite.
//
// Tests boot the real server in-process (createAuth + createServer) on a
// fixed localhost port against the scratch `ecomate_auth` database on the
// VM Postgres cluster (port 55432). They never touch staging/production.
// Run with: npm test  (node --import tsx --test tests/)
//
// NOTE on origin checks: BA 1.7.28 defaults skipOriginCheck to true under
// NODE_ENV=test (dist/context/create-context.mjs:211). The service sets
// advanced.disableOriginCheck: false explicitly, so the origin gate stays
// ON even when these tests run under NODE_ENV=test — the trustedOrigins
// tests below prove it.
import { createHmac } from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createAuth } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server.js';
import { closePrisma } from '../src/prisma.js';
import type { AuthServiceConfig } from '../src/config.js';

export interface TestServer {
  port: number;
  baseUrl: string;
  auth: ReturnType<typeof createAuth>['auth'];
  prisma: ReturnType<typeof createAuth>['prisma'];
  config: AuthServiceConfig;
  /** Live tenant registry (null when no platform-api is configured). */
  registry: ReturnType<typeof createAuth>['registry'];
  close: () => Promise<void>;
}

export function testEnv(port: number): void {
  process.env['AUTH_DB_URL'] =
    process.env['AUTH_DB_URL'] ??
    'postgresql://postgres@127.0.0.1:55432/ecomate_auth';
  process.env['BETTER_AUTH_SECRET'] =
    process.env['BETTER_AUTH_SECRET'] ??
    'test-secret-for-phase1-tests-0123456789abcdef';
  process.env['AUTH_MAIL_MODE'] = 'test';
  process.env['AUTH_PORT'] = String(port);
  // Preset hosts win: append the port hosts instead of overwriting, so a
  // file that presets e.g. *.faah.net (consume host-check tests) keeps it.
  // Repeated startTestServer calls in one process only add duplicates.
  for (const key of ['AUTH_ALLOWED_HOSTS', 'AUTH_TRUSTED_HOSTS'] as const) {
    const prev = process.env[key];
    process.env[key] = prev
      ? `${prev},127.0.0.1:${port},localhost:${port}`
      : `127.0.0.1:${port},localhost:${port}`;
  }
  process.env['AUTH_BASE_PROTOCOL'] = 'http';
}

export async function startTestServer(port: number): Promise<TestServer> {
  testEnv(port);
  const config = loadConfig();
  const { auth, prisma, registry } = createAuth(config);
  const server = createServer({ auth, prisma, config, registry });
  await new Promise<void>((resolve, reject) => {
    // Reject on listen error (e.g. EADDRINUSE): without this the
    // promise never settles and the test hangs until its timeout.
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    auth,
    prisma,
    config,
    registry,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      await closePrisma();
    },
  };
}

let emailCounter = 0;
export function testEmail(prefix: string): string {
  emailCounter += 1;
  return `${prefix}-${Date.now()}-${emailCounter}@example.com`;
}

export const TEST_PASSWORD = 'TestPass123!';

export interface HttpResult {
  status: number;
  json: Record<string, any> | null;
  text: string;
  setCookie: string[];
  headers: Headers;
}

/** Minimal cookie jar: keeps name=value pairs from set-cookie headers. */
export class Jar {
  private cookies = new Map<string, string>();
  addFrom(setCookie: string[] | undefined): void {
    for (const sc of setCookie ?? []) {
      const [pair] = sc.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const value = pair.slice(eq + 1).trim();
        // An empty value is an expired/deleted cookie (e.g. BA deletes
        // the session cookie during a 2FA challenge) — drop the entry,
        // like a browser jar would.
        if (value === '') this.cookies.delete(pair.slice(0, eq).trim());
        else this.cookies.set(pair.slice(0, eq).trim(), value);
      }
    }
  }
  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  has(namePart: string): boolean {
    return [...this.cookies.keys()].some((k) => k.includes(namePart));
  }
  get size(): number {
    return this.cookies.size;
  }
}

export async function api(
  baseUrl: string,
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    origin?: string | null;
    jar?: Jar | null;
    headers?: Record<string, string>;
  } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(opts.origin === undefined
      ? { origin: baseUrl }
      : opts.origin
        ? { origin: opts.origin }
        : {}),
    ...(opts.jar?.size ? { cookie: opts.jar.header() } : {}),
    ...(opts.headers ?? {}),
  };
  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(text) as Record<string, any>;
  } catch {
    json = null;
  }
  return {
    status: res.status,
    json,
    text,
    setCookie: res.headers.getSetCookie?.() ?? [],
    headers: res.headers,
  };
}

/** Raw HTTP request (used for Host-header spoofing, which fetch cannot do). */
export function rawRequest(
  port: number,
  opts: { host: string; path: string; method?: string; headers?: Record<string, string> },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: opts.path,
        method: opts.method ?? 'GET',
        headers: { Host: opts.host, ...(opts.headers ?? {}) },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Sign up + sign in a fresh user; returns the email + a jar holding the session. */
export async function signUpAndIn(
  baseUrl: string,
  prefix: string,
  password: string = TEST_PASSWORD,
): Promise<{ email: string; jar: Jar; userId: string }> {
  const email = testEmail(prefix);
  const jar = new Jar();
  // /sign-up/email custom rule is 10/min in one shared per-path bucket (no
  // client IP is resolvable in tests); a burst of sign-ups can 429 — retry
  // a few times with backoff. Files that mint many users must stay under
  // the budget (reuse fixtures instead of signing up per case).
  let signUp: HttpResult | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    signUp = await api(baseUrl, '/api/better-auth/sign-up/email', {
      body: { email, password, name: prefix },
      jar,
    });
    if (signUp.status !== 429) break;
    await new Promise((r) => setTimeout(r, 3500));
  }
  if (!signUp || signUp.status !== 200) {
    throw new Error(`sign-up failed ${signUp?.status}: ${signUp?.text}`);
  }
  jar.addFrom(signUp.setCookie);
  const userId = String(signUp.json?.user?.id ?? '');
  return { email, jar, userId };
}

// --- TOTP (RFC 6238, SHA-1, 30 s, 6 digits) ------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secretBase32: string, when: Date = new Date()): string {
  const counter = Math.floor(when.getTime() / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function totpSecretFromUri(uri: string): string {
  const secret = new URL(uri).searchParams.get('secret');
  if (!secret) throw new Error(`no secret in totp URI: ${uri}`);
  return secret;
}

/** Run a node script in a SECOND process and return its exit code + stdout. */
export function runSecondProcess(
  scriptPath: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
