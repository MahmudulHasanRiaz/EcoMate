/**
 * Strict blocking (design §9) — pure resolution.
 *
 * The platform computes `blockedAreas` per tenant at registry-build time
 * from (subscription status, graceEndsAt, effective blocking config) and
 * ships it in the registry record. The backend does not compute billing
 * state — it enforces what the registry says.
 *
 * Resolution: tenant override > plan `blocking` block > platform default
 * (grace_then_block, areas [] — today's behaviour: nothing area-blocked).
 */
import {
  BlockingArea,
  BlockingConfig,
  BlockingMode,
} from './pricing-document';

/** Platform default: nothing area-blocked (today's behaviour). */
export const DEFAULT_BLOCKING: BlockingConfig = {
  mode: 'grace_then_block',
  blockedAreas: [],
};

/** Plain-language labels for the 403 message + tenant plan page. */
export const BLOCKING_AREA_LABELS: Record<BlockingArea, string> = {
  orders: 'order creation',
  pos: 'POS sales',
  storefront_checkout: 'storefront checkout',
  products: 'product creation',
  admin_writes: 'workspace changes',
};

export function resolveBlockingConfig(input: {
  planBlocking?: BlockingConfig | null;
  override?: { mode: string; blockedAreas: string[] } | null;
}): BlockingConfig {
  if (input.override) {
    return {
      mode: (input.override.mode === 'block_immediately'
        ? 'block_immediately'
        : 'grace_then_block') as BlockingMode,
      blockedAreas: (input.override.blockedAreas ?? []).filter(
        (area): area is BlockingArea =>
          (Object.keys(BLOCKING_AREA_LABELS) as string[]).includes(area),
      ),
    };
  }
  if (input.planBlocking) {
    return {
      mode: input.planBlocking.mode,
      blockedAreas: [...input.planBlocking.blockedAreas],
    };
  }
  return { ...DEFAULT_BLOCKING, blockedAreas: [] };
}

/**
 * The areas actually blocked right now for a tenant.
 *
 * - Not PAST_DUE → nothing blocked (ACTIVE/TRIAL tenants are never
 *   area-blocked; SUSPENDED tenants are blocked wholesale by the guard's
 *   access-state check, so the area list is moot there).
 * - block_immediately → blocked the moment the tenant is PAST_DUE.
 * - grace_then_block → blocked only after graceEndsAt. A PAST_DUE tenant
 *   with no graceEndsAt set has no grace window to honour — blocked.
 */
export function resolveBlockedAreas(input: {
  subscriptionStatus?: string | null;
  tenantStatus?: string | null;
  graceEndsAt?: Date | string | null;
  config: BlockingConfig;
  now?: Date;
}): BlockingArea[] {
  const isPastDue =
    String(input.subscriptionStatus ?? '').toUpperCase() === 'PAST_DUE' ||
    String(input.tenantStatus ?? '').toUpperCase() === 'PAST_DUE';
  if (!isPastDue) return [];
  if (input.config.blockedAreas.length === 0) return [];

  if (input.config.mode === 'block_immediately') {
    return [...input.config.blockedAreas];
  }
  const now = input.now ?? new Date();
  if (!input.graceEndsAt) return [...input.config.blockedAreas];
  const graceEnd = new Date(input.graceEndsAt);
  if (Number.isNaN(graceEnd.getTime())) return [...input.config.blockedAreas];
  return now > graceEnd ? [...input.config.blockedAreas] : [];
}
