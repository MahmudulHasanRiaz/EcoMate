import prisma from '@/lib/prisma';
import { generateOrderNumber } from '../utils/orderNumber';
import { handleStockReservation } from './stock-reservation';
import { resolveSkuMap } from './woo-sku-map';
import { notifyAdmins } from './notifications';
import { normalizeBdPhoneForStorage, generateInvalidPhonePlaceholder } from '@/lib/phone';
import { getGeneralSettings } from '../utils/app-settings';
import { inferPlatformFromUrl } from '@/server/utils/platform';
import { tryAutoUtmAttribution } from '@/server/modules/marketing';
import { ValidatedIntegration } from '../auth/integration';
import crypto from 'crypto';

export type GenericOrderPayload = {
  externalOrderId: string;
  customer: {
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    district?: string;
    city?: string;
  };
  items: Array<{
    sku: string;
    quantity: number;
    price?: number;
    name?: string;
  }>;
  paymentMethod?: string;
  note?: string;
  landingPage?: string;
  platform?: string;
};

function mapPaymentMethod(method?: string): 'CashOnDelivery' | 'bKash' | 'Nagad' {
  const m = (method || '').toLowerCase();
  if (m.includes('bkash') || m.includes('bikash')) return 'bKash';
  if (m.includes('nagad')) return 'Nagad';
  return 'CashOnDelivery';
}

export async function processGenericOrder(
  integration: ValidatedIntegration,
  payload: GenericOrderPayload
): Promise<{ success: boolean; orderId?: string; alreadyExists?: boolean; message?: string }> {
  const { externalOrderId, customer, items, paymentMethod, note, landingPage } = payload;

  const internalOrderId = `${integration.platform || 'site'}-${integration.id}-${externalOrderId}`;

  const existing = await prisma.order.findUnique({
    where: { id: internalOrderId },
    select: { id: true },
  });
  if (existing) {
    return { success: true, alreadyExists: true, orderId: existing.id };
  }

  const phoneRaw = customer?.phone || '';
  const phoneNormalized = normalizeBdPhoneForStorage(phoneRaw);
  const normalizedPhone = phoneNormalized.value || generateInvalidPhonePlaceholder();
  const normalizedPhoneValue = phoneNormalized.value || null;

  const name = customer?.name || 'Customer';
  const email = customer?.email || null;
  const customerAddress = customer?.address || '';
  const customerDistrict = customer?.district || customer?.city || '';
  const customerCity = customer?.city || '';

  const lineTotal = items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 0)), 0);
  const total = lineTotal;

  const addressLine = customerCity ? `${customerAddress}, ${customerCity}` : customerAddress;
  const customerRecord = await prisma.customer.upsert({
    where: { phone: normalizedPhone },
    update: {
      name: name || undefined,
      email: email || undefined,
      address: addressLine || '',
      district: customerDistrict || '',
      country: 'BD',
      updatedAt: new Date(),
    } as any,
    create: {
      name: name || 'Customer',
      phone: normalizedPhone,
      email: email || undefined,
      joinDate: new Date(),
      address: addressLine || '',
      district: customerDistrict || '',
      country: 'BD',
    } as any,
  });

  const shippingAddress = {
    address: addressLine,
    district: customerDistrict,
    city: customerCity || undefined,
    country: 'BD',
  };

  const skusRaw = items.map(i => (i.sku || '').trim()).filter(Boolean);
  const skuMap = await resolveSkuMap(skusRaw);
  const productIds = Array.from(new Set(Array.from(skuMap.values()).map(v => v.productId)));
  const productInfos = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        include: {
          variants: true,
          comboItems: { include: { child: true } },
        },
      })
    : [];
  const productInfoMap = new Map(productInfos.map(p => [p.id, p]));

  const productCreates = items
    .map(item => {
      const skuRaw = (item.sku || '').trim();
      const sku = skuRaw.toLowerCase();
      const match = skuMap.get(sku);
      const productId = match?.productId;
      const variantId = match?.variantId;
      const quantity = Number(item.quantity || 0);
      if (!productId || quantity <= 0) return null;

      const productInfo = productInfoMap.get(productId);
      const variant = variantId
        ? productInfo?.variants?.find(v => v.id === variantId)
        : productInfo?.variants?.find(v => v.sku?.toLowerCase() === sku);

      const effectivePrice =
        variant?.salePrice ?? productInfo?.salePrice ?? item.price ?? variant?.price ?? productInfo?.price ?? 0;

      return {
        orderId: internalOrderId,
        productId,
        sku: skuRaw,
        variantId,
        quantity,
        price: Number(effectivePrice),
        siteDiscount: 0,
        updatedAt: new Date(),
      };
    })
    .filter(Boolean) as any[];

  const allMatched = productCreates.length === items.length && items.length > 0;

  const order = await prisma.$transaction(async tx => {
    const numbering = await generateOrderNumber(tx, new Date());

    const logs: Array<{ title: string; description: string; user: string }> = [
      {
        title: 'Imported',
        description: `Order imported from ${integration.storeName} (${integration.platform})`,
        user: 'System',
      },
    ];

    const saved = await tx.order.create({
      data: {
        id: internalOrderId,
        customerName: name,
        customerEmail: email || undefined,
        customerPhone: customerRecord.phone,
        date: new Date(),
        status: allMatched ? 'New' : 'Draft',
        total,
        shipping: 0,
        discount: 0,
        customerNote: note || '',
        officeNote: '',
        businessId: integration.businessId,
        businessName: integration.business?.name || integration.storeName,
        platform: inferPlatformFromUrl(landingPage),
        channel: 'Retail',
        sourcePlatform: integration.platform,
        source: integration.platform,
        paymentMethod: mapPaymentMethod(paymentMethod) as any,
        paidAmount: 0,
        shippingAddress: shippingAddress as any,
        rawPayload: payload as any,
        updatedAt: new Date(),
        statusUpdatedAt: new Date(),
        ...numbering,
        OrderLog: {
          create: logs,
        },
      } as any,
    });

    await tx.orderProduct.deleteMany({ where: { orderId: internalOrderId } });
    if (productCreates.length) {
      await tx.orderProduct.createMany({ data: productCreates });
    }

    const settings = await getGeneralSettings();
    if (saved.status === 'New' && !saved.isStockReserved && settings.stockSyncMode === 'inventory') {
      const finalOrder = await tx.order.findUnique({
        where: { id: internalOrderId },
        include: {
          products: {
            include: {
              product: {
                include: {
                  Brand: { select: { id: true, name: true, type: true } },
                  variants: true,
                  comboItems: {
                    include: {
                      child: {
                        include: {
                          Brand: { select: { id: true, name: true, type: true } },
                          variants: true,
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      });
      if (finalOrder) {
        console.log('[STOCK_RESERVE] Creating reservation for API v1 order', internalOrderId);
        await handleStockReservation(tx, finalOrder, 'System');
        await tx.order.update({ where: { id: internalOrderId }, data: { isStockReserved: true } });
      }
    }

    return saved;
  });

  if (normalizedPhoneValue) {
    try {
      await prisma.wooCheckoutLead.updateMany({
        where: { status: 'OPEN', phoneNormalized: normalizedPhoneValue },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
    } catch { /* no-op */ }
  }

  if (order?.id) {
    tryAutoUtmAttribution({
      orderId: order.id,
      payload,
      integrationBusinessId: integration.businessId,
    }).catch(e => console.error('[GENERIC_UTM_ATTR_ERR]', e));
  }

  if (integration.callbackUrl && integration.apiKey) {
    try {
      const { pushGenericStatusUpdate } = await import('./integrations');
      pushGenericStatusUpdate({
        callbackUrl: integration.callbackUrl,
        externalOrderId,
        status: 'received',
        apiKey: integration.apiKey,
      }).catch((e: any) => console.error('[GENERIC_CALLBACK_ERR]', e));
    } catch (e) {
      console.error('[GENERIC_CALLBACK_IMPORT_ERR]', e);
    }
  }

  return { success: true, orderId: order.id };
}
