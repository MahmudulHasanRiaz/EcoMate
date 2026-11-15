import { describe, expect, it } from 'vitest';
import {
  slugify,
  validateAccountStep,
  validateSignup,
  validateStoreStep,
} from '../signup-validation';

describe('landing signup validation', () => {
  it('slugifies a store name into a valid slug', () => {
    expect(slugify('Acme & Sons Store!')).toBe('acme-sons-store');
    expect(slugify('  --Hello--World--  ')).toBe('hello-world');
    expect(slugify('a'.repeat(40))).toBe('a'.repeat(30));
  });

  it('accepts a valid store step', () => {
    expect(
      validateStoreStep({ tenantName: 'Acme Store', slug: 'acme-store' }),
    ).toEqual({});
  });

  it('rejects short, malformed and reserved slugs', () => {
    expect(
      validateStoreStep({ tenantName: 'Acme', slug: 'ab' }).slug,
    ).toBeTruthy();
    expect(
      validateStoreStep({ tenantName: 'Acme', slug: '-acme' }).slug,
    ).toBeTruthy();
    expect(
      validateStoreStep({ tenantName: 'Acme', slug: 'admin' }).slug,
    ).toContain('reserved');
  });

  it('validates the owner account', () => {
    expect(
      validateAccountStep({
        ownerEmail: 'owner@example.com',
        password: 'long-enough',
        confirmPassword: 'long-enough',
      }),
    ).toEqual({});
    expect(
      validateAccountStep({
        ownerEmail: 'nope',
        password: 'short',
        confirmPassword: 'different',
      }),
    ).toMatchObject({
      ownerEmail: expect.any(String),
      password: expect.any(String),
      confirmPassword: expect.any(String),
    });
  });

  it('requires accepting the terms', () => {
    expect(
      validateSignup({
        tenantName: 'Acme Store',
        slug: 'acme-store',
        ownerEmail: 'owner@example.com',
        password: 'long-enough',
        confirmPassword: 'long-enough',
        acceptTerms: false,
      }).acceptTerms,
    ).toBeTruthy();
  });
});
