/**
 * The platform role matrix, as enforced by the `@Roles()` annotations on the
 * platform-api controllers. This is data, not a second source of truth: the
 * guards enforce it, this file only describes it for the console and the
 * docs. Keep it in sync with the controllers when roles change.
 */
export type RoleAccess = 'none' | 'read' | 'write' | 'full';

export interface RoleCapability {
  area: string;
  access: RoleAccess;
  note?: string;
}

export interface RoleMatrixEntry {
  role: string;
  description: string;
  capabilities: RoleCapability[];
}

export const ROLE_MATRIX: RoleMatrixEntry[] = [
  {
    role: 'SUPERADMIN',
    description: 'Full platform control: every read, write and admin action.',
    capabilities: [
      { area: 'Tenants', access: 'full' },
      { area: 'Billing', access: 'full' },
      { area: 'Plans', access: 'full' },
      { area: 'Domains', access: 'full' },
      { area: 'Usage', access: 'full' },
      { area: 'Metrics', access: 'full' },
      { area: 'Settings', access: 'full' },
      { area: 'Users', access: 'full' },
      { area: 'Audit', access: 'full', note: 'Includes CSV/JSON export.' },
      { area: 'Leads', access: 'full' },
      { area: 'Landing', access: 'full' },
      { area: 'Media', access: 'full' },
    ],
  },
  {
    role: 'BILLING',
    description: 'Money operations: billing, plans and usage writes.',
    capabilities: [
      {
        area: 'Tenants',
        access: 'write',
        note: 'No delete, purge, impersonate, restore or owner-password reset.',
      },
      { area: 'Billing', access: 'write' },
      { area: 'Plans', access: 'write' },
      {
        area: 'Domains',
        access: 'write',
        note: 'Tenant domains only; no platform domain config.',
      },
      { area: 'Usage', access: 'write' },
      { area: 'Metrics', access: 'read' },
      { area: 'Settings', access: 'read' },
      { area: 'Users', access: 'none' },
      { area: 'Audit', access: 'read', note: 'Includes CSV/JSON export.' },
      { area: 'Leads', access: 'write' },
      { area: 'Landing', access: 'write' },
      { area: 'Media', access: 'write' },
    ],
  },
  {
    role: 'SUPPORT',
    description: 'Customer operations: tenant help actions and reads.',
    capabilities: [
      {
        area: 'Tenants',
        access: 'write',
        note: 'Includes restore, impersonate and owner-password reset. No delete, purge, plan change or domain delete.',
      },
      { area: 'Billing', access: 'write', note: 'Approve/reject payment proofs only; no invoice, method, coupon or credit-note writes.' },
      { area: 'Plans', access: 'read' },
      {
        area: 'Domains',
        access: 'write',
        note: 'Tenant domains add and verify only; no config, no delete.',
      },
      { area: 'Usage', access: 'read' },
      { area: 'Metrics', access: 'read' },
      { area: 'Settings', access: 'read' },
      { area: 'Users', access: 'none' },
      { area: 'Audit', access: 'read', note: 'Search only; no export.' },
      { area: 'Leads', access: 'write', note: 'Status triage only.' },
      { area: 'Landing', access: 'read' },
      { area: 'Media', access: 'read' },
    ],
  },
  {
    role: 'READONLY',
    description: 'Login and own profile only; every other endpoint is 403.',
    capabilities: [
      { area: 'Tenants', access: 'none' },
      { area: 'Billing', access: 'none' },
      { area: 'Plans', access: 'none' },
      { area: 'Domains', access: 'none' },
      { area: 'Usage', access: 'none' },
      { area: 'Metrics', access: 'none' },
      { area: 'Settings', access: 'none' },
      { area: 'Users', access: 'none' },
      { area: 'Audit', access: 'none' },
      { area: 'Leads', access: 'none' },
      { area: 'Landing', access: 'none' },
      { area: 'Media', access: 'none' },
    ],
  },
];
