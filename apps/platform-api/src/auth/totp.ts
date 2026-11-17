import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * TOTP (RFC 6238) over HMAC-SHA1, implemented on Node's crypto — no new
 * dependency. Secrets are RFC 4648 base32 (what authenticator apps expect).
 *
 * Verified against the RFC 6238 Appendix B test vectors in totp.spec.ts.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32Decode(encoded: string): Buffer {
  const clean = encoded.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160-bit secret (RFC 4226 recommendation), base32-encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export interface TotpOptions {
  /** Unix time in ms (defaults to now). */
  time?: number;
  /** Step size in seconds (default 30). */
  step?: number;
  /** Code length (default 6; RFC 6238 vectors use 8). */
  digits?: number;
}

export function totpCode(secretBase32: string, options: TotpOptions = {}): string {
  const step = options.step ?? 30;
  const digits = options.digits ?? 6;
  const time = options.time ?? Date.now();
  const counter = Math.floor(time / 1000 / step);

  const key = base32Decode(secretBase32);
  const buffer = Buffer.alloc(8);
  // Counter is 64-bit big-endian; the high 32 bits are zero for any
  // realistic time value.
  buffer.writeUInt32BE(0, 0);
  buffer.writeUInt32BE(counter, 4);

  const hmac = createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export interface TotpVerifyOptions extends TotpOptions {
  /** Steps of clock skew tolerated on either side (default 1). */
  window?: number;
}

/**
 * Verify a user-supplied code against the secret, tolerating ±`window`
 * steps of clock skew. Comparison is timing-safe; malformed codes fail
 * closed (false, never throw).
 */
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  options: TotpVerifyOptions = {},
): boolean {
  const digits = options.digits ?? 6;
  const clean = String(code ?? '').replace(/[\s-]/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(clean)) return false;
  const window = options.window ?? 1;
  const step = options.step ?? 30;
  const time = options.time ?? Date.now();
  try {
    for (let drift = -window; drift <= window; drift += 1) {
      const expected = totpCode(secretBase32, {
        time: time + drift * step * 1000,
        step,
        digits,
      });
      if (
        expected.length === clean.length &&
        timingSafeEqual(Buffer.from(expected), Buffer.from(clean))
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/** otpauth:// URL for authenticator apps (manual entry or QR). */
export function totpAuthUrl(
  issuer: string,
  account: string,
  secretBase32: string,
): string {
  const label = `${issuer}:${account}`;
  return (
    `otpauth://totp/${encodeURIComponent(label)}` +
    `?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}`
  );
}
