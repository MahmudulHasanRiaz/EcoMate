import { describe, expect, it } from 'vitest';
import { parseOrganizationLimitInput } from './organization-limit';

describe('parseOrganizationLimitInput', () => {
  it('accepts integers 1–100', () => {
    expect(parseOrganizationLimitInput('1')).toEqual({ ok: true, limit: 1 });
    expect(parseOrganizationLimitInput('5')).toEqual({ ok: true, limit: 5 });
    expect(parseOrganizationLimitInput('100')).toEqual({
      ok: true,
      limit: 100,
    });
    expect(parseOrganizationLimitInput('  7 ')).toEqual({
      ok: true,
      limit: 7,
    });
  });

  it('rejects non-integers and out-of-range values', () => {
    expect(parseOrganizationLimitInput('')).toEqual({
      ok: false,
      error: 'Enter a whole number of organizations per user.',
    });
    expect(parseOrganizationLimitInput('2.5').ok).toBe(false);
    expect(parseOrganizationLimitInput('abc').ok).toBe(false);
    expect(parseOrganizationLimitInput('0')).toEqual({
      ok: false,
      error: 'Enter a number between 1 and 100.',
    });
    expect(parseOrganizationLimitInput('101')).toEqual({
      ok: false,
      error: 'Enter a number between 1 and 100.',
    });
  });
});
