/**
 * Encryption key provisioner — worker-split race safety (workstream E).
 *
 * The api + worker processes boot at the same time and share the app-data
 * volume. On a first boot with no stored key, both could generate different
 * keys; the exclusive-create write ('wx') + adopt-the-winner path must
 * guarantee exactly one key wins and both processes use it.
 *
 * No DB, no Redis — tmp dirs only. Restores process.env after each test.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EncryptionKeyProvisioner } from './encryption-key-provisioner';

function makeProvisioner(dir: string): EncryptionKeyProvisioner {
  const encryption = { isConfigured: () => false } as any;
  const prev = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = dir;
  try {
    return new EncryptionKeyProvisioner(encryption);
  } finally {
    if (prev === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = prev;
  }
}

describe('EncryptionKeyProvisioner (worker-split race)', () => {
  const tmpDirs: string[] = [];
  let prevKey: string | undefined;
  let prevDir: string | undefined;

  function tmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecomate-key-'));
    tmpDirs.push(dir);
    return dir;
  }

  beforeEach(() => {
    prevKey = process.env.APP_ENCRYPTION_KEY;
    prevDir = process.env.APP_DATA_DIR;
    delete process.env.APP_ENCRYPTION_KEY;
    delete process.env.APP_DATA_DIR;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (prevKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = prevKey;
    if (prevDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = prevDir;
  });

  afterAll(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('generates a 64-hex key and persists it 0600 on first boot', () => {
    const dir = tmpDir();
    const provisioner = makeProvisioner(dir);
    provisioner.onModuleInit();
    const key = process.env.APP_ENCRYPTION_KEY;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const file = path.join(dir, 'encryption.key');
    expect(fs.readFileSync(file, 'utf8')).toBe(key);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('reuses the stored key on later boots', () => {
    const dir = tmpDir();
    const stored = 'a'.repeat(64);
    fs.writeFileSync(path.join(dir, 'encryption.key'), stored);
    makeProvisioner(dir).onModuleInit();
    expect(process.env.APP_ENCRYPTION_KEY).toBe(stored);
  });

  it('two provisioners sharing a dir end up with the SAME key', () => {
    const dir = tmpDir();
    const first = makeProvisioner(dir);
    const second = makeProvisioner(dir);
    first.onModuleInit();
    const firstKey = process.env.APP_ENCRYPTION_KEY;
    delete process.env.APP_ENCRYPTION_KEY;
    second.onModuleInit();
    expect(process.env.APP_ENCRYPTION_KEY).toBe(firstKey);
    expect(fs.readFileSync(path.join(dir, 'encryption.key'), 'utf8')).toBe(
      firstKey,
    );
  });

  it('a second write never clobbers the first key (exclusive create)', () => {
    const dir = tmpDir();
    const provisioner = makeProvisioner(dir) as any;
    const first = 'b'.repeat(64);
    const second = 'c'.repeat(64);
    provisioner.writeStoredKey(first);
    expect(() => provisioner.writeStoredKey(second)).toThrow(/EEXIST/);
    expect(fs.readFileSync(path.join(dir, 'encryption.key'), 'utf8')).toBe(
      first,
    );
  });

  it('uses the env key when configured and touches no file', () => {
    const dir = tmpDir();
    process.env.APP_ENCRYPTION_KEY = 'd'.repeat(64);
    const encryption = { isConfigured: () => true } as any;
    process.env.APP_DATA_DIR = dir;
    const provisioner = new EncryptionKeyProvisioner(encryption);
    provisioner.onModuleInit();
    expect(process.env.APP_ENCRYPTION_KEY).toBe('d'.repeat(64));
    expect(fs.existsSync(path.join(dir, 'encryption.key'))).toBe(false);
  });
});
