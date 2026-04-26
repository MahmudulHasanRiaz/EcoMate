import type { StaffMember, Permission } from '@/types';

/**
 * Permission Guard Helper
 * Checks if a staff member has the specified permission level for a specific module
 */
export function hasPermission(
    staff: StaffMember | null | undefined,
    module: keyof Omit<StaffMember['permissions'], 'pageAccess'>,
    action: keyof Permission
): boolean {
    if (!staff || !staff.permissions) return false;

    const permission = staff.permissions[module];
    if (!permission || typeof permission === 'boolean') return false;

    return permission[action] === true;
}

/**
 * Checks if staff has DELETE permission for a specific module
 */
export function canDelete(
    staff: StaffMember | null | undefined,
    module: keyof Omit<StaffMember['permissions'], 'pageAccess'>
): boolean {
    return hasPermission(staff, module, 'delete');
}

/**
 * Checks if staff has UPDATE permission for a specific module
 */
export function canUpdate(
    staff: StaffMember | null | undefined,
    module: keyof Omit<StaffMember['permissions'], 'pageAccess'>
): boolean {
    return hasPermission(staff, module, 'update');
}

/**
 * Checks if staff has CREATE permission for a specific module
 */
export function canCreate(
    staff: StaffMember | null | undefined,
    module: keyof Omit<StaffMember['permissions'], 'pageAccess'>
): boolean {
    return hasPermission(staff, module, 'create');
}

/**
 * Checks if staff has READ permission for a specific module
 */
export function canRead(
    staff: StaffMember | null | undefined,
    module: keyof Omit<StaffMember['permissions'], 'pageAccess'>
): boolean {
    return hasPermission(staff, module, 'read');
}

/**
 * Returns 403 Forbidden response
 */
export function forbiddenResponse(message = 'You do not have permission to perform this action') {
    return new Response(JSON.stringify({ error: message }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
    });
}

/**
 * Returns 401 Unauthorized response
 */
export function unauthorizedResponse(message = 'Unauthorized') {
    return new Response(JSON.stringify({ error: message }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
    });
}
