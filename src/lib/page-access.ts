import type { StaffRole, StaffMember } from '@/types';

export const PAGE_ACCESS_KEYS = [
  'pages.dashboard',
  'pages.orders',
  'pages.issues',
  'pages.packingOrders',
  'pages.courierReport',
  'pages.courierManagement',
  'pages.products',
  'pages.inventory',
  'pages.customers',
  'pages.purchases',
  'pages.expenses',
  'pages.checkPassing',
  'pages.partners',
  'pages.analytics',
  'pages.accounting',
  'pages.staff',
  'pages.attendance',
  'pages.settings',
  'pages.marketing',
  'pages.marketingAdmin',
  'pages.tasks',
  'pages.webhookFailures',
  'pages.staffAssignmentReport',
  'pages.staffAnalytics',
  'pages.saleReport',
  'pages.wholesaleManagement',
] as const;

export type PageAccessKey = typeof PAGE_ACCESS_KEYS[number];

export const PAGE_ACCESS_LIST: { key: PageAccessKey; label: string; routes: string }[] = [
  { key: 'pages.dashboard', label: 'Dashboard', routes: '/dashboard' },
  { key: 'pages.orders', label: 'Orders', routes: '/dashboard/orders/*' },
  { key: 'pages.issues', label: 'Issues', routes: '/dashboard/issues' },
  { key: 'pages.packingOrders', label: 'Packing Orders', routes: '/dashboard/packing-orders' },
  { key: 'pages.courierReport', label: 'Courier Report', routes: '/dashboard/courier-report' },
  { key: 'pages.courierManagement', label: 'Courier Management', routes: '/dashboard/courier/*' },
  { key: 'pages.products', label: 'Products', routes: '/dashboard/products/*' },
  { key: 'pages.inventory', label: 'Inventory', routes: '/dashboard/inventory' },
  { key: 'pages.customers', label: 'Customers', routes: '/dashboard/customers' },
  { key: 'pages.purchases', label: 'Purchases', routes: '/dashboard/purchases' },
  { key: 'pages.expenses', label: 'Expenses', routes: '/dashboard/expenses' },
  { key: 'pages.checkPassing', label: 'Check Passing', routes: '/dashboard/check-passing' },
  { key: 'pages.partners', label: 'Partners', routes: '/dashboard/partners' },
  { key: 'pages.analytics', label: 'Analytics', routes: '/dashboard/analytics' },
  { key: 'pages.accounting', label: 'Accounting', routes: '/dashboard/accounting' },
  { key: 'pages.staff', label: 'Staff', routes: '/dashboard/staff' },
  { key: 'pages.attendance', label: 'Attendance', routes: '/dashboard/attendance' },
  { key: 'pages.settings', label: 'Settings', routes: '/dashboard/settings' },
  { key: 'pages.marketing', label: 'Marketing', routes: '/dashboard/marketing/*' },
  { key: 'pages.marketingAdmin', label: 'Marketing Admin', routes: '/dashboard/marketing/admin' },
  { key: 'pages.tasks', label: 'Tasks', routes: '/dashboard/tasks*' },
  { key: 'pages.webhookFailures', label: 'Webhook Failures', routes: '/dashboard/webhook-failures' },
  { key: 'pages.staffAssignmentReport', label: 'Staff Assignment Report', routes: '/dashboard/staff/assignment-report' },
  { key: 'pages.staffAnalytics', label: 'Staff Analytics', routes: '/dashboard/staff/analytics' },
  { key: 'pages.saleReport', label: 'Sale Report', routes: '/dashboard/orders/sale-report' },
  { key: 'pages.wholesaleManagement', label: 'Wholesale Management', routes: '/dashboard/wholesale/*' },
];

export const ROLE_PAGE_ACCESS: Record<StaffRole, PageAccessKey[] | 'ALL'> = {
  SuperAdmin: 'ALL',
  Admin: 'ALL',
  Manager: [
    'pages.dashboard',
    'pages.orders',
    'pages.issues',
    'pages.packingOrders',
    'pages.courierReport',
    'pages.courierManagement',
    'pages.products',
    'pages.inventory',
    'pages.customers',
    'pages.purchases',
    'pages.expenses',
    'pages.checkPassing',
    'pages.partners',
    'pages.accounting',
    'pages.staff',
    'pages.attendance',
    'pages.settings',
    'pages.tasks',
    'pages.webhookFailures',
    'pages.staffAssignmentReport',
    'pages.saleReport',
    'pages.wholesaleManagement',
    'pages.staffAnalytics',
  ],
  Moderator: [
    'pages.dashboard',
    'pages.products',
    'pages.orders',
    'pages.issues',
    'pages.courierReport',
    'pages.customers',
    'pages.tasks',
  ],
  'Modarator Manager': [
    'pages.dashboard',
    'pages.products',
    'pages.orders',
    'pages.issues',
    'pages.courierReport',
    'pages.customers',
    'pages.tasks',
    'pages.staff',
    'pages.staffAssignmentReport',
  ],
  Seller: [
    'pages.dashboard',
    'pages.products',
    'pages.orders',
    'pages.issues',
    'pages.courierReport',
    'pages.customers',
    'pages.tasks',
  ],
  'Packing Assistant': [
    'pages.dashboard',
    'pages.packingOrders',
    'pages.tasks',
  ],
  'Call Assistant': [
    'pages.dashboard',
    'pages.products',
    'pages.orders',
    'pages.issues',
    'pages.courierReport',
    'pages.customers',
    'pages.tasks',
  ],
  'Call Centre Manager': [
    'pages.dashboard',
    'pages.products',
    'pages.orders',
    'pages.issues',
    'pages.courierReport',
    'pages.customers',
    'pages.staff',
    'pages.attendance',
    'pages.tasks',
    'pages.staffAssignmentReport',
  ],
  'Courier Manager': [
    'pages.dashboard',
    'pages.orders',
    'pages.issues',
    'pages.courierReport',
    'pages.courierManagement',
    'pages.customers',
    'pages.staff',
    'pages.tasks',
    'pages.staffAssignmentReport',
  ],
  'Courier Call Assistant': [
    'pages.dashboard',
    'pages.orders',
    'pages.issues',
    'pages.courierReport',
    'pages.courierManagement',
    'pages.customers',
    'pages.tasks',
  ],
  'Vendor/Supplier': [
    'pages.partners',
    'pages.checkPassing',
    'pages.purchases',
    'pages.tasks',
  ],
  Partner: [
    'pages.partners',
    'pages.checkPassing',
    'pages.purchases',
    'pages.tasks',
  ],
  'Cutting Master': [
    'pages.dashboard',
    'pages.tasks',
  ],
  Marketer: [
    'pages.dashboard',
    'pages.marketing',
    'pages.analytics',
    'pages.orders',
    'pages.customers',
    'pages.tasks',
  ],
  'Finance Manager': [
    'pages.dashboard',
    'pages.orders',
    'pages.expenses',
    'pages.accounting',
    'pages.checkPassing',
    'pages.partners',
    'pages.staff',
    'pages.purchases',
    'pages.analytics',
    'pages.attendance',
    'pages.tasks',
    'pages.staffAssignmentReport',
    'pages.staffAnalytics',
  ],
  'Project Manager': [
    'pages.dashboard',
    'pages.orders',
    'pages.issues',
    'pages.packingOrders',
    'pages.courierReport',
    'pages.courierManagement',
    'pages.products',
    'pages.inventory',
    'pages.customers',
    'pages.purchases',
    'pages.expenses',
    'pages.checkPassing',
    'pages.partners',
    'pages.accounting',
    'pages.staff',
    'pages.attendance',
    'pages.settings',
    'pages.tasks',
    'pages.staffAssignmentReport',
  ],
  'Office Assistant': [
    'pages.dashboard',
    'pages.orders',
    'pages.packingOrders',
    'pages.courierReport',
    'pages.customers',
    'pages.tasks',
  ],
  'Sales Representative': [
    'pages.dashboard',
    'pages.products',
    'pages.orders',
    'pages.customers',
    'pages.tasks',
  ],
  Custom: [],
};

const MODULE_PAGE_FALLBACK: Partial<Record<PageAccessKey, keyof StaffMember['permissions']>> = {
  'pages.orders': 'orders',
  'pages.issues': 'issues',
  'pages.packingOrders': 'packingOrders',
  'pages.courierReport': 'courierReport',
  'pages.courierManagement': 'courierManagement',
  'pages.products': 'products',
  'pages.inventory': 'inventory',
  'pages.customers': 'customers',
  'pages.purchases': 'purchases',
  'pages.expenses': 'expenses',
  'pages.checkPassing': 'checkPassing',
  'pages.partners': 'partners',
  'pages.analytics': 'analytics',
  'pages.staff': 'staff',
  'pages.attendance': 'attendance',
  'pages.settings': 'settings',
  'pages.accounting': 'accounting',
  'pages.marketing': 'marketing',
  'pages.tasks': 'tasks',
  'pages.webhookFailures': 'integrations',
  'pages.staffAssignmentReport': 'tasks',
  'pages.staffAnalytics': 'staff',
  'pages.saleReport': 'orders',
  'pages.wholesaleManagement': 'wholesaleManagement',
};

const buildEmptyPageAccess = (): Record<PageAccessKey, boolean> =>
  Object.fromEntries(PAGE_ACCESS_KEYS.map((key) => [key, false])) as Record<PageAccessKey, boolean>;

export function getPresetPageAccess(role?: string | null): Record<PageAccessKey, boolean> {
  const baseline = buildEmptyPageAccess();
  if (!role) return baseline;
  const allow = ROLE_PAGE_ACCESS[role as StaffRole];
  if (!allow) return baseline;
  if (allow === 'ALL') {
    PAGE_ACCESS_KEYS.forEach((key) => {
      baseline[key] = true;
    });
    return baseline;
  }
  allow.forEach((key) => {
    baseline[key] = true;
  });
  return baseline;
}

export function derivePageAccessFromPermissions(permissions?: StaffMember['permissions'] | null) {
  const derived = buildEmptyPageAccess();
  if (!permissions) return derived;
  for (const [pageKey, moduleKey] of Object.entries(MODULE_PAGE_FALLBACK)) {
    const permission = (permissions as any)[moduleKey];
    const hasRead = typeof permission === 'boolean' ? permission : Boolean(permission?.read);
    derived[pageKey as PageAccessKey] = hasRead;
  }
  derived['pages.dashboard'] = true;
  return derived;
}

export function normalizePageAccess(
  value: Record<string, boolean> | null | undefined,
  role?: StaffRole | string | null,
  permissions?: StaffMember['permissions'] | null,
) {
  if (value && Object.keys(value).length > 0) {
    // For non-Custom roles, merge stored values ON TOP of the current role preset
    // so that newly added pages in the role definition are automatically granted.
    const baseline = (role && role !== 'Custom')
      ? getPresetPageAccess(role)
      : buildEmptyPageAccess();
    return { ...baseline, ...value } as Record<PageAccessKey, boolean>;
  }
  if (role && role !== 'Custom') {
    return getPresetPageAccess(role);
  }
  if (permissions) {
    return derivePageAccessFromPermissions(permissions);
  }
  return getPresetPageAccess('Custom');
}

export function attachPageAccess(
  permissions: StaffMember['permissions'],
  role?: StaffRole | string | null,
) {
  return {
    ...permissions,
    pageAccess: normalizePageAccess(permissions?.pageAccess as Record<string, boolean> | undefined, role, permissions),
  };
}

export function getPageAccessKey(pathname: string): PageAccessKey | null {
  if (pathname === '/dashboard') return 'pages.dashboard';
  if (pathname === '/dashboard/staff/assignment-report') return 'pages.staffAssignmentReport';
  if (pathname === '/dashboard/staff/analytics') return 'pages.staffAnalytics';
  if (pathname === '/dashboard/orders/sale-report') return 'pages.saleReport';
  if (pathname.startsWith('/dashboard/orders')) return 'pages.orders';
  if (pathname.startsWith('/dashboard/issues')) return 'pages.issues';
  if (pathname.startsWith('/dashboard/packing-orders')) return 'pages.packingOrders';
  if (pathname.startsWith('/dashboard/courier-report')) return 'pages.courierReport';
  if (pathname.startsWith('/dashboard/courier')) return 'pages.courierManagement';
  if (pathname.startsWith('/dashboard/products')) return 'pages.products';
  if (pathname.startsWith('/dashboard/inventory')) return 'pages.inventory';
  if (pathname.startsWith('/dashboard/customers')) return 'pages.customers';
  if (pathname.startsWith('/dashboard/purchases')) return 'pages.purchases';
  if (pathname.startsWith('/dashboard/expenses')) return 'pages.expenses';
  if (pathname.startsWith('/dashboard/check-passing')) return 'pages.checkPassing';
  if (pathname.startsWith('/dashboard/partners')) return 'pages.partners';
  if (pathname.startsWith('/dashboard/analytics')) return 'pages.analytics';
  if (pathname.startsWith('/dashboard/staff')) return 'pages.staff';
  if (pathname.startsWith('/dashboard/attendance')) return 'pages.attendance';
  if (pathname.startsWith('/dashboard/settings')) return 'pages.settings';
  if (pathname.startsWith('/dashboard/accounting') || pathname.startsWith('/coming-soon')) return 'pages.accounting';
  if (pathname === '/dashboard/marketing/admin') return 'pages.marketingAdmin';
  if (pathname.startsWith('/dashboard/marketing')) return 'pages.marketing';
  if (pathname.startsWith('/dashboard/tasks')) return 'pages.tasks';
  if (pathname.startsWith('/dashboard/webhook-failures')) return 'pages.webhookFailures';
  if (pathname.startsWith('/dashboard/wholesale')) return 'pages.wholesaleManagement';
  return null;
}
