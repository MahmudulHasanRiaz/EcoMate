/**
 * WooCommerce webhook status gate — webhook lifecycle fix, G-15 (J-08).
 *
 * ONE shared pure helper (`shouldImportWooEvent`) used by BOTH call sites:
 * webhook intake (`webhooks/store-webhook.service.ts`, cheap pre-filter)
 * and order ingest (`orders/store-order-ingest.service.ts`, authoritative).
 * The two sites can never disagree about what imports.
 *
 * Status sets (shared contract, from jannat `webhook-identity.ts`):
 * - creatable: pending, on-hold, processing
 * - trash: cancelled, refunded, failed, trash
 *
 * Decision matrix (new order = no `StoreOrderMapping` yet):
 * - Existing order + ANY status + ANY topic → RECONCILE — the
 *   existing-order path (mapping mirror refresh + honest SKIPPED item).
 *   NOTE (Boss decision 2026-11-24): reconcile NO LONGER applies the
 *   store's status to the EcoMate order — EcoMate is the source of
 *   truth, status flows EcoMate → store only (push service). A Woo
 *   cancellation does NOT move the EcoMate order to Cancelled; the
 *   old "reconcileStatus applies it" paragraph was removed with the
 *   turn-off, not merely reworded. (D-01/D-07 still hold in the
 *   routing sense: an existing order is never skipped at the gate —
 *   it always reaches the existing-order path.)
 * - New order + `order.deleted`/`order.trashed` → SKIP (nothing to
 *   reconcile; the order never existed here). Provider-agnostic.
 * - New order + create event (`order.created`) → IMPORT whatever status
 *   it carries — the missed-creation exception (J-08): a create event
 *   for an order never seen IS the creation. Importing a cancelled
 *   order as Cancelled is faithful; skipping loses the record entirely.
 *   NOTE: this follows the plan's exception rule ("non-creatable imports
 *   only when the order is missing AND the event is a create"); jannat's
 *   literal code skips created+trash — see BUILD-SUMMARY (C-gating).
 * - New order + non-create event + trash status → SKIP.
 * - New order + non-create event + creatable status → IMPORT.
 * - New order + non-create event + any OTHER status (e.g. `completed`,
 *   `checkout-draft`, custom) → SKIP (`unimportable`). Same rule as
 *   jannat. RECONCILE CARVE-OUT (coordinator decision, fix-round-1): the
 *   reconcile service bypasses this gate via
 *   `IngestOptions.bypassStatusGate` — reconcile exists to recover missed
 *   real orders, so a `completed` order missed during an outage imports
 *   instead of skipping. Webhook intake/ingest keep the gate; this helper
 *   itself is unchanged (the bypass lives in `ingest()`, not here).
 *
 * The gate is WOO-ONLY. Other providers' status vocabularies are not in
 * these sets (Shopify `financial_status` values like `paid` /
 * `partially_paid` are neither creatable nor trash) — applying the Woo
 * sets to them would drop genuine orders. Non-Woo (or unknown-provider)
 * events always import (fail open = today's behavior).
 *
 * The zero-stock reject rule (P13) is NOT part of this gate and is
 * untouched: a creatable order still rejects when ERP stock is zero.
 */

export const WOO_CREATABLE_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'on-hold',
  'processing',
]);

export const WOO_TRASH_STATUSES: ReadonlySet<string> = new Set([
  'cancelled',
  'refunded',
  'failed',
  'trash',
]);

export type WooTopicKind = 'created' | 'updated' | 'deleted' | 'other';

/**
 * Classify a webhook topic. Woo topics are `order.created` /
 * `order.updated` / `order.deleted` / `order.trashed`; Shopify topics are
 * `orders/create` / `orders/updated` / `orders/delete`. Anything else
 * (including a missing topic, e.g. reconcile/manual ingest) is `other`.
 */
export function wooTopicKind(topic: string | null | undefined): WooTopicKind {
  const t = (topic ?? '').toLowerCase().trim();
  if (t === 'order.created' || t === 'orders/create' || t === 'created') return 'created';
  if (t === 'order.updated' || t === 'orders/updated' || t === 'updated') return 'updated';
  if (
    t === 'order.deleted' ||
    t === 'order.trashed' ||
    t === 'orders/delete' ||
    t === 'deleted' ||
    t === 'trashed'
  ) {
    return 'deleted';
  }
  return 'other';
}

/** True when the topic is an order-deletion event (reconcile-to-cancelled). */
export function isOrderDeleteTopic(topic: string | null | undefined): boolean {
  return wooTopicKind(topic) === 'deleted';
}

export type WooImportAction = 'import' | 'skip' | 'reconcile';

export interface ShouldImportWooEventInput {
  /** Webhook topic, e.g. `order.created`. Absent for reconcile/manual. */
  topic?: string | null;
  /** Raw external status string from the normalized payload. */
  externalStatus: string;
  /** Whether a `StoreOrderMapping` already exists for this order. */
  orderExists: boolean;
  /**
   * Provider slug (`woocommerce` | `shopify` | `custom`). When absent the
   * provider is inferred from the topic shape (`order.*` → Woo,
   * `orders/*` → Shopify); when neither is known the gate does not apply
   * (fail open → import).
   */
  provider?: string | null;
}

export interface WooImportDecision {
  action: WooImportAction;
  /** Stable reason string, recorded on the run item / log line. */
  reason: string;
}

function isWooProvider(provider: string | null | undefined, topic: string | null | undefined): boolean {
  if (provider) return provider.toLowerCase() === 'woocommerce';
  const t = (topic ?? '').toLowerCase().trim();
  if (t.startsWith('order.')) return true;
  // `orders/*` is Shopify-shaped; anything else is unknown → not Woo.
  return false;
}

export function shouldImportWooEvent(input: ShouldImportWooEventInput): WooImportDecision {
  const s = String(input.externalStatus ?? '').toLowerCase().trim();
  const kind = wooTopicKind(input.topic);

  // D-01/D-07: an existing order is NEVER skipped — it always routes to
  // the existing-order path (mapping mirror refresh + SKIPPED item; the
  // store's status is NOT applied — EcoMate is the source of truth,
  // Boss 2026-11-24). This branch is provider-agnostic: it is today's
  // behavior for every provider, preserved exactly.
  if (input.orderExists) {
    return { action: 'reconcile', reason: `existing-${s || 'unknown'}` };
  }

  // A delete event for an order we never saw: nothing to reconcile and
  // nothing to import. Provider-agnostic (a delete is never an import).
  if (kind === 'deleted') {
    return { action: 'skip', reason: 'deleted-unknown-order' };
  }

  // Woo-only gate from here down: other providers' status vocabularies
  // (e.g. Shopify `paid`) are not in these sets — fail open (import).
  if (!isWooProvider(input.provider, input.topic)) {
    return { action: 'import', reason: 'non-woo-provider' };
  }

  // Missed-creation exception (J-08): a create event for a never-seen
  // order imports whatever status it carries — creatable, trash, or
  // anything else. The create event itself is the missed creation.
  if (kind === 'created') {
    if (WOO_TRASH_STATUSES.has(s)) {
      return { action: 'import', reason: `missed-creation-${s}` };
    }
    return { action: 'import', reason: `created-${s}` };
  }

  if (WOO_TRASH_STATUSES.has(s)) {
    return { action: 'skip', reason: `trash-status=${s}` };
  }
  if (WOO_CREATABLE_STATUSES.has(s)) {
    return { action: 'import', reason: `creatable-${s}` };
  }
  return { action: 'skip', reason: `unimportable=${s}` };
}
