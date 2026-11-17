import { classifyContact } from './lead-contact';

describe('classifyContact', () => {
  it.each([
    ['owner@example.com', 'email'],
    ['Owner@Example.com', 'email'],
    ['first.last+tag@sub.example.co.uk', 'email'],
  ])('classifies %p as email', (value, expected) => {
    expect(classifyContact(value)).toBe(expected);
  });

  it.each([
    ['+8801700000000', 'phone'],
    ['01700000000', 'phone'],
    ['8801700000000', 'phone'],
    ['+1 415 555 2671', 'phone'],
    ['+880 1894-828290', 'phone'],
    ['(017) 000-0000', 'phone'],
    ['+44 20 7946 0958', 'phone'],
  ])('classifies %p as phone', (value, expected) => {
    expect(classifyContact(value)).toBe(expected);
  });

  it.each([
    ['', null],
    [null, null],
    ['not-an-email-or-phone', null],
    ['plain-text', null],
    ['123', null],
    ['+880', null],
    ['01700 00000 ext 5', null],
    ['a'.repeat(250) + '@example.com', null],
  ])('rejects %p', (value, expected) => {
    expect(classifyContact(value as any)).toBe(expected);
  });
});
