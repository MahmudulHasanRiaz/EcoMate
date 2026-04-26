import { NextRequest } from 'next/server';
import { getPaginationParams } from '@/lib/pagination';
import { getOrders, createOrder, normalizeStatusInput } from '@server/modules/orders';
import { enforcePermission } from '@/lib/security';
import { createOrderSchema } from '@/lib/validations/orders';
import { apiSuccess, apiServerError, apiError } from '@/lib/error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_ORDER_PAGE_SIZE = 5000;

function isStockError(error: any) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'INSUFFICIENT_STOCK' || message.includes('insufficient stock');
}

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const status = url.searchParams.get('status') || undefined;
    const normalizedStatus = normalizeStatusInput(status);
    const packingViewRequested = url.searchParams.get('packingView') === '1';
    const packingStatusRequested = !!normalizedStatus && ['Confirmed', 'Packing_Hold'].includes(normalizedStatus);

    const ordersAccess = await enforcePermission('orders', 'read');

    let packingAccess: Awaited<ReturnType<typeof enforcePermission>> | null = null;
    if (!ordersAccess.allowed || packingViewRequested) {
      packingAccess = await enforcePermission('packingOrders', 'read');
    }

    if (!ordersAccess.allowed) {
      if (!packingAccess?.allowed || !packingViewRequested) return ordersAccess.error;
    }

    const staff = ordersAccess.allowed ? ordersAccess.staff : packingAccess!.staff;
    const packingView = !!(packingViewRequested && packingAccess?.allowed);

    const phone = url.searchParams.get('phone') || undefined;
    const businessId = url.searchParams.get('businessId') || undefined;
    const platform = url.searchParams.get('platform') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const pagination = getPaginationParams(
      {
        page: url.searchParams.get('page') || undefined,
        pageSize: url.searchParams.get('pageSize') || undefined,
        cursor: url.searchParams.get('cursor') || undefined,
      },
      { maxPageSize: MAX_ORDER_PAGE_SIZE }
    );
    const includeTotal = true;
    const assignedToId = url.searchParams.get('assignedToId') || undefined;
    const dateFromParam = url.searchParams.get('dateFrom');
    const dateToParam = url.searchParams.get('dateTo');

    const dateFrom = dateFromParam ? new Date(dateFromParam) : undefined;
    const dateTo = dateToParam ? new Date(dateToParam) : undefined;

    const sortField = (url.searchParams.get('sortField') as any) || undefined;
    const sortOrder = (url.searchParams.get('sortOrder') as any) || undefined;

    // Access Control
    const isAdmin = staff?.role === 'Admin';
    const allowedBusinessIds = packingView ? undefined : (isAdmin ? undefined : staff.accessibleBusinessIds);

    // Packing view: allow only packing statuses
    if (packingView) {
      if (!normalizedStatus || !['Confirmed', 'Packing_Hold'].includes(normalizedStatus)) {
        return apiError('Access denied', 403);
      }
    }

    // Strict validation for non-admins requesting specific business
    if (!packingView && businessId && !isAdmin) {
      if (!allowedBusinessIds?.includes(businessId)) {
        return apiError('Access denied to this business', 403);
      }
    }

    const data = await getOrders({
      status,
      phone,
      businessId,
      platform,
      search,
      pageSize: pagination.pageSize,
      page: pagination.page,
      cursor: pagination.cursor,
      assignedToId,
      dateFrom,
      dateTo,
      includeTotal,
      allowedBusinessIds,
      sortField,
      sortOrder,
      excludeComboOnly: packingView,
    });
    return apiSuccess(data);
  } catch (error: any) {
    if (error?.code === 'INSUFFICIENT_STOCK') {
      return apiError(error.message, 422, { code: 'INSUFFICIENT_STOCK' });
    }
    return apiServerError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission('orders', 'create');
    if (!allowed) return error;

    const body = await req.json();

    // Validate with Zod
    const validated = createOrderSchema.safeParse(body);
    if (!validated.success) {
      return apiError('Validation failed', 422, validated.error);
    }

    const order = await createOrder(validated.data);
    return apiSuccess(order, 'Order created successfully', 201);
  } catch (error: any) {
    if (error?.code === 'INVALID_PHONE') {
      return apiError('Valid phone number is required', 422, { code: 'INVALID_PHONE', customerPhone: ['Valid phone number is required'] });
    }
    if (error?.code === 'RESERVED_NOT_IN_PACKING') {
      return apiError(
        error.message || 'Reserved stock is not in Packing Section. Transfer reserved stock first.',
        409,
        {
          code: 'RESERVED_NOT_IN_PACKING',
          orderId: error.orderId,
          missing: error.missing,
        }
      );
    }
    if (error?.code === 'RESERVATION_MISMATCH') {
      return apiError(
        'Stock reservation data mismatch. Please run the stock repair/reset scripts and try again.',
        409,
        {
          code: 'RESERVATION_MISMATCH',
          orderId: error.orderId,
          inventoryItemId: error.inventoryItemId,
          productId: error.productId,
          variantId: error.variantId,
          suggestedCommand: error.suggestedCommand || 'npx tsx scripts/repair-reserved-quantities-from-allocations.ts',
        }
      );
    }
    if (isStockError(error)) {
      return apiError(error?.message || 'Insufficient stock for one or more items', 422, { code: 'INSUFFICIENT_STOCK' });
    }
    if (error?.code === 'SKU_MISMATCH') {
      return apiError(error.message, 422, {
        code: 'SKU_MISMATCH',
        sku: [error.message],
        productId: error.productId,
        variantId: error.variantId,
        expectedSku: error.expectedSku,
        actualSku: error.actualSku,
        variantSku: error.variantSku,
      });
    }
    if (error?.code === 'SKU_NOT_FOUND' || error?.code === 'PRODUCT_NOT_FOUND') {
      return apiError(error.message, 422, {
        code: error.code,
        sku: [error.message],
        productId: error.productId,
        variantId: error.variantId,
        expectedSku: error.expectedSku,
      });
    }
    if (error?.code === 'VARIANT_MISSING') {
      return apiError(error.message, 422, { code: 'VARIANT_MISSING', productId: error.productId, sku: error.sku });
    }
    if (error?.code === 'P2002') {
      return apiError('A record with this value already exists. Please check for duplicates.', 409, { code: 'DUPLICATE' });
    }
    if (error?.code === 'P2003') {
      return apiError('One or more selected products or references are invalid. Please refresh and try again.', 422, { code: 'INVALID_REFERENCE' });
    }
    if (error?.constructor?.name === 'PrismaClientValidationError') {
      return apiError('Invalid data provided. Please check your input.', 422, { code: 'VALIDATION_ERROR' });
    }
    return apiServerError(error);
  }
}
