
'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import type { StaffMember } from '@/types';
import { getPageAccessKey } from '@/lib/page-access';
import { usePermissions } from './use-permissions';

const ROUTE_PERMISSIONS: Record<string, keyof StaffMember['permissions']> = {
    '/dashboard/staff': 'staff',
    '/dashboard/settings': 'settings',
    '/dashboard/analytics': 'analytics',
    '/dashboard/products': 'products',
    '/dashboard/orders': 'orders',
    '/dashboard/customers': 'customers',
    '/dashboard/inventory': 'inventory',
    '/dashboard/purchases': 'purchases',
    '/dashboard/expenses': 'expenses',
    '/dashboard/check-passing': 'checkPassing',
    '/dashboard/partners': 'partners',
    '/dashboard/courier-report': 'courierReport',
    '/dashboard/courier': 'courierManagement',
    '/dashboard/packing-orders': 'packingOrders',
    '/dashboard/issues': 'issues',
    '/dashboard/attendance': 'attendance',
    '/dashboard/accounting': 'accounting',
};

export function useAuthorization() {
  const pathname = usePathname();
  const permissions = usePermissions();
  const [isChecking, setIsChecking] = React.useState(true);
  const [isAuthorized, setIsAuthorized] = React.useState(false);

  React.useEffect(() => {
    // If permissions are not yet loaded from Clerk, we are in a checking state.
    if (permissions === null) {
      setIsChecking(true);
      return;
    }

    // The main dashboard page is always accessible if you are logged in.
    if (pathname === '/dashboard' || pathname === '/dashboard/account' || pathname === '/dashboard/notifications') {
        setIsAuthorized(true);
        setIsChecking(false);
        return;
    }

    const pageAccessKey = getPageAccessKey(pathname);
    const pageAccess = permissions?.pageAccess;

    if (pageAccessKey && pageAccess) {
        setIsAuthorized(Boolean(pageAccess[pageAccessKey]));
        setIsChecking(false);
        return;
    }

    // Find the base route to determine the required permission key.
    const requiredPermissionKey = Object.keys(ROUTE_PERMISSIONS).find(
      (key) => pathname.startsWith(key)
    );

    let hasAccess = true;

    if (requiredPermissionKey) {
        const permissionName = ROUTE_PERMISSIONS[requiredPermissionKey];
        const permission = permissions[permissionName];
        
        hasAccess = false;
        if (typeof permission === 'boolean') {
            hasAccess = permission;
        } else if (permission) {
            // Check for read access by default for any page within a module
            hasAccess = permission.read;
        }
    }
    
    setIsAuthorized(hasAccess);
    setIsChecking(false);

  }, [pathname, permissions]);

  return { isAuthorized, isChecking };
}
