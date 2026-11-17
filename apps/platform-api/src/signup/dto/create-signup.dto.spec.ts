import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateSignupDto } from './create-signup.dto';

function validDto(overrides: Record<string, unknown> = {}): CreateSignupDto {
  return plainToInstance(CreateSignupDto, {
    tenantName: 'Acme Store',
    slug: 'acme-store',
    ownerEmail: 'owner@acme.test',
    password: 'correct-horse-battery',
    acceptTerms: true,
    ...overrides,
  });
}

describe('CreateSignupDto', () => {
  it('accepts a 12-character password', async () => {
    const errors = await validate(validDto({ password: 'twelve-chars' }));
    expect(errors).toEqual([]);
  });

  it('rejects an 11-character password', async () => {
    const errors = await validate(validDto({ password: 'eleven-char' }));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('password');
    expect(errors[0].constraints).toHaveProperty('isLength');
  });

  it('rejects a short password even when everything else is valid', async () => {
    const errors = await validate(validDto({ password: 'short' }));
    expect(errors.map((e) => e.property)).toEqual(['password']);
  });

  it('still requires the other fields', async () => {
    const errors = await validate(
      plainToInstance(CreateSignupDto, {
        tenantName: 'Acme Store',
        slug: 'acme-store',
        ownerEmail: 'owner@acme.test',
        password: 'correct-horse-battery',
        acceptTerms: false,
      }),
    );
    expect(errors.map((e) => e.property)).toEqual(['acceptTerms']);
  });
});
