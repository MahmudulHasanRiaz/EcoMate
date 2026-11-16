import { normalizePhone, phoneVariants } from './signup-phone';

describe('phoneVariants', () => {
  it('normalizes +880, 880 and local 0 forms to the same set', () => {
    const plus = phoneVariants('+8801700000000');
    const local = phoneVariants('01700000000');
    const digits = phoneVariants('8801700000000');

    for (const value of ['+8801700000000', '01700000000', '8801700000000']) {
      expect(plus).toContain(value);
      expect(local).toContain(value);
      expect(digits).toContain(value);
    }
  });

  it('handles spacing and punctuation', () => {
    expect(phoneVariants('+880 1700-000000')).toContain('01700000000');
  });

  it('returns an empty list for no phone', () => {
    expect(phoneVariants(null)).toEqual([]);
    expect(phoneVariants('   ')).toEqual([]);
  });

  it('keeps short or non-BD numbers queryable as written', () => {
    expect(phoneVariants('12345')).toEqual(['12345']);
    expect(phoneVariants('+1 415 555 0100')).toContain('+14155550100');
  });

  it('stores a canonical form for new signups', () => {
    expect(normalizePhone('+880 1700-000000')).toBe('+8801700000000');
    expect(normalizePhone('01700000000')).toBe('+8801700000000');
    expect(normalizePhone('+1 415 555 0100')).toBe('+14155550100');
    expect(normalizePhone(null)).toBeNull();
  });
});
