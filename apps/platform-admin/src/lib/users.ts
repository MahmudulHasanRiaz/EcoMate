export const PLATFORM_ROLES = [
  'SUPERADMIN',
  'BILLING',
  'SUPPORT',
  'READONLY',
] as const;

const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: 'Superadmin',
  BILLING: 'Billing',
  SUPPORT: 'Support',
  READONLY: 'Read-only',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

const ACCESS_LABELS: Record<string, string> = {
  none: 'None',
  read: 'Read',
  write: 'Write',
  full: 'Full',
};

export function accessLabel(access: string): string {
  return ACCESS_LABELS[access] ?? access;
}
