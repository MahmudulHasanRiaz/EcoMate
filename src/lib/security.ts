import { getStaffAuthDetails } from '@server/modules/staff-auth';
import { apiForbidden, apiUnauthorized } from './error';

export type PermissionAction = 'read' | 'create' | 'update' | 'delete';

function normalizeRoleToken(role?: string | null): string {
    return String(role || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '');
}

function hasOrdersUpdateRoleFallback(role?: string | null): boolean {
    const normalized = normalizeRoleToken(role);
    const allow = new Set([
        'superadmin',
        'admin',
        'manager',
        'moderator',
        'modaratormanager',
        'modaratormanager', // defensive duplicate-safe entry
        'callassistant',
        'callcentremanager',
    ]);
    return allow.has(normalized);
}

function hasStaffReadRoleFallback(role?: string | null): boolean {
    const normalized = normalizeRoleToken(role);
    if (!normalized) return false;
    // Any manager role name (including "callcentremanager", "projectmanager", etc.) + admin.
    return normalized === 'superadmin' || normalized === 'admin' || normalized.includes('manager');
}

function hasStaffWriteRoleFallback(role?: string | null): boolean {
    const normalized = normalizeRoleToken(role);
    const allow = new Set([
        'superadmin',
        'admin',
        'manager',
        'callcentremanager',
        'projectmanager',
        'modaratormanager',
    ]);
    return allow.has(normalized);
}

function hasWholesaleRoleFallback(role?: string | null, action?: PermissionAction): boolean {
    const normalized = normalizeRoleToken(role);
    if (!normalized) return false;
    
    // Core admins have all
    if (['superadmin', 'admin', 'manager', 'projectmanager', 'financemanager'].includes(normalized)) {
        return true;
    }
    
    // SRs shouldn't manage wholesale rules/targets/approvals (they use SR portal)
    // but they might need specific read access if requested. The Phase 9 instruction:
    // "explicitly define which additional roles can..."
    
    // For 'read' action: moderators might need to view wholesale orders
    if (action === 'read') {
        if (['moderator', 'modaratormanager', 'callcentremanager', 'salesrepresentative'].includes(normalized)) {
            return true;
        }
    }
    return false;
}

/**
 * Checks if the current authenticated user has the required permission.
 * Returns { allowed, error, staff }
 */
export async function checkPermission(module: string, action: PermissionAction) {
    const result = await getStaffAuthDetails();
    if (result.status !== 'ok') {
        return { allowed: false, error: apiUnauthorized(), staff: null };
    }

    const staff = result.staff;
    const perms = staff.permissions?.[module];

    // If perms is boolean true, they have all access to this module
    if (perms === true) return { allowed: true, staff };

    // If it's an object, check the specific action
    if (perms && typeof perms === 'object' && perms[action]) return { allowed: true, staff };

    // Safety fallback for wholesale permissions
    if (module === 'wholesaleManagement' && hasWholesaleRoleFallback(staff.role, action)) {
        return { allowed: true, staff };
    }

    // Safety fallback for order edit permission on core call-center/moderation roles.
    if (module === 'orders' && action === 'update' && hasOrdersUpdateRoleFallback(staff.role)) {
        return { allowed: true, staff };
    }

    // Safety fallback for staff profile/list reads by manager-class roles.
    if (module === 'staff' && action === 'read' && hasStaffReadRoleFallback(staff.role)) {
        return { allowed: true, staff };
    }

    // Safety fallback for known manager roles that are expected to invite/edit staff.
    if (module === 'staff' && (action === 'create' || action === 'update') && hasStaffWriteRoleFallback(staff.role)) {
        return { allowed: true, staff };
    }

    return { allowed: false, error: apiForbidden(`Missing permission: ${module}.${action}`), staff };
}

/**
 * High-level helper for API routes to enforce permission in one line.
 * Usage: const { allowed, error, staff } = await enforcePermission('orders', 'read');
 * if (!allowed) return error;
 */
export async function enforcePermission(module: string, action: PermissionAction) {
    return checkPermission(module, action);
}
