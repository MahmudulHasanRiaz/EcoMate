import prisma from '@/lib/prisma';
import { apiServerError, apiSuccess } from '@/lib/error';
import { enforcePermission } from '@/lib/security';

/**
 * GET /api/inventory/stock-aggregates
 * Returns aggregated stock data per product+variant for use in purchase dialogs.
 * This provides real-time inventory data instead of stale Product.inventory field.
 */
export async function GET() {
    try {
        // Used in Purchase flows too, so allow either `inventory:read` or `purchases:read`.
        let perm = await enforcePermission('inventory', 'read');
        if (!perm.allowed) {
            perm = await enforcePermission('purchases', 'read');
        }
        if (!perm.allowed) return perm.error;

        const rows = await prisma.inventoryItem.groupBy({
            by: ['productId', 'variantId'],
            _sum: { quantity: true, reservedQuantity: true },
        });

        const items = rows.map(row => ({
            productId: row.productId,
            variantId: row.variantId ?? null,
            quantity: row._sum.quantity ?? 0,
            reservedQuantity: row._sum.reservedQuantity ?? 0,
        }));

        return apiSuccess({ items });
    } catch (error: any) {
        console.error('[API:INVENTORY_STOCK_AGGREGATES]', error);
        return apiServerError(error);
    }
}
