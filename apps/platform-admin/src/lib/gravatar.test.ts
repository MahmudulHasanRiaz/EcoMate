import { describe, expect, it } from 'vitest';
import { gravatarUrl } from './gravatar';

describe('gravatarUrl', () => {
  it('hashes the trimmed, lower-cased email (Gravatar docs example)', () => {
    // Gravatar's own documented example: MyEmailAddress@example.com.
    expect(gravatarUrl('  MyEmailAddress@example.com  ')).toBe(
      'https://www.gravatar.com/avatar/0bc83cb571cd1c50ba6f3e8a78ef1346?s=72&d=404',
    );
  });

  it('matches md5sum for known emails', () => {
    expect(gravatarUrl('test@example.com', 56)).toBe(
      'https://www.gravatar.com/avatar/55502f40dc8b7c769880b10874abc9d0?s=56&d=404',
    );
    expect(gravatarUrl('admin@example.com', 80)).toBe(
      'https://www.gravatar.com/avatar/e64c7d89f26bd1972efa854d13d7dd61?s=80&d=404',
    );
  });

  it('always requests d=404 so a missing photo 404s instead of mystery-man', () => {
    expect(gravatarUrl('someone@example.com')).toContain('d=404');
  });

  it('returns null for missing or blank emails', () => {
    expect(gravatarUrl(null)).toBeNull();
    expect(gravatarUrl(undefined)).toBeNull();
    expect(gravatarUrl('   ')).toBeNull();
  });

  it('defaults to size 72', () => {
    expect(gravatarUrl('test@example.com')).toContain('?s=72&');
  });
});
