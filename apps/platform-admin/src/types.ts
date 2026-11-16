export type TenantStatus =
  | 'PENDING_VERIFICATION'
  | 'PROVISIONING'
  | 'TRIAL'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'DELETED';

export interface TenantDomain {
  id: string;
  host: string;
  type: 'SUBDOMAIN' | 'CUSTOM';
  status: string;
  isPrimary: boolean;
  tlsStatus?: string | null;
}

export interface PlanVersion {
  id: string;
  version: number;
  price: string | number;
  currency: string;
  interval: string;
  trialDays: number;
  features: string[];
  limits: Record<string, unknown>;
  archivedAt?: string | null;
}

export interface Subscription {
  id: string;
  status: string;
  currentPeriodEnd: string;
  trialEndsAt?: string | null;
  planVersion?: PlanVersion | null;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  ownerEmail: string;
  ownerPhone?: string | null;
  trialEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  domains?: TenantDomain[];
  planVersion?: PlanVersion | null;
  subscription?: Subscription | null;
  _count?: { invoices?: number; payments?: number };
}

export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface Plan {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  isPublic: boolean;
  isFree: boolean;
  sortOrder: number;
  badge?: string | null;
  createdAt?: string;
  currentVersion?: PlanVersion | null;
  versions: PlanVersion[];
}

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status?: string;
  lastLoginAt?: string | null;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: PlatformUser;
}
