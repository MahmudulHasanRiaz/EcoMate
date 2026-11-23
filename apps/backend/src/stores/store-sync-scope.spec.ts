/**
 * G-08/G-09 sync-scope reader — the ONE place that interprets
 * `autoSyncEnabled` + `settings.syncScope` (used by intake + processor).
 *
 * Defaults are the whole point: null/unset = enabled, so existing stores
 * keep today's behavior. Only an explicit boolean `false` disables.
 */
import { isOrderSyncAllowed, orderSyncSkipReason, readSyncScope } from './store-sync-scope';

describe('readSyncScope', () => {
  it('null / undefined / non-object settings → empty scope (all enabled)', () => {
    expect(readSyncScope(null)).toEqual({});
    expect(readSyncScope(undefined)).toEqual({});
    expect(readSyncScope('nope')).toEqual({});
    expect(readSyncScope(42)).toEqual({});
  });

  it('missing syncScope key → empty scope', () => {
    expect(readSyncScope({})).toEqual({});
    expect(readSyncScope({ initialSyncPolicy: 'x' })).toEqual({});
    expect(readSyncScope({ syncScope: null })).toEqual({});
    expect(readSyncScope({ syncScope: 'orders' })).toEqual({});
  });

  it('reads boolean flags, ignores non-boolean values', () => {
    expect(readSyncScope({ syncScope: { products: true, orders: false, stock: true } })).toEqual({
      products: true,
      orders: false,
      stock: true,
    });
    expect(readSyncScope({ syncScope: { orders: 'false', products: 0 } })).toEqual({});
  });
});

describe('orderSyncSkipReason', () => {
  it('null / missing store → null (callers fail open)', () => {
    expect(orderSyncSkipReason(null)).toBeNull();
    expect(orderSyncSkipReason(undefined)).toBeNull();
  });

  it('autoSyncEnabled false → AUTO_SYNC_DISABLED (wins over scope)', () => {
    expect(orderSyncSkipReason({ autoSyncEnabled: false })).toBe('AUTO_SYNC_DISABLED');
    expect(
      orderSyncSkipReason({ autoSyncEnabled: false, settings: { syncScope: { orders: false } } }),
    ).toBe('AUTO_SYNC_DISABLED');
  });

  it('autoSyncEnabled null / undefined / true → not disabled by the switch', () => {
    expect(orderSyncSkipReason({ autoSyncEnabled: null })).toBeNull();
    expect(orderSyncSkipReason({ autoSyncEnabled: undefined })).toBeNull();
    expect(orderSyncSkipReason({ autoSyncEnabled: true })).toBeNull();
    expect(orderSyncSkipReason({})).toBeNull();
  });

  it('syncScope.orders false → ORDER_SYNC_SCOPE_DISABLED (orders only)', () => {
    expect(orderSyncSkipReason({ settings: { syncScope: { orders: false } } })).toBe(
      'ORDER_SYNC_SCOPE_DISABLED',
    );
    expect(
      orderSyncSkipReason({ autoSyncEnabled: true, settings: { syncScope: { orders: false } } }),
    ).toBe('ORDER_SYNC_SCOPE_DISABLED');
  });

  it('other scopes off do NOT disable order sync', () => {
    expect(orderSyncSkipReason({ settings: { syncScope: { products: false } } })).toBeNull();
    expect(orderSyncSkipReason({ settings: { syncScope: { stock: false } } })).toBeNull();
    expect(
      orderSyncSkipReason({ settings: { syncScope: { products: false, stock: false } } }),
    ).toBeNull();
  });

  it('syncScope.orders true / unset → allowed', () => {
    expect(orderSyncSkipReason({ settings: { syncScope: { orders: true } } })).toBeNull();
    expect(orderSyncSkipReason({ settings: { syncScope: {} } })).toBeNull();
    expect(orderSyncSkipReason({ settings: {} })).toBeNull();
    expect(orderSyncSkipReason({ settings: null })).toBeNull();
  });
});

describe('isOrderSyncAllowed', () => {
  it('is the negation of orderSyncSkipReason', () => {
    expect(isOrderSyncAllowed({ autoSyncEnabled: false })).toBe(false);
    expect(isOrderSyncAllowed({ settings: { syncScope: { orders: false } } })).toBe(false);
    expect(isOrderSyncAllowed({ autoSyncEnabled: true })).toBe(true);
    expect(isOrderSyncAllowed({})).toBe(true);
    expect(isOrderSyncAllowed(null)).toBe(true);
  });
});
