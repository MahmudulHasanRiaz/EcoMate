import { SetMetadata } from '@nestjs/common';

export const BILLING_AREA_KEY = 'billing_area';

/**
 * Declares the strict-blocking area(s) a route belongs to (pricing §9).
 * The TenantSubscriptionGuard blocks non-read requests when any declared
 * area is in the registry's blockedAreas for the tenant.
 *
 * A route may declare several areas when one endpoint serves several
 * flows: POST /orders serves both admin order creation AND storefront
 * checkout (the same endpoint), so it declares both 'orders' and
 * 'storefront_checkout' — blocking either area blocks the shared
 * endpoint. Reads are never area-blocked.
 */
export const BillingArea = (...areas: string[]) =>
  SetMetadata(BILLING_AREA_KEY, areas);
