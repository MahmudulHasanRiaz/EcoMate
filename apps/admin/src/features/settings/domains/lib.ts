export interface DnsRecord {
  name: string
  value: string
}

export interface DnsInstructions {
  cname: DnsRecord
  txt: DnsRecord
}

export type TenantDomainType = 'SUBDOMAIN' | 'CUSTOM'

export type TenantDomainStatus =
  | 'PENDING'
  | 'VERIFIED'
  | 'ACTIVE'
  | 'FAILED'
  | 'DISABLED'

export interface TenantDomain {
  id: string
  host: string
  type: TenantDomainType
  isPrimary: boolean
  status: TenantDomainStatus
  tlsStatus: string | null
  verifiedAt: string | null
  lastCheckedAt: string | null
  createdAt: string
  /** DNS setup instructions, only while a custom domain needs setup. */
  dns: DnsInstructions | null
}

export interface AddDomainResult {
  domain: TenantDomain
  dns: DnsInstructions | null
}

export interface RecheckResult {
  verified: boolean
  domain: TenantDomain
  checks: {
    txt: { ok: boolean }
    cname: { ok: boolean; expected: string; found: string[] }
  }
  dns: DnsInstructions | null
}

export const CUSTOM_DOMAIN_FEATURE = 'custom_domain'

export const LOCKED_MESSAGE =
  'Custom domains are not included in your current plan.'

const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9.-]{1,251}[a-z0-9])$/

/**
 * Normalize what the tenant typed into a bare hostname: strip a
 * pasted scheme/path/port/trailing dot and lowercase it. Mirrors the
 * platform's normaliseHost so the UI and the API agree.
 */
export function normalizeHostnameInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
}

export function isValidHostname(host: string): boolean {
  // Stricter than the API regex on purpose: a custom domain needs a
  // DNS zone, so a dotless label can never verify. The API still has
  // the final say — this just fails fast with a friendly message.
  return HOSTNAME_RE.test(host) && host.includes('.')
}

export function domainStatusMeta(status: TenantDomainStatus): {
  label: string
  variant: 'success' | 'warning' | 'danger' | 'secondary'
} {
  switch (status) {
    case 'VERIFIED':
    case 'ACTIVE':
      return { label: 'Verified', variant: 'success' }
    case 'PENDING':
      return { label: 'Pending verification', variant: 'warning' }
    case 'FAILED':
      return { label: 'Verification failed', variant: 'danger' }
    case 'DISABLED':
      return { label: 'Disabled', variant: 'secondary' }
    default:
      return { label: status, variant: 'secondary' }
  }
}

/** Plain-language summary of a recheck, for the toast + inline result. */
export function recheckSummary(result: RecheckResult): string {
  if (result.verified) {
    return 'Domain verified — your store is now live on this domain.'
  }
  const missing: string[] = []
  if (!result.checks.txt.ok) missing.push('TXT record')
  if (!result.checks.cname.ok) missing.push('CNAME record')
  if (missing.length === 0) {
    return 'Verification is still pending.'
  }
  return `${missing.join(' and ')} not found yet — check your DNS records and try again. DNS changes can take a few minutes to propagate.`
}

export function errorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as {
    response?: { data?: { message?: string | string[] } }
  }
  const message = axiosErr?.response?.data?.message
  if (typeof message === 'string' && message) return message
  if (Array.isArray(message) && message.length > 0) return message.join(', ')
  return fallback
}

export function isForbiddenError(err: unknown): boolean {
  const axiosErr = err as { response?: { status?: number } }
  return axiosErr?.response?.status === 403
}
