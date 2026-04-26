import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import type { Permission } from '@/types';
import { NextResponse } from 'next/server';

type PermissionAction = 'create' | 'read' | 'update' | 'delete';
type PermissionModule = keyof import('@/types').StaffMember['permissions'];

export class PermissionError extends Error {
    constructor(message: string = 'Unauthorized: Insufficient permissions') {
        super(message);
        this.name = 'PermissionError';
    }
}

/**
 * Verifies if the current user has the required permission.
 * Throws PermissionError if not authorized.
 * Returns the staff details if authorized.
 */
export async function requirePermission(
    module: PermissionModule,
    action: PermissionAction
) {
    const auth = await getStaffAuthDetails();

    if (auth.status !== 'ok') {
        throw new PermissionError('Unauthorized: User not authenticated or blocked');
    }

    const permissions = auth.staff.permissions[module] as Permission;

    if (!permissions || !permissions[action]) {
        throw new PermissionError(`Forbidden: Missing ${action} access for ${module}`);
    }

    return auth.staff;
}

/**
 * HOF for API Routes to wrap them with permission check.
 * Usage: export const POST = withPermission('settings', 'update', async (req) => { ... })
 */
export function withPermission(
    module: PermissionModule,
    action: PermissionAction,
    handler: (req: Request, ...args: any[]) => Promise<NextResponse>
) {
    return async (req: Request, ...args: any[]) => {
        try {
            await requirePermission(module, action);
            return handler(req, ...args);
        } catch (error) {
            if (error instanceof PermissionError) {
                return new NextResponse(error.message, { status: 403 });
            }
            // Re-throw other errors to be handled by the endpoint's own try-catch or Next.js
            throw error;
        }
    };
}
