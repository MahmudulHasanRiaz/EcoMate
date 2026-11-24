import { URL } from 'node:url';
import * as http from 'node:http';
import * as https from 'node:https';
import { Socket, isIP } from 'node:net';
import type { LookupAddress, LookupOptions } from 'node:dns';
import * as ipaddr from 'ipaddr.js';
import { validateImageUrl, resolveAndPin, isBlockedIP, DnsResolver } from './ip-classifier';

/**
 * Injectable HTTP transport that captures request options for verification.
 * Production uses node:http/https with explicit protocol selection.
 * Tests inject a mock.
 */
export interface HttpTransport {
  request(
    options: http.RequestOptions,
    protocol: 'http:' | 'https:',
  ): Promise<{
    response: http.IncomingMessage;
    connectedAddress?: string;
  }>;
}

export const defaultHttpTransport: HttpTransport = {
  request: (options: http.RequestOptions, protocol: 'http:' | 'https:') =>
    new Promise((resolve, reject) => {
      const mod = protocol === 'https:' ? https : http;
      const req = mod.request(options, (res) => {
        const sockAddr = (res.socket as Socket)?.remoteAddress;
        resolve({ response: res, connectedAddress: sockAddr });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('Connection timeout'));
        reject(new Error('Connection timeout'));
      });
      req.end();
    }),
};

export interface SecureFetchResult {
  buffer: Buffer;
  mimeType: string;
}

/** Raw pinned fetch: no content validation, for callers (media ingest) that
 * accept non-image content (video) and validate it themselves. */
export interface SecureFetchRawResult {
  buffer: Buffer;
  contentType: string;
  statusCode: number;
  /** URL actually fetched, after following redirects. */
  finalUrl: string;
}

export interface SecureFetchOptions {
  totalTimeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
  limitInputPixels?: number;
}

export interface SecureFetchRawOptions extends SecureFetchOptions {
  /** Defaults to the image-service UA; media ingest passes a browser UA. */
  userAgent?: string;
  /** Defaults to the image accept list; media ingest adds video/*. */
  accept?: string;
}

const DEFAULT_USER_AGENT = 'EcoMateImageService/1.0';
const DEFAULT_ACCEPT = 'image/webp,image/avif,image/*,*/*';

// Image magic bytes for format identification
const IMAGE_MAGIC: Array<{ offset: number; bytes: number[]; mime: string }> = [
  { offset: 0, bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' },
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' },
  { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50], mime: 'image/webp' },
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], mime: 'image/avif' },
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31], mime: 'image/avif' },
];

export function detectImageMime(buffer: Buffer): string | null {
  for (const { offset, bytes, mime } of IMAGE_MAGIC) {
    if (buffer.length < offset + bytes.length) continue;
    if (bytes.every((b, i) => buffer[offset + i] === b)) return mime;
  }
  return null;
}

/**
 * Validate image bytes: magic bytes AND sharp metadata must agree
 * on a supported format (JPEG, PNG, GIF, WebP, AVIF). SVG blocked.
 * Throws on mismatch or invalid content.
 */
export async function validateImageBuffer(
  raw: Buffer,
  limitInputPixels?: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const detectedMime = detectImageMime(raw);
  if (!detectedMime) {
    throw new Error('Response is not a valid image format');
  }

  // Validate with sharp metadata
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sharp = require('sharp');
  const meta = await sharp(raw, { limitInputPixels: limitInputPixels ?? 16_777_216 }).metadata();
  if (!meta.format || meta.format === 'svg') {
    throw new Error('Unsupported image format');
  }

  // Magic MIME and sharp format must agree
  const expectedPrefix = 'image/';
  if (!detectedMime.startsWith(expectedPrefix)) {
    throw new Error('Image validation failed: magic bytes mismatch');
  }
  const magicFormat = detectedMime.slice(expectedPrefix.length);
  if (magicFormat !== meta.format) {
    throw new Error(`Image validation failed: magic bytes indicate ${magicFormat} but sharp reports ${meta.format}`);
  }

  return { buffer: raw, mimeType: detectedMime };
}

/**
 * Pinned-lookup builder for the DNS-pinned connect: the returned function
 * answers every lookup with ONLY the validated pinned address (TOCTOU
 * proof — no second resolution ever happens).
 *
 * Node 20+ defaults `autoSelectFamily: true`, so `net.connect` calls a
 * custom lookup with `{ all: true }` and expects the ARRAY form —
 * `cb(null, [{ address, family }])`. The old single-address form
 * (`cb(null, ip, family)`) made Node treat the IP string as an array of
 * characters, find no valid address, and fail EVERY fetch with
 * `ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined` (live staging
 * 2026-11-23 — DNS was fine; the connect step was broken). Honor both
 * forms: array when `all` is set, single otherwise.
 *
 * Exported for the regression tests (the lookup contract is only
 * observable through real `net.connect`, which the mocked transports in
 * the fetchRaw tests never touch).
 */
// The returned function matches Node's LookupFunction shape exactly
// (net.d.ts declares it module-local, so it can't be imported — the
// signature below mirrors it: hostname, LookupOptions, callback taking
// string | LookupAddress[]). A looser callback type (addr: unknown) fails
// `nest build` with TS2322 at the RequestOptions.lookup assignment.
export function buildPinnedLookup(
  pinnedAddr: string,
): (
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => void {
  const ipVer = isIP(pinnedAddr); // returns 4 or 6, or 0 for invalid
  if (ipVer !== 4 && ipVer !== 6) {
    throw new Error(`Pinned address is not a valid IP: ${String(pinnedAddr)}`);
  }
  return (
    _hostname: string,
    options: LookupOptions,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    if (options && options.all === true) {
      callback(null, [{ address: pinnedAddr, family: ipVer }], ipVer);
      return;
    }
    callback(null, pinnedAddr, ipVer);
  };
}

/**
 * Connect to the resolved pinned address while preserving Host header.
 * Sends the original hostname for TLS SNI and Host, but uses the
 * custom lookup that returns only the validated pinned IP.
 *
 * Exported for the regression tests: the lookup contract + transport
 * wiring is only observable through a real `net.connect` (the mocked
 * transports in the fetchRaw tests never touch it).
 */
export function buildRequestOptions(
  hostname: string,
  pinnedAddr: string,
  parsed: URL,
  deadline: AbortController,
  userAgent: string,
  accept: string,
  method: 'GET' | 'HEAD' = 'GET',
): [http.RequestOptions, 'http:' | 'https:'] {
  const isHttps = parsed.protocol === 'https:';
  const port = parsed.port ? parseInt(parsed.port, 10) : isHttps ? 443 : 80;

  const lookupFn = buildPinnedLookup(pinnedAddr);

  const options: http.RequestOptions & { servername?: string; rejectUnauthorized?: boolean } = {
    hostname,
    port,
    path: parsed.pathname + parsed.search,
    method,
    lookup: lookupFn,
    rejectUnauthorized: isHttps,
    servername: isHttps ? hostname : undefined,
    signal: deadline.signal,
    timeout: 10_000,
    headers: {
      Accept: accept,
      'User-Agent': userAgent,
    },
    agent: false,
  };

  return [options, isHttps ? 'https:' : 'http:'];
}

/**
 * Race a promise against an AbortSignal. If the signal fires before
 * resolution, the promise is rejected with the signal's reason.
 */
function raceSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (!signal.aborted) {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason ?? new Error('Operation aborted')), { once: true });
      }),
    ]);
  }
  return Promise.reject(signal.reason ?? new Error('Operation aborted'));
}

/** Normalize IPv4-mapped IPv6 (::ffff:x.x.x.x) to bare IPv4 for classification. */
function normalizeV4Mapped(addr: string): string {
  const lower = addr.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    return lower.slice(7);
  }
  return addr;
}

/**
 * Secure remote image fetcher with injectable DNS resolution and HTTP transport.
 * Production: use defaultDns + defaultHttpTransport.
 * Tests: inject mocks.
 */
export class SecureFetcher {
  constructor(
    private readonly dns: DnsResolver,
    private readonly httpTransport: HttpTransport,
  ) {}

  async fetch(
    url: string,
    opts: SecureFetchOptions = {},
  ): Promise<SecureFetchResult> {
    const raw = await this.fetchRaw(url, opts);
    // Validate image: magic bytes + sharp metadata
    return validateImageBuffer(raw.buffer, opts.limitInputPixels);
  }

  /**
   * DNS-pinned fetch without image validation. Same TOCTOU-proof core as
   * fetch(): every hop resolves + pins its IP, the socket's connected
   * address must match the pinned address, redirects re-pin per hop and
   * never downgrade https → http. Callers validate the bytes themselves.
   */
  async fetchRaw(
    url: string,
    opts: SecureFetchRawOptions = {},
  ): Promise<SecureFetchRawResult> {
    const totalTimeoutMs = opts.totalTimeoutMs ?? 15_000;
    const maxRedirects = opts.maxRedirects ?? 5;
    const maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;

    const deadline = new AbortController();
    const deadlineTimer = setTimeout(
      () => deadline.abort(new Error('Fetch deadline exceeded')),
      totalTimeoutMs,
    );

    try {
      return await this.fetchRawWithRedirects(
        url,
        0,
        maxRedirects,
        maxBytes,
        opts.userAgent ?? DEFAULT_USER_AGENT,
        opts.accept ?? DEFAULT_ACCEPT,
        deadline,
      );
    } finally {
      clearTimeout(deadlineTimer);
      try { deadline.abort(); } catch { /* ignore */ }
    }
  }

  /**
   * DNS-pinned HEAD request — same TOCTOU-proof core as fetchRaw()
   * (resolve + pin per hop, connected-address match, redirects re-pin
   * and never downgrade https → http), but no body is read: the
   * response is destroyed as soon as the 2xx status lands. Used by the
   * outbound product push (PushMediaService) to prove an image URL is
   * reachable before sending it to Woo/Shopify as a src.
   *
   * Throws on any failure (DNS/transport error, timeout, non-2xx) —
   * callers treat every throw as "unreachable".
   */
  async head(
    url: string,
    opts: SecureFetchRawOptions = {},
  ): Promise<{ statusCode: number; contentType: string; finalUrl: string }> {
    const totalTimeoutMs = opts.totalTimeoutMs ?? 15_000;
    const maxRedirects = opts.maxRedirects ?? 5;

    const deadline = new AbortController();
    const deadlineTimer = setTimeout(
      () => deadline.abort(new Error('Fetch deadline exceeded')),
      totalTimeoutMs,
    );

    try {
      const raw = await this.fetchRawWithRedirects(
        url,
        0,
        maxRedirects,
        0, // maxBytes is meaningless for HEAD — no body is ever read.
        opts.userAgent ?? DEFAULT_USER_AGENT,
        opts.accept ?? DEFAULT_ACCEPT,
        deadline,
        'HEAD',
      );
      return {
        statusCode: raw.statusCode,
        contentType: raw.contentType,
        finalUrl: raw.finalUrl,
      };
    } finally {
      clearTimeout(deadlineTimer);
      try { deadline.abort(); } catch { /* ignore */ }
    }
  }

  private async fetchRawWithRedirects(
    url: string,
    depth: number,
    maxRedirects: number,
    maxBytes: number,
    userAgent: string,
    accept: string,
    deadline: AbortController,
    method: 'GET' | 'HEAD' = 'GET',
  ): Promise<SecureFetchRawResult> {
    if (depth > maxRedirects) throw new Error('Too many redirects');
    if (deadline.signal.aborted) throw new Error('Fetch deadline exceeded');

    const parsed = validateImageUrl(url);
    const hostname = parsed.hostname;

    // Resolve and pin — race against deadline signal
    const pinnedAddr = await raceSignal(
      resolveAndPin(hostname, this.dns, deadline.signal),
      deadline.signal,
    );

    if (deadline.signal.aborted) throw new Error('Fetch deadline exceeded');

    // Build request options with pinned connection
    const [options, protocol] = buildRequestOptions(
      hostname,
      pinnedAddr,
      parsed,
      deadline,
      userAgent,
      accept,
      method,
    );

    const { response, connectedAddress } = await raceSignal(
      this.httpTransport.request(options, protocol),
      deadline.signal,
    );

    // Post-connect socket.remoteAddress — must match pinned DNS address (semantic equality)
    if (!connectedAddress) {
      response.destroy();
      throw new Error('Could not verify connected address (no socket info)');
    }
    // Canonicalize both addresses with ipaddr.process().
    // process() converts IPv4-mapped IPv6 to native IPv4 and normalizes
    // compressed/expanded IPv6 to a consistent representation.
    let canonicalConnected: string;
    let canonicalPinned: string;
    try {
      canonicalConnected = ipaddr.process(connectedAddress).toString();
      canonicalPinned = ipaddr.process(pinnedAddr).toString();
    } catch {
      response.destroy();
      throw new Error('Connected address validation failed');
    }
    // Blocked and mismatch checks are OUTSIDE the catch so their exact errors survive.
    if (isBlockedIP(canonicalConnected)) {
      response.destroy();
      throw new Error('Connected to a blocked IP address');
    }
    if (canonicalConnected !== canonicalPinned) {
      response.destroy();
      throw new Error('Connected address does not match pinned DNS address');
    }

    const statusCode = response.statusCode ?? 0;

    // Redirect — destroy body immediately
    if (statusCode >= 300 && statusCode < 400) {
      const location = response.headers['location'] as string | undefined;
      response.destroy();
      if (!location) throw new Error('Redirect with no Location header');

      const redirectUrl = new URL(location, url);
      if (parsed.protocol === 'https:' && redirectUrl.protocol !== 'https:') {
        throw new Error('Protocol downgrade on redirect rejected');
      }

      return this.fetchRawWithRedirects(
        redirectUrl.toString(),
        depth + 1,
        maxRedirects,
        maxBytes,
        userAgent,
        accept,
        deadline,
        method,
      );
    }

    // Non-2xx — destroy body immediately
    if (statusCode < 200 || statusCode >= 300) {
      response.destroy();
      throw new Error(`Remote server responded ${statusCode}`);
    }

    // HEAD: the 2xx status IS the answer — no body exists to read.
    // Destroy the response and return before the Content-Length/body
    // handling (a HEAD Content-Length describes the GET body, so the
    // maxBytes cap must never apply here).
    if (method === 'HEAD') {
      response.destroy();
      const contentType =
        typeof response.headers['content-type'] === 'string'
          ? response.headers['content-type']
          : 'application/octet-stream';
      return { buffer: Buffer.alloc(0), contentType, statusCode, finalUrl: url };
    }

    // Check Content-Length before streaming if present
    const contentLengthStr = response.headers['content-length'];
    if (contentLengthStr) {
      const cl = parseInt(contentLengthStr, 10);
      if (!isNaN(cl) && cl > maxBytes) {
        response.destroy();
        throw new Error('Response Content-Length exceeds maximum size');
      }
    }

    // Stream body with byte cap
    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of response) {
      if (deadline.signal.aborted) {
        response.destroy();
        throw new Error('Fetch deadline exceeded');
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        response.destroy();
        throw new Error('Response exceeds maximum size');
      }
      chunks.push(buf);
    }

    const raw = Buffer.concat(chunks);
    const contentType =
      typeof response.headers['content-type'] === 'string'
        ? response.headers['content-type']
        : 'application/octet-stream';
    return { buffer: raw, contentType, statusCode, finalUrl: url };
  }
}
