/**
 * Store auto-sync / sync-scope reader — webhook lifecycle fix, G-08/G-09.
 *
 * THE single place that interprets `Store.autoSyncEnabled` +
 * `Store.settings.syncScope`. Both gating layers (webhook intake in
 * `webhooks/store-webhook.service.ts` and the ingest processor in
 * `sync/sync.processors.ts`) call `orderSyncSkipReason()` here so the two
 * layers can never disagree about what "off" means.
 *
 * Semantics (plan §C):
 * - `autoSyncEnabled === false` → order sync is OFF for the store.
 * - `settings.syncScope.orders === false` → order sync is OFF (orders
 *   only; product/stock scopes are not consulted by the order path).
 * - DEFAULT: null / unset / any non-`false` value = ENABLED. Existing
 *   stores (whose rows predate these settings) keep today's behavior.
 *
 * `syncScope` was write-only before this fix (zero readers in
 * `apps/backend`): the connect wizard persisted the toggles and nothing
 * ever consulted them. `autoSyncEnabled` was read only by the reconcile
 * tick and the stock audit — never by webhook intake or ingest.
 */

export interface StoreSyncScope {
  products?: boolean;
  orders?: boolean;
  stock?: boolean;
}

export type OrderSyncSkipReason = 'AUTO_SYNC_DISABLED' | 'ORDER_SYNC_SCOPE_DISABLED';

/**
 * Parse `settings.syncScope` tolerantly. Non-object settings, a missing
 * scope, or non-boolean values all yield "unset" for that key (which the
 * caller treats as enabled). Only an explicit boolean `false` disables.
 */
export function readSyncScope(settings: unknown): StoreSyncScope {
  if (!settings || typeof settings !== 'object') return {};
  const scope = (settings as Record<string, unknown>).syncScope;
  if (!scope || typeof scope !== 'object') return {};
  const s = scope as Record<string, unknown>;
  const out: StoreSyncScope = {};
  if (typeof s.products === 'boolean') out.products = s.products;
  if (typeof s.orders === 'boolean') out.orders = s.orders;
  if (typeof s.stock === 'boolean') out.stock = s.stock;
  return out;
}

/**
 * Why order sync is off for this store, or `null` when it is allowed.
 * `autoSyncEnabled === false` wins over the scope (it is the master
 * switch); a `null`/missing store is "allowed" — callers fail open so a
 * lookup failure can never suppress orders (see the processor gate).
 */
export function orderSyncSkipReason(
  store: { autoSyncEnabled?: boolean | null; settings?: unknown } | null | undefined,
): OrderSyncSkipReason | null {
  if (!store) return null;
  if (store.autoSyncEnabled === false) return 'AUTO_SYNC_DISABLED';
  if (readSyncScope(store.settings).orders === false) return 'ORDER_SYNC_SCOPE_DISABLED';
  return null;
}

/** True when webhook/reconcile order ingest is allowed for this store. */
export function isOrderSyncAllowed(
  store: { autoSyncEnabled?: boolean | null; settings?: unknown } | null | undefined,
): boolean {
  return orderSyncSkipReason(store) === null;
}
