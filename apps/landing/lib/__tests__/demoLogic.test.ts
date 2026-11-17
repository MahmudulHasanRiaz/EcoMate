import { describe, expect, it } from 'vitest';
import {
  allStoresSynced,
  canBook,
  confirmBooking,
  initialBookingState,
  initialPackingState,
  isPackingComplete,
  parseDemoAmount,
  protectionTotal,
  scanPackingItem,
  selectCourier,
  toggleId,
  toggleStore,
} from '../demoLogic';

describe('packing-scan demo (lib/demoLogic.ts)', () => {
  it('starts empty and incomplete', () => {
    const state = initialPackingState();
    expect(state.scanned).toEqual([]);
    expect(state.blocked).toBe(false);
    expect(isPackingComplete(state, 2)).toBe(false);
  });

  it('scanning in order advances and clears the block flag', () => {
    let state = scanPackingItem(initialPackingState(), 5, 2);
    expect(state.blocked).toBe(true);
    expect(state.scanned).toEqual([]);

    state = scanPackingItem(state, 0, 2);
    expect(state).toEqual({ scanned: [0], blocked: false });

    state = scanPackingItem(state, 1, 2);
    expect(isPackingComplete(state, 2)).toBe(true);
  });

  it('scanning past completion is a no-op (same reference)', () => {
    const done = { scanned: [0, 1], blocked: false };
    expect(scanPackingItem(done, 0, 2)).toBe(done);
  });
});

describe('revenue-protection toggles (lib/demoLogic.ts)', () => {
  it('parses Latin and Bangla digit display amounts', () => {
    expect(parseDemoAmount('৳ 86,000')).toBe(86000);
    expect(parseDemoAmount('৳ ৮৬,০০০')).toBe(86000);
    expect(parseDemoAmount('n/a')).toBe(0);
  });

  it('totals only the enabled policies', () => {
    const policies = [
      { id: 'barcode', monthlySavings: '৳ 86,000' },
      { id: 'fraud', monthlySavings: '৳ 54,000' },
      { id: 'cod', monthlySavings: '৳ 38,000' },
    ];
    expect(protectionTotal(policies, ['barcode', 'fraud', 'cod'])).toBe(178000);
    expect(protectionTotal(policies, ['cod'])).toBe(38000);
    expect(protectionTotal(policies, [])).toBe(0);
  });

  it('toggleId adds and removes symmetrically', () => {
    expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('courier booking demo (lib/demoLogic.ts)', () => {
  it('requires a selection before booking, and booking locks the flow', () => {
    let state = initialBookingState();
    expect(canBook(state)).toBe(false);
    expect(confirmBooking(state)).toBe(state);

    state = selectCourier(state, 'steadfast');
    expect(canBook(state)).toBe(true);

    state = confirmBooking(state);
    expect(state.booked).toBe(true);
    expect(canBook(state)).toBe(false);
  });

  it('selecting after booking restarts the flow', () => {
    const booked = { selectedId: 'steadfast', booked: true };
    expect(selectCourier(booked, 'pathao')).toEqual({ selectedId: 'pathao', booked: false });
  });
});

describe('store sync switches (lib/demoLogic.ts)', () => {
  it('all-synced holds only with zero paused stores', () => {
    expect(allStoresSynced([])).toBe(true);
    const paused = toggleStore([], 'woo');
    expect(allStoresSynced(paused)).toBe(false);
    expect(toggleStore(paused, 'woo')).toEqual([]);
  });
});
