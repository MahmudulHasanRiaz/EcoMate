import { describe, expect, it } from 'vitest';
import { getAuthMode, isAuthMode, resetAuthModeForTests } from './auth-mode';

describe('isAuthMode', () => {
  it('accepts only the two known modes', () => {
    expect(isAuthMode('custom-jwt')).toBe(true);
    expect(isAuthMode('central-ba')).toBe(true);
    expect(isAuthMode('central')).toBe(false);
    expect(isAuthMode(null)).toBe(false);
    expect(isAuthMode(undefined)).toBe(false);
  });
});

describe('getAuthMode', () => {
  it('returns central-ba when the endpoint reports it', async () => {
    resetAuthModeForTests();
    const mode = await getAuthMode(async () =>
      Response.json({ mode: 'central-ba' }),
    );
    expect(mode).toBe('central-ba');
  });

  it('falls back to custom-jwt on a 404 (endpoint not landed yet)', async () => {
    resetAuthModeForTests();
    const mode = await getAuthMode(async () => new Response(null, { status: 404 }));
    expect(mode).toBe('custom-jwt');
  });

  it('falls back to custom-jwt on a network error or malformed body', async () => {
    resetAuthModeForTests();
    const unreachable = await getAuthMode(async () => {
      throw new Error('down');
    });
    expect(unreachable).toBe('custom-jwt');
    resetAuthModeForTests();
    const malformed = await getAuthMode(async () =>
      Response.json({ mode: 'something-else' }),
    );
    expect(malformed).toBe('custom-jwt');
  });

  it('caches the fetch: a second call does not hit the network', async () => {
    resetAuthModeForTests();
    let calls = 0;
    const counting = async () => {
      calls += 1;
      return Response.json({ mode: 'central-ba' });
    };
    await getAuthMode(counting);
    await getAuthMode(counting);
    expect(calls).toBe(1);
    resetAuthModeForTests();
  });
});
