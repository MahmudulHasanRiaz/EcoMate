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
    'rejects malformed slug %s',
    (slug) => {
      expect(validateSlug(slug).ok).toBe(false);
    },
  );

  it('rejects reserved platform slugs', () => {
    for (const slug of ['www', 'api', 'admin', 'saas', 'cname']) {
      expect(validateSlug(slug)).toEqual({
        ok: false,
        message: 'This slug is reserved',
      });
    }
  });
});
