import { describe, expect, it } from 'vitest';
import { auditPayloadText, auditQueryString } from './audit';

describe('auditQueryString', () => {
  it('skips empty filters and encodes values', () => {
    expect(
      auditQueryString({ action: 'users.create', entity: '', page: 2 }),
    ).toBe('?action=users.create&page=2');
    expect(auditQueryString({})).toBe('');
    expect(auditQueryString({ search: 'a b&c' })).toBe('?search=a+b%26c');
  });
});

describe('auditPayloadText', () => {
  it('renders JSON and placeholders', () => {
    expect(auditPayloadText(null)).toBe('—');
    expect(auditPayloadText({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
