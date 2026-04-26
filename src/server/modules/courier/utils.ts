import prisma from '@/lib/prisma';

/**
 * Resolves the correct order to update from a webhook.
 * If the order is "Partial", it redirects to the child return order.
 * child না পেলে main update স্কিপ + log
 */
export async function resolveWebhookTargetOrder(order: any, tx: any = prisma) {
  if (order.status !== 'Partial') return order;

  // Try finding child via parentOrderId
  let child = await tx.order.findFirst({
    where: { parentOrderId: order.id },
    include: {
      products: {
        include: {
          product: {
            include: {
              variants: true,
              comboItems: { include: { child: { include: { variants: true } } } }
            }
          }
        }
      }
    }
  });

  if (!child && order.orderNumber) {
    // Try finding child via orderNumber + '-R'
    child = await tx.order.findFirst({
      where: { orderNumber: order.orderNumber + '-R' },
      include: {
        products: {
          include: {
            product: {
              include: {
                variants: true,
                comboItems: { include: { child: { include: { variants: true } } } }
              }
            }
          }
        }
      }
    });
  }

  if (child) {
    console.info(`[WEBHOOK_REDIRECT] Parent ${order.orderNumber} is Partial. Redirecting to child ${child.orderNumber}`);
    return child;
  }

  console.warn(`[WEBHOOK_SKIP] Parent ${order.orderNumber} is Partial, but no child return order found.`);
  return null; // Signals skipping update
}
