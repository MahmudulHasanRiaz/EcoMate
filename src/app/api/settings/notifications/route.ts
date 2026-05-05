import { NextResponse } from 'next/server';
import { getNotificationSettings, saveNotificationSettings } from '@/server/utils/notification-settings';
import type { NotificationSettings } from '@/lib/notification-defaults';
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

  const settings = await getNotificationSettings();
  return apiSuccess(maskSensitiveFields(settings));
}

export async function POST(req: Request) {
  const auth = await getStaffAuthDetails();
  if (auth.status !== 'ok') return apiUnauthorized();
  if (auth.staff.role !== 'Admin' && auth.staff.role !== 'SuperAdmin' && !auth.staff.permissions.settings.update) {
    return apiForbidden();
  }

  try {
    const body = (await req.json()) as Partial<NotificationSettings>;
    const saved = await saveNotificationSettings(body);
    return apiSuccess(maskSensitiveFields(saved), 'Notification settings saved');
  } catch (error: any) {
    return apiServerError(error);
  }
}
