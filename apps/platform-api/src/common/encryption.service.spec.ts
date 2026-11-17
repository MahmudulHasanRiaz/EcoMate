import { EncryptionService } from './encryption.service';

const TEST_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTHER_KEY =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

describe('EncryptionService', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.APP_ENCRYPTION_KEY = TEST_KEY;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('round-trips plaintext and marks ciphertext with the prefix', () => {
    const service = new EncryptionService();
    const ciphertext = service.encrypt('smtp-password-123');
    expect(EncryptionService.isEncrypted(ciphertext)).toBe(true);
    expect(ciphertext).not.toContain('smtp-password-123');
    expect(service.decrypt(ciphertext)).toBe('smtp-password-123');
  });

  it('produces different ciphertext for the same plaintext (fresh IV)', () => {
    const service = new EncryptionService();
    expect(service.encrypt('same')).not.toBe(service.encrypt('same'));
  });

  it('detects tampering instead of returning garbage', () => {
    const service = new EncryptionService();
    const ciphertext = service.encrypt('secret');
    const tampered = ciphertext.slice(0, -2) + '00';
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('rejects ciphertext under a different key', () => {
    const service = new EncryptionService();
    const ciphertext = service.encrypt('secret');
    process.env.APP_ENCRYPTION_KEY = OTHER_KEY;
    expect(() => service.decrypt(ciphertext)).toThrow();
  });

  it('fails closed when no key is configured', () => {
    delete process.env.APP_ENCRYPTION_KEY;
    delete process.env.LICENSE_ENCRYPTION_KEY;
    const service = new EncryptionService();
    expect(service.isConfigured()).toBe(false);
    expect(() => service.encrypt('x')).toThrow('APP_ENCRYPTION_KEY is not set');
    expect(() => service.decrypt('enc:v1:00:00:00')).toThrow(
      'APP_ENCRYPTION_KEY is not set',
    );
  });

  it('rejects a non-hex or short key', () => {
    process.env.APP_ENCRYPTION_KEY = 'not-hex!';
    expect(() => new EncryptionService().encrypt('x')).toThrow('hexadecimal');
    process.env.APP_ENCRYPTION_KEY = 'abcd';
    expect(() => new EncryptionService().encrypt('x')).toThrow('64 hex');
  });

  it('accepts the LICENSE_ENCRYPTION_KEY alias', () => {
    delete process.env.APP_ENCRYPTION_KEY;
    process.env.LICENSE_ENCRYPTION_KEY = TEST_KEY;
    const service = new EncryptionService();
    expect(service.isConfigured()).toBe(true);
    expect(service.decrypt(service.encrypt('alias-ok'))).toBe('alias-ok');
  });

  it('isEncrypted only matches the prefix', () => {
    expect(EncryptionService.isEncrypted('plain-password')).toBe(false);
    expect(EncryptionService.isEncrypted(undefined)).toBe(false);
    expect(EncryptionService.isEncrypted(null)).toBe(false);
    expect(EncryptionService.isEncrypted('enc:v1:aa:bb:cc')).toBe(true);
  });
});
