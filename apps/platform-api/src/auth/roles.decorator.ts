import { SetMetadata } from '@nestjs/common';

export const PLATFORM_ROLES_KEY = 'platform_roles';

export const Roles = (...roles: string[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);

/**
 * Roles allowed to READ operator data (tenants, billing, plans, domains,
 * usage, metrics, settings, audit). READONLY is deliberately absent: the
 * published role matrix says READONLY gets "login and own profile only".
 * Every read endpoint uses this constant — never re-declare the list.
 */
export const READ_ROLES = ['SUPERADMIN', 'BILLING', 'SUPPORT'] as const;
