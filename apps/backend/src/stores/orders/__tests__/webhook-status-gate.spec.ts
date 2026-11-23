/**
 * G-15 status-gate matrix — `shouldImportWooEvent` (J-08, keeping our
 * reconcile). Every status × new/existing × topic kind.
 *
 * Rules under test:
 * - Existing order + ANY status + ANY topic → RECONCILE (D-01/D-07:
 *   never skip an existing order — jannat's no-op is NOT copied).
 * - New + create event → IMPORT whatever the status (missed-creation
 *   exception: the create event for a never-seen order IS the creation).
 * - New + non-create event + trash → SKIP.
 * - New + non-create event + creatable → IMPORT.
 * - New + non-create event + other status (completed, …) → SKIP.
 * - New + delete event → SKIP (nothing to reconcile).
 * - Non-Woo provider (or unknown provider/topic) → IMPORT (fail open).
 */
import {
  WOO_CREATABLE_STATUSES,
  WOO_TRASH_STATUSES,
  isOrderDeleteTopic,
  shouldImportWooEvent,
  wooTopicKind,
} from '../webhook-status-gate';

const CREATABLE = ['pending', 'on-hold', 'processing'];
const TRASH = ['cancelled', 'refunded', 'failed', 'trash'];
const OTHER = ['completed', 'checkout-draft', 'custom-status'];
const ALL_STATUSES = [...CREATABLE, ...TRASH, ...OTHER];

describe('webhook status gate — status sets (shared contract)', () => {
  it('creatable set is exactly {pending, on-hold, processing}', () => {
    expect([...WOO_CREATABLE_STATUSES].sort()).toEqual(['on-hold', 'pending', 'processing']);
  });

  it('trash set is exactly {cancelled, refunded, failed, trash}', () => {
    expect([...WOO_TRASH_STATUSES].sort()).toEqual(['cancelled', 'failed', 'refunded', 'trash']);
  });
});

describe('webhook status gate — topic classification', () => {
  it.each([
    ['order.created', 'created'],
    ['orders/create', 'created'],
    ['created', 'created'],
    ['ORDER.CREATED', 'created'],
    ['order.updated', 'updated'],
    ['orders/updated', 'updated'],
    ['updated', 'updated'],
    ['order.deleted', 'deleted'],
    ['order.trashed', 'deleted'],
    ['orders/delete', 'deleted'],
    ['deleted', 'deleted'],
    ['trashed', 'deleted'],
    ['product.updated', 'other'],
    ['', 'other'],
    [undefined, 'other'],
    [null, 'other'],
  ])('wooTopicKind(%s) = %s', (topic, expected) => {
    expect(wooTopicKind(topic as any)).toBe(expected);
  });

  it('isOrderDeleteTopic is true only for delete/trashed topics', () => {
    expect(isOrderDeleteTopic('order.deleted')).toBe(true);
    expect(isOrderDeleteTopic('order.trashed')).toBe(true);
    expect(isOrderDeleteTopic('orders/delete')).toBe(true);
    expect(isOrderDeleteTopic('order.created')).toBe(false);
    expect(isOrderDeleteTopic('order.updated')).toBe(false);
    expect(isOrderDeleteTopic(undefined)).toBe(false);
  });
});

describe('webhook status gate — EXISTING orders always reconcile (D-01/D-07)', () => {
  it.each(
    ALL_STATUSES.flatMap((status) =>
      (['order.created', 'order.updated', 'order.deleted', undefined] as const).map((topic) => ({
        status,
        topic,
      })),
    ),
  )('existing + status=$status + topic=$topic → reconcile', ({ status, topic }) => {
    expect(
      shouldImportWooEvent({ topic, externalStatus: status, orderExists: true, provider: 'woocommerce' }),
    ).toMatchObject({ action: 'reconcile' });
  });

  it('existing + trash status via order.updated still reconciles (never a route-level skip)', () => {
    for (const status of TRASH) {
      expect(
        shouldImportWooEvent({ topic: 'order.updated', externalStatus: status, orderExists: true, provider: 'woocommerce' }),
      ).toMatchObject({ action: 'reconcile', reason: `existing-${status}` });
    }
  });
});

describe('webhook status gate — NEW orders, create events (missed-creation exception)', () => {
  it.each(CREATABLE)('new + order.created + creatable %s → import', (status) => {
    expect(
      shouldImportWooEvent({ topic: 'order.created', externalStatus: status, orderExists: false, provider: 'woocommerce' }),
    ).toMatchObject({ action: 'import', reason: `created-${status}` });
  });

  it.each(TRASH)('new + order.created + trash %s → IMPORT (missed-creation exception)', (status) => {
    expect(
      shouldImportWooEvent({ topic: 'order.created', externalStatus: status, orderExists: false, provider: 'woocommerce' }),
    ).toMatchObject({ action: 'import', reason: `missed-creation-${status}` });
  });

  it.each(OTHER)('new + order.created + other status %s → import (create event is the creation)', (status) => {
    expect(
      shouldImportWooEvent({ topic: 'order.created', externalStatus: status, orderExists: false, provider: 'woocommerce' }),
    ).toMatchObject({ action: 'import' });
  });
});

describe('webhook status gate — NEW orders, updated/other events', () => {
  it.each(CREATABLE)('new + order.updated + creatable %s → import', (status) => {
    expect(
      shouldImportWooEvent({ topic: 'order.updated', externalStatus: status, orderExists: false, provider: 'woocommerce' }),
    ).toMatchObject({ action: 'import', reason: `creatable-${status}` });
  });

  it.each(TRASH)('new + order.updated + trash %s → skip', (status) => {
    expect(
      shouldImportWooEvent({ topic: 'order.updated', externalStatus: status, orderExists: false, provider: 'woocommerce' }),
    ).toMatchObject({ action: 'skip', reason: `trash-status=${status}` });
  });

  it.each(OTHER)('new + order.updated + other status %s → skip (unimportable)', (status) => {
    expect(
      shouldImportWooEvent({ topic: 'order.updated', externalStatus: status, orderExists: false, provider: 'woocommerce' }),
    ).toMatchObject({ action: 'skip', reason: `unimportable=${status}` });
  });

  it('new + no topic (reconcile/manual) follows the updated branch', () => {
    expect(
      shouldImportWooEvent({ externalStatus: 'processing', orderExists: false, provider: 'woocommerce' }),
    ).toMatchObject({ action: 'import' });
    expect(
      shouldImportWooEvent({ externalStatus: 'cancelled', orderExists: false, provider: 'woocommerce' }),
    ).toMatchObject({ action: 'skip', reason: 'trash-status=cancelled' });
    expect(
      shouldImportWooEvent({ externalStatus: 'completed', orderExists: false, provider: 'woocommerce' }),
    ).toMatchObject({ action: 'skip', reason: 'unimportable=completed' });
  });

  it('status matching is case-insensitive and trims whitespace', () => {
    expect(
      shouldImportWooEvent({ topic: 'order.updated', externalStatus: ' Cancelled ', orderExists: false, provider: 'woocommerce' }),
    ).toMatchObject({ action: 'skip' });
    expect(
      shouldImportWooEvent({ topic: 'order.updated', externalStatus: 'PROCESSING', orderExists: false, provider: 'woocommerce' }),
    ).toMatchObject({ action: 'import' });
  });
});

describe('webhook status gate — NEW orders, delete events', () => {
  it.each(['order.deleted', 'order.trashed'])('new + %s → skip (nothing to reconcile)', (topic) => {
    for (const status of ALL_STATUSES) {
      expect(
        shouldImportWooEvent({ topic, externalStatus: status, orderExists: false, provider: 'woocommerce' }),
      ).toMatchObject({ action: 'skip', reason: 'deleted-unknown-order' });
    }
  });

  it('delete-topic skip is provider-agnostic (a delete is never an import)', () => {
    expect(
      shouldImportWooEvent({ topic: 'orders/delete', externalStatus: 'processing', orderExists: false, provider: 'shopify' }),
    ).toMatchObject({ action: 'skip', reason: 'deleted-unknown-order' });
  });
});

describe('webhook status gate — non-Woo providers fail open', () => {
  it.each(['shopify', 'custom', 'SHOPIFY'])(
    'new + provider %s + trash status → import (gate is Woo-only)',
    (provider) => {
      for (const status of TRASH) {
        expect(
          shouldImportWooEvent({ topic: 'orders/updated', externalStatus: status, orderExists: false, provider }),
        ).toMatchObject({ action: 'import', reason: 'non-woo-provider' });
      }
    },
  );

  it('Shopify financial_status `paid` (neither creatable nor trash) imports', () => {
    expect(
      shouldImportWooEvent({ topic: 'orders/updated', externalStatus: 'paid', orderExists: false, provider: 'shopify' }),
    ).toMatchObject({ action: 'import' });
  });

  it('unknown provider + unknown topic → import (fail open = today’s behavior)', () => {
    expect(
      shouldImportWooEvent({ externalStatus: 'cancelled', orderExists: false }),
    ).toMatchObject({ action: 'import', reason: 'non-woo-provider' });
  });

  it('unknown provider + Woo-shaped topic infers Woo and gates', () => {
    expect(
      shouldImportWooEvent({ topic: 'order.updated', externalStatus: 'cancelled', orderExists: false }),
    ).toMatchObject({ action: 'skip', reason: 'trash-status=cancelled' });
    expect(
      shouldImportWooEvent({ topic: 'order.updated', externalStatus: 'processing', orderExists: false }),
    ).toMatchObject({ action: 'import' });
  });
});
