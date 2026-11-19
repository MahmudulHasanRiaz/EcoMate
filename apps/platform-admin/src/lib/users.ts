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

const OS_LABELS: Array<[RegExp, string]> = [
  [/iPhone|iPad|iOS/i, 'iOS'],
  [/Android/i, 'Android'],
  [/Windows NT/i, 'Windows'],
  [/Macintosh|Mac OS X/i, 'macOS'],
  [/Linux/i, 'Linux'],
];

const BROWSER_LABELS: Array<[RegExp, string]> = [
  [/Edg\/([\d.]+)/i, 'Edge'],
  [/OPR\/([\d.]+)/i, 'Opera'],
  [/Chrome\/([\d.]+)/i, 'Chrome'],
  [/Firefox\/([\d.]+)/i, 'Firefox'],
  [/Version\/([\d.]+).*Safari/i, 'Safari'],
];

/**
 * Short device label for a session's User-Agent, e.g. "Chrome 120 · macOS".
 * Unknown agents fall back to a truncated raw string; missing agents to
 * "Unknown device".
 */
export function sessionDeviceLabel(userAgent?: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = BROWSER_LABELS.find(([pattern]) => pattern.test(userAgent));
  const os = OS_LABELS.find(([pattern]) => pattern.test(userAgent));
  const parts: string[] = [];
  if (browser) {
    const version = userAgent.match(browser[0])?.[1]?.split('.')[0];
    parts.push(version ? `${browser[1]} ${version}` : browser[1]);
  }
  if (os) parts.push(os[1]);
  if (parts.length > 0) return parts.join(' · ');
  return userAgent.length > 48
    ? `${userAgent.slice(0, 45)}…`
    : userAgent;
}
