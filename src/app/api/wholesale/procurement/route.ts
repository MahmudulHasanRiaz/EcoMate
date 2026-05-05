import { NextRequest } from 'next/server';
import { getProcurementDemand } from '@/server/modules/procurement';
import { apiSuccess, apiServerError, apiError } from '@/lib/error';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';

export async function GET(req: NextRequest) {
  try {
    const auth = await getStaffAuthDetails();
    if (auth.status !== 'ok') {
      return apiError('Unauthorized', 401);
    }

    const allowedRoles = ['SuperAdmin', 'Admin', 'Manager'];
    if (!allowedRoles.includes(auth.staff.role)) {
      return apiError('Access denied: Wholesale procurement is restricted to SuperAdmin, Admin, and Managers.', 403);
    }

    const data = await getProcurementDemand();
    return apiSuccess(data);
  } catch (error: any) {
    return apiServerError(error);
  }
}
