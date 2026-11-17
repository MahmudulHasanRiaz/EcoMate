export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

// Kept in sync with the platform's tenant-host resolver. The server is
// authoritative; this is instant client-side feedback only.
export const RESERVED_SLUGS = new Set([
  'www',
  'api',
  'saas',
  'admin',
  'app',
  'status',
  'docs',
  'mail',
  'webhooks',
  'cname',
  'support',
  'blog',
]);

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 30)
    .replace(/-+$/, '');
}

export type FieldErrors = Record<string, string>;

export function validateStoreStep(input: {
  tenantName: string;
  slug: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  const name = input.tenantName.trim();
  if (name.length < 2) errors.tenantName = 'Enter your store name.';
  if (name.length > 80) errors.tenantName = 'Keep the store name under 80 characters.';

  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) {
    errors.slug =
      'Use 3–30 lowercase letters, numbers or hyphens (no leading/trailing hyphen).';
  } else if (RESERVED_SLUGS.has(slug)) {
    errors.slug = 'This store address is reserved. Choose another.';
  }
  return errors;
}

export function validateAccountStep(input: {
  ownerEmail: string;
  password: string;
  confirmPassword: string;
  ownerPhone?: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  const email = input.ownerEmail.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.ownerEmail = 'Enter a valid email address.';
  }
  if (input.password.length < 12) {
    errors.password = 'Use at least 12 characters.';
  } else if (input.password.length > 72) {
    errors.password = 'Keep the password under 72 characters.';
  }
  if (input.confirmPassword !== input.password) {
    errors.confirmPassword = 'Passwords do not match.';
  }
  if (input.ownerPhone && input.ownerPhone.trim().length > 30) {
    errors.ownerPhone = 'Keep the phone number under 30 characters.';
  }
  return errors;
}

export function validateSignup(input: {
  tenantName: string;
  slug: string;
  ownerEmail: string;
  password: string;
  confirmPassword: string;
  ownerPhone?: string;
  acceptTerms: boolean;
}): FieldErrors {
  const errors = {
    ...validateStoreStep(input),
    ...validateAccountStep(input),
  };
  if (!input.acceptTerms) {
    errors.acceptTerms = 'Accept the terms to continue.';
  }
  return errors;
}
