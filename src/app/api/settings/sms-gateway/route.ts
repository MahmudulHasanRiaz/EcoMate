import { NextResponse } from 'next/server';
import { getSmsGatewaySettings, saveSmsGatewaySettings } from '@/server/utils/sms-settings';
import type { SmsGatewaySettings } from '@/lib/sms-settings';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { maskSensitiveFields } from '@/lib/secret-utils';
import { apiUnauthorized, apiForbidden, apiSuccess, apiServerError } from '@/lib/error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await getStaffAuthDetails();
  if (auth.status !== 'ok') return apiUnauthorized();
  if (auth.staff.role !== 'Admin' && auth.staff.role !== 'SuperAdmin' && !auth.staff.permissions.settings.read) {
    return apiForbidden();
  }

  const settings = await getSmsGatewaySettings();
  return apiSuccess(maskSensitiveFields(settings));
}

export async function POST(req: Request) {
  const auth = await getStaffAuthDetails();
  if (auth.status !== 'ok') return apiUnauthorized();
  if (auth.staff.role !== 'Admin' && auth.staff.role !== 'SuperAdmin' && !auth.staff.permissions.settings.update) {
    return apiForbidden();
  }

  try {
    const body = (await req.json()) as Partial<SmsGatewaySettings>;
    const saved = await saveSmsGatewaySettings(body);
    return apiSuccess(maskSensitiveFields(saved), 'SMS settings saved');
  } catch (error: any) {
    return apiServerError(error);
  }
}
