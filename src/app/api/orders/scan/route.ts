import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError, apiNotFound, apiServerError, apiSuccess } from '@/lib/error';
import { enforcePermission } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeScanCode(raw: string): string {
  let normalized = String(raw || '').trim();

  // Support scanning a URL that ends with the order id/number.
  try {
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      const url = new URL(normalized);
      const parts = url.pathname.split('/').filter(Boolean);
      normalized = parts[parts.length - 1] || normalized;
    }
  } catch {
    // ignore
  }

  // Normalize unicode dashes and Bengali digits (some scanners/IME produce these)
  normalized = normalized
    .replace(/[‐‑‒–—−]/g, '-') // various dash chars
    .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))); // Bangla -> ASCII

  const orderNumberMatch = normalized.match(/\b\d{6}-\d+\b/);
  if (orderNumberMatch) normalized = orderNumberMatch[0];

  normalized = normalized.replace(/^#+/, '').trim();
  return normalized;
}

export async function GET(req: NextRequest) {
  try {
    // Scan mode is primarily for operational workflows (status updates). Use update permission,
    // which already has role fallbacks in our permission layer.
    const { allowed, error, staff } = await enforcePermission('orders', 'update');
    if (!allowed) return error;

    const codeRaw = req.nextUrl.searchParams.get('code');
    if (!codeRaw) return apiError('Order code is required', 400);

    const code = normalizeScanCode(codeRaw);
    if (!code) return apiError('Invalid order code', 422, { code: 'INVALID_SCAN_CODE' });

    const isOrderNumber = /^\d{6}-\d+$/.test(code);

    const order = isOrderNumber
      ? await prisma.order.findUnique({
          where: { orderNumber: code },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            businessId: true,
            isDeleted: true,
            other_Order: {
              where: { isDeleted: false },
              select: { id: true, orderNumber: true, status: true },
            },
          },
        })
      : await prisma.order.findUnique({
          where: { id: code },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            businessId: true,
            isDeleted: true,
            other_Order: {
              where: { isDeleted: false },
              select: { id: true, orderNumber: true, status: true },
            },
          },
        });

    if (!order || order.isDeleted) return apiNotFound('Order not found');

    // Business restrictions (consistent with orders list view)
    const isAdmin = staff?.role === 'Admin';
    const allowedBusinessIds = isAdmin ? undefined : staff?.accessibleBusinessIds;
    if (Array.isArray(allowedBusinessIds)) {
      if (allowedBusinessIds.length === 0) {
        return apiError('Access denied to all businesses (no access assigned)', 403, {
          code: 'NO_BUSINESS_ACCESS',
        });
      }
      if (!allowedBusinessIds.includes(order.businessId)) {
        return apiError('Access denied to this business', 403, { code: 'BUSINESS_FORBIDDEN' });
      }
    }

    return apiSuccess(
      {
        id: order.id,
        orderNumber: order.orderNumber,
        currentStatus: order.status,
        childOrders: order.other_Order,
      },
      'OK'
    );
  } catch (error: any) {
    return apiServerError(error);
  }
}
