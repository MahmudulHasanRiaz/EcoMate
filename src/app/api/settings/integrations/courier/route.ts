import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { revalidateTag } from 'next/cache';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { maskSensitiveFields, isMaskedSecret } from '@/lib/secret-utils';
import { apiUnauthorized, apiForbidden, apiSuccess, apiServerError, apiError } from '@/lib/error';

export const revalidate = 0;

export async function GET() {
  const auth = await getStaffAuthDetails();
  if (auth.status !== 'ok') return apiUnauthorized();
  if (auth.staff.role !== 'Admin' && auth.staff.role !== 'SuperAdmin' && !auth.staff.permissions.settings.read) {
    return apiForbidden();
  }

  try {
    const couriers = await prisma.courierIntegration.findMany({
      orderBy: { createdAt: 'desc' },
      include: { Business: true },
    });

    return apiSuccess(
      couriers.map((c) => ({
        ...c,
        credentials: maskSensitiveFields(c.credentials),
        businessName: c.Business?.name || '',
      }))
    );
  } catch (error) {
    return apiServerError(error);
  }
}

export async function POST(req: NextRequest) {
  const auth = await getStaffAuthDetails();
  if (auth.status !== 'ok') return apiUnauthorized();
  if (auth.staff.role !== 'Admin' && auth.staff.role !== 'SuperAdmin' && !auth.staff.permissions.settings.update) {
    return apiForbidden();
  }

  const body = await req.json().catch(() => ({}));
  const { businessId, courierName, credentials, status = 'Active', deliveryType, itemType } = body || {};

  if (!businessId || !courierName || !credentials) {
    return apiError('businessId, courierName, and credentials are required', 400);
  }

  try {
    const created = await prisma.courierIntegration.create({
      data: {
        businessId,
        courierName,
        status,
        credentials,
        deliveryType: deliveryType ?? null,
        itemType: itemType ?? null,
      },
      include: { Business: true },
    });
    revalidateTag('integrations');
    return apiSuccess({
      ...created,
      credentials: maskSensitiveFields(created.credentials),
      businessName: created.Business?.name || ''
    }, 'Integration created');
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return apiError('Integration already exists for this business/courier', 409);
    }
    return apiServerError(err);
  }
}

function mergeCredentials(current: any, updated: any): any {
  if (!updated || typeof updated !== 'object') return updated;
  if (!current || typeof current !== 'object') return updated;

  const result = { ...current, ...updated };
  for (const key of Object.keys(updated)) {
    const val = updated[key];
    if (isMaskedSecret(val)) {
      result[key] = current[key];
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = mergeCredentials(current[key], val);
    }
  }
  return result;
}

export async function PUT(req: NextRequest) {
  const auth = await getStaffAuthDetails();
  if (auth.status !== 'ok') return apiUnauthorized();
  if (auth.staff.role !== 'Admin' && auth.staff.role !== 'SuperAdmin' && !auth.staff.permissions.settings.update) {
    return apiForbidden();
  }

  const body = await req.json().catch(() => ({}));
  const { id, credentials, status, deliveryType, itemType } = body || {};
  if (!id) return apiError('id is required', 400);

  try {
    const current = await prisma.courierIntegration.findUnique({ where: { id } });
    const mergedCredentials = credentials ? mergeCredentials(current?.credentials, credentials) : undefined;

    const updated = await prisma.courierIntegration.update({
      where: { id },
      data: {
        credentials: mergedCredentials ?? undefined,
        status: status ?? undefined,
        deliveryType: deliveryType ?? undefined,
        itemType: itemType ?? undefined,
      },
      include: { Business: true },
    });
    revalidateTag('integrations');
    return apiSuccess({
      ...updated,
      credentials: maskSensitiveFields(updated.credentials),
      businessName: updated.Business?.name || ''
    }, 'Integration updated');
  } catch (err) {
    return apiServerError(err);
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await getStaffAuthDetails();
  if (auth.status !== 'ok') return apiUnauthorized();
  if (auth.staff.role !== 'Admin' && auth.staff.role !== 'SuperAdmin' && !auth.staff.permissions.settings.delete) {
    return apiForbidden();
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) return apiError('id is required', 400);

  try {
    await prisma.courierIntegration.delete({
      where: { id },
    });
    revalidateTag('integrations');
    return apiSuccess(null, 'Integration deleted successfully');
  } catch (err) {
    return apiServerError(err);
  }
}
