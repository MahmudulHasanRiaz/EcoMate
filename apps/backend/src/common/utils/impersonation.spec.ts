import { ForbiddenException } from '@nestjs/common';
import { assertNotImpersonated, isImpersonatedUser } from './impersonation';

describe('impersonation helpers', () => {
  it('detects an impersonated user', () => {
    expect(isImpersonatedUser({ impersonated: true })).toBe(true);
    expect(isImpersonatedUser({ impersonated: false })).toBe(false);
    expect(isImpersonatedUser({})).toBe(false);
    expect(isImpersonatedUser(undefined)).toBe(false);
    expect(isImpersonatedUser(null)).toBe(false);
  });

  it('blocks sensitive actions during impersonation', () => {
    expect(() =>
      assertNotImpersonated({ impersonated: true }, 'Password changes'),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertNotImpersonated({ impersonated: true }, 'Password changes'),
    ).toThrow(/not allowed during an impersonated session/);
  });

  it('allows sensitive actions for ordinary sessions', () => {
    expect(() =>
      assertNotImpersonated({ impersonated: false }, 'Password changes'),
    ).not.toThrow();
    expect(() =>
      assertNotImpersonated({}, 'Password changes'),
    ).not.toThrow();
  });
});
