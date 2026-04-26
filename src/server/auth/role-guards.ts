import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { PermissionError } from './guards';

/**
 * Checks if a staff member has the SuperAdmin role.
 */
export function isSuperAdmin(staff: { role: string }): boolean {
    return staff.role === 'SuperAdmin';
}

/**
 * Checks if a staff member has the SuperAdmin or Admin role.
 */
export function isAdminOrAbove(staff: { role: string }): boolean {
    return staff.role === 'SuperAdmin' || staff.role === 'Admin';
}

/**
 * Verifies that the current user has the SuperAdmin role.
 * Throws PermissionError if not authorized.
 * Returns the staff details if authorized.
 */
export async function requireSuperAdmin() {
    const auth = await getStaffAuthDetails();

    if (auth.status !== 'ok') {
        throw new PermissionError('Unauthorized: User not authenticated or blocked');
    }

    if (!isSuperAdmin(auth.staff)) {
        throw new PermissionError('Forbidden: This action requires Super Admin privileges');
    }

    return auth.staff;
}
