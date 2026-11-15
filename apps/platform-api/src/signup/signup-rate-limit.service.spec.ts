import { HttpException } from '@nestjs/common';
import { SignupRateLimitService } from './signup-rate-limit.service';

describe('SignupRateLimitService', () => {
  it('allows up to the limit inside the window, then blocks', () => {
    const service = new SignupRateLimitService();
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(service.consume('ip', 5, 60_000, now + i)).toBe(true);
    }
    expect(service.consume('ip', 5, 60_000, now + 6)).toBe(false);
  });

  it('frees the window when it expires', () => {
    const service = new SignupRateLimitService();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) service.consume('email', 3, 1_000, now);
    expect(service.consume('email', 3, 1_000, now + 500)).toBe(false);
    expect(service.consume('email', 3, 1_000, now + 2_000)).toBe(true);
  });

  it('keeps independent keys independent', () => {
    const service = new SignupRateLimitService();
    for (let i = 0; i < 3; i++) service.consume('a', 3, 60_000, 1);
    expect(service.consume('a', 3, 60_000, 2)).toBe(false);
    expect(service.consume('b', 3, 60_000, 2)).toBe(true);
  });

  it('assert throws a 429 once the budget is exhausted', () => {
    const service = new SignupRateLimitService();
    service.assert('ip', 1, 60_000);
    expect(() => service.assert('ip', 1, 60_000)).toThrow(HttpException);
  });

  it('reset clears all budgets (test helper)', () => {
    const service = new SignupRateLimitService();
    service.assert('ip', 1, 60_000);
    service.reset();
    expect(() => service.assert('ip', 1, 60_000)).not.toThrow();
  });
});
