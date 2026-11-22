/**
 * Gravatar avatar URLs (ported from StackMate `apps/admin/src/lib/gravatar.ts`).
 *
 * Gravatar identifies accounts by the MD5 of the trimmed, lower-cased
 * email. `d=404` makes Gravatar answer 404 when the email has no photo,
 * so the Avatar component can fall back to initials instead of
 * Gravatar's default mystery-man. The hash is one-way; the email itself
 * never leaves the app except as that hash to gravatar.com.
 */

/** MD5 (RFC 1321) — Web Crypto has no MD5, and Gravatar requires it. */
function md5(input: string): string {
  // Per-round shift amounts.
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14,
    20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
    16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  // K constants: floor(abs(sin(i + 1)) * 2^32).
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
    0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
    0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
    0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
    0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
    0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
    0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
    0xeb86d391,
  ];
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  const add = (a: number, b: number) => (a + b) | 0;

  // UTF-8 encode, then pad: 0x80, zeroes, 64-bit little-endian bit length.
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < input.length) {
      const c2 = input.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 < 0xe000) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i++;
        continue;
      }
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push((bitLen / 2 ** (i * 8)) & 0xff);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let off = 0; off < bytes.length; off += 64) {
    const M: number[] = [];
    for (let i = 0; i < 16; i++) {
      // Every index exists by construction (bytes is padded to a
      // multiple of 64); the ?? 0 only satisfies noUncheckedIndexedAccess.
      M.push(
        (bytes[off + i * 4] ?? 0) |
          ((bytes[off + i * 4 + 1] ?? 0) << 8) |
          ((bytes[off + i * 4 + 2] ?? 0) << 16) |
          ((bytes[off + i * 4 + 3] ?? 0) << 24),
      );
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      b = add(b, rotl(add(add(a, f), add(K[i] ?? 0, M[g] ?? 0)), S[i] ?? 0));
      a = tmp;
    }
    a0 = add(a0, a);
    b0 = add(b0, b);
    c0 = add(c0, c);
    d0 = add(d0, d);
  }

  const hex = (n: number) =>
    [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

/** Gravatar photo URL for an email, or null when there is no email. */
export function gravatarUrl(email: string | null | undefined, size = 72): string | null {
  const clean = (email ?? '').trim().toLowerCase();
  if (clean === '') return null;
  return `https://www.gravatar.com/avatar/${md5(clean)}?s=${size}&d=404`;
}
