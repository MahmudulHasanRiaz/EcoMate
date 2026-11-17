import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpAuthUrl,
  totpCode,
  verifyTotpCode,
} from './totp';

describe('totp', () => {
  it('base32 round-trips arbitrary bytes', () => {
    const bytes = Buffer.from([0, 1, 2, 127, 128, 255, 10, 20, 30, 40]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it('rejects invalid base32', () => {
    expect(() => base32Decode('NOT*BASE32!')).toThrow('Invalid base32');
  });

  it('generates a 32-char secret (160 bits)', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  // RFC 6238 Appendix B, SHA-1, 8 digits. Secret is the ASCII string
  // "12345678901234567890" (base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ).
  it.each([
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ])(
    'matches RFC 6238 vector at %i seconds',
    (seconds: number, expected: string) => {
      const secret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
      expect(totpCode(secret, { time: seconds * 1000, digits: 8 })).toBe(
        expected,
      );
    },
  );

  it('verifies the current code and tolerates one step of skew', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const current = totpCode(secret, { time: now });
    expect(verifyTotpCode(secret, current, { time: now })).toBe(true);
    // Code from the previous step still verifies (window 1).
    const previous = totpCode(secret, { time: now - 30_000 });
    expect(verifyTotpCode(secret, previous, { time: now })).toBe(true);
    // Two steps away does not.
    const old = totpCode(secret, { time: now - 61_000 });
    expect(verifyTotpCode(secret, old, { time: now })).toBe(false);
  });

  it('rejects wrong codes, wrong lengths and non-digits', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, '000000')).toBe(false);
    expect(verifyTotpCode(secret, '12345')).toBe(false);
    expect(verifyTotpCode(secret, '1234567')).toBe(false);
    expect(verifyTotpCode(secret, 'abcdef')).toBe(false);
    expect(verifyTotpCode(secret, '')).toBe(false);
  });

  it('accepts codes with spaces or dashes (user-friendly input)', () => {
    const secret = generateTotpSecret();
    const code = totpCode(secret);
    expect(verifyTotpCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(
      true,
    );
  });

  it('fails closed on a corrupt secret', () => {
    expect(verifyTotpCode('!!!', '123456')).toBe(false);
  });

  it('builds a valid otpauth URL', () => {
    const url = totpAuthUrl('EcoMate', 'admin@example.com', 'JBSWY3DPEHPK3PXP');
    expect(url).toBe(
      'otpauth://totp/EcoMate%3Aadmin%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=EcoMate',
    );
  });
});
