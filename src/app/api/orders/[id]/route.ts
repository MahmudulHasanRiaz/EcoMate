import { NextRequest } from 'next/server';
import { getOrderById, updateOrderDetails, deleteOrder, restoreOrder } from '@server/modules/orders';
import { enforcePermission } from '@/lib/security';
import { updateOrderSchema } from '@/lib/validations/orders';
import { apiSuccess, apiServerError, apiError, apiNotFound } from '@/lib/error';
import { assertNotPreCutoff } from '@/server/modules/cutoff';
import { isAdminOrAbove } from '@/server/auth/role-guards';

function isStockError(error: any) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return code === 'INSUFFICIENT_STOCK' || message.includes('insufficient stock');
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { allowed, error } = await enforcePermission('orders', 'read');
    if (!allowed) return error;

    const { id } = await params;
    const order = await getOrderById(id);
    if (!order) return apiNotFound('Order not found');

    return apiSuccess(order);
  } catch (error: any) {
    return apiServerError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { allowed, error, staff } = await enforcePermission('orders', 'update');
    if (!allowed) return error;

    const { id } = await params;

    // Pre-cutoff guard: block edits to historical orders
    const existingOrder = await getOrderById(id);
    if (existingOrder) {
      await assertNotPreCutoff(existingOrder.createdAt);
    }

    const body = await req.json();

    // Validate with Zod
    const validated = updateOrderSchema.safeParse(body);
    if (!validated.success) {
      return apiError('Validation failed', 422, validated.error);
    }

    const result = await updateOrderDetails(id, validated.data, staff?.name || 'System');
    return apiSuccess(result, 'Order updated successfully');
  } catch (error: any) {
    if (error?.message?.includes('কাটঅফ') || error?.message?.includes('cutoff date')) {
      return apiError(error.message, 403, { code: 'PRE_CUTOFF' });
    }
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
    if (error.code === 'ORDER_CONFLICT') {
      return apiError(error.message, 409, { code: 'ORDER_CONFLICT', latest: error.latest });
    }
    if (error.code === 'LOCKED') {
      return apiError(error.message, 409, { code: 'LOCKED', lock: error.lock });
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
    if (error?.code === 'P2003') {
      return apiError('One or more selected products or references are invalid. Please refresh and try again.', 422, { code: 'INVALID_REFERENCE' });
    }
    if (error?.code === 'P2002') {
      return apiError('A record with this value already exists. Please check for duplicates.', 409, { code: 'DUPLICATE' });
    }
    if (error?.constructor?.name === 'PrismaClientValidationError') {
      return apiError('Invalid data provided. Please check your input.', 422, { code: 'VALIDATION_ERROR' });
    }
    console.error('[ORDERS_PATCH_ERROR]', error?.code || 'UNKNOWN', error?.message || error);
    return apiServerError(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { allowed, error, staff } = await enforcePermission('orders', 'delete');
    if (!allowed) return error;
    if (!staff || staff.role !== 'SuperAdmin') {
      return apiError('Only SuperAdmin can delete or restore orders', 403);
    }

    const { id } = await params;

    // Pre-cutoff guard: block deletion of historical orders
    const orderToDelete = await getOrderById(id);
    if (orderToDelete) {
      await assertNotPreCutoff(orderToDelete.createdAt);
    }

    // Parse body for note and optional action
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok for backward compat check below */ }

    // Restore action
    if (body?.action === 'restore') {
      const result = await restoreOrder(id, staff.name || 'System', staff.id);
      return apiSuccess(result, 'Order restored successfully');
    }

    // Soft delete requires a note
    const note = body?.note || body?.deleteNote;
    if (!note || !String(note).trim()) {
      return apiError('Delete note is required', 422, { code: 'DELETE_NOTE_REQUIRED' });
    }

    const result = await deleteOrder(id, staff.name || 'System', { userId: staff.id, note: String(note).trim() });
    return apiSuccess(result, 'Order deleted (soft) successfully');
  } catch (error: any) {
    if (error?.message?.includes('কাটঅফ') || error?.message?.includes('cutoff date')) {
      return apiError(error.message, 403, { code: 'PRE_CUTOFF' });
    }
    if (error?.code === 'DELETE_NOTE_REQUIRED') {
      return apiError(error.message, 422, { code: 'DELETE_NOTE_REQUIRED' });
    }
    return apiServerError(error);
  }
}
