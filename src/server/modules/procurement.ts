import { prisma } from '@/lib/prisma';
import { OrderStatus } from '@prisma/client';

export async function getProcurementDemand() {
  // Fetch all products from 'Confirmed' orders that belong to an 'Out' brand
  // and are not yet fulfilled.
  // Fulfillment check: For now, we look at orders with status 'Confirmed'.
  // Once packed, they move to 'Packed'.
  
  const orders = await prisma.order.findMany({
    where: {
      status: 'Confirmed',
      isDeleted: false,
      type: { in: ['REGULAR', 'EXCHANGE'] },
    },
    include: {
      products: {
        include: {
          product: {
            include: {
              Brand: true,
              variants: true,
            },
          },
        },
      },
    },
  });

  const demandMap = new Map<string, {
    productId: string;
    variantId: string | null;
    sku: string;
    productName: string;
    brandName: string;
    brandId: string;
    requiredQty: number;
    availableStock: number;
    netNeeded: number;
    orderNumbers: string[];
    productImage?: string;
  }>();

  for (const order of orders) {
    for (const op of order.products) {
      if (!op.product || !op.product.isPublished) continue;
      if (!op.product.Brand || !op.product.Brand.isActive || op.product.Brand.type !== 'Out') continue;

      const key = `${op.productId}:${op.variantId || ''}`;
      const variant = op.product.variants.find(v => v.id === op.variantId);
      const sku = variant?.sku || op.product.sku || op.productId;
      
      const orderNumber = order.orderNumber || 'Unknown';
      const brandName = op.product.Brand?.name || 'Unknown';
      const brandId = op.product.Brand?.id || 'none';
      
      const existing = demandMap.get(key);
      if (existing) {
        existing.requiredQty += op.quantity;
        if (!existing.orderNumbers.includes(orderNumber)) {
          existing.orderNumbers.push(orderNumber);
        }
      } else {
        const { getAvailableQty } = await import('./orders');
        const availableStock = await getAvailableQty(prisma, op.productId, op.variantId || null);

        let productImage = '';
        try {
          const imgData = JSON.parse(op.product.image || '[]');
          if (Array.isArray(imgData) && imgData.length > 0) {
            productImage = imgData[0].url;
          }
        } catch (e) {
          productImage = op.product.image || '';
        }

        demandMap.set(key, {
          productId: op.productId,
          variantId: op.variantId || null,
          sku,
          productName: op.product.name,
          brandName,
          brandId,
          requiredQty: op.quantity,
          availableStock,
          netNeeded: 0, // Placeholder
          orderNumbers: [orderNumber],
          productImage,
        });
      }
    }
  }

  // Finalize netNeeded and filter
  const finalDemand = Array.from(demandMap.values()).map(item => {
    item.netNeeded = Math.max(0, item.requiredQty - item.availableStock);
    return item;
  }).filter(item => item.netNeeded > 0);

  // Sort by Brand then SKU
  return finalDemand.sort((a, b) => {
    if (a.brandName !== b.brandName) return a.brandName.localeCompare(b.brandName);
    return a.sku.localeCompare(b.sku);
  });
}
