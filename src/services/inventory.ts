'use server';

import prisma from '@/lib/prisma';
import type { InventoryItem, InventoryMovement, StockLocation } from '@/types';
import {
  getInventoryPaginated,
  getInventoryLotsPaginated,
  getInventoryMovementsPaginated,
  getAuditItemsPaginated,
  getInventoryStats
} from '@/server/modules/inventory';
import { unstable_cache } from 'next/cache';

export type InventoryItemWithSourceIds = InventoryItem & {
  sourceItemIds: string[];
  productName?: string;
  variantName?: string;
  productImage?: string;
  variantImage?: string;
  sku?: string;
  categoryName?: string;
  productType?: string;
};

/**
 * Optimized Inventory Fetching
 * Wraps server module logic as Server Actions.
 */
export async function getInventory(params?: {
  cursor?: string;
  pageSize?: number;
  search?: string;
  locationId?: string;
  productId?: string;
  variantId?: string;
  status?: 'active' | 'low-stock' | 'low-stock-available' | 'out-of-stock' | 'all';
  lowStockThreshold?: number;
}) {
  // Returns { items: InventoryItemWithSourceIds[], nextCursor: string | null }
  return await getInventoryPaginated(params || {});
}

export async function getInventoryLots(params?: { cursor?: string; pageSize?: number; search?: string; productId?: string; variantId?: string; locationId?: string }) {
  return await getInventoryLotsPaginated(params || {});
}

export async function getInventoryMovements(params: any) {
  return await getInventoryMovementsPaginated(params);
}
// For Audit
export async function getAuditItems(params: { locationId: string; search?: string; cursor?: string; pageSize?: number }) {
  return await getAuditItemsPaginated(params);
}

// Stats
export async function getInventoryStatsWrapper(params: {
  search?: string;
  locationId?: string;
  lowStockThreshold?: number;
}) {
  return await getInventoryStats(params);
}

// Locations - kept separate as it's small reference data
export const getStockLocations = unstable_cache(
  async (): Promise<StockLocation[]> => {
    try {
      return await prisma.stockLocation.findMany({
        orderBy: { name: 'asc' }
      });
    } catch (error) {
      console.error('Failed to fetch locations:', error);
      return [];
    }
  },
  ['locations'],
  { tags: ['locations'] }
);
