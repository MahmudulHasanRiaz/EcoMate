import { validateSlug } from './signup-slug';

describe('validateSlug', () => {
  it('accepts a normal slug and normalises case', () => {
    expect(validateSlug('acme-store')).toEqual({
      ok: true,
      slug: 'acme-store',
    });
    expect(validateSlug('  Acme  ')).toEqual({ ok: true, slug: 'acme' });
  });

  it.each(['ab', 'a'.repeat(31), '-acme', 'acme-', 'acme_store', 'acme store'])(
    'rejects malformed slug %s with reason invalid-format',
    (slug) => {
      expect(validateSlug(slug)).toEqual({
        ok: false,
        reason: 'invalid-format',
        message:
          'Slug must be 3–30 characters: lowercase letters, numbers or hyphens, starting and ending with a letter or number.',
      });
    },
  );

  it('rejects reserved platform slugs with reason reserved', () => {
    for (const slug of ['www', 'api', 'admin', 'saas', 'cname']) {
      expect(validateSlug(slug)).toEqual({
        ok: false,
        reason: 'reserved',
        message: 'This slug is reserved',
      });
    }
  });

  it('rejects a reserved slug regardless of case or whitespace', () => {
    expect(validateSlug('  WWW  ')).toEqual({
      ok: false,
      reason: 'reserved',
      message: 'This slug is reserved',
    });
  });
});
