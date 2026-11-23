/**
 * Phase 9 P2 — reconcile recovery cap (normalize-order.ts constants).
 *
 * The old bound (20 pages × 50 = 1,000 orders/store/hour) could not
 * recover a one-hour webhook outage at lakhs/day, and it was the SOLE
 * safety net. New bound: 50 pages × 100 = 5,000 orders per store per
 * run, segmented (a progress item every 10 pages) with a continuation
 * run resuming from the exact page/cursor when the cap is hit (see
 * StoreOrderReconcileService). Page size 100 is the Woo `per_page`
 * maximum. These numbers are defensible, not final — the k6 load
 * test (follow-up) may move them.
 */
import {
  RECONCILE_MAX_ORDERS_PER_RUN,
  RECONCILE_MAX_PAGES,
  RECONCILE_PAGE_SIZE,
  RECONCILE_SEGMENT_PAGES,
} from '../normalize-order';

describe('reconcile recovery cap (Phase 9 P2)', () => {
  it('covers 5,000 orders per store per run (50 pages x 100)', () => {
    expect(RECONCILE_MAX_PAGES).toBe(50);
    expect(RECONCILE_PAGE_SIZE).toBe(100);
    expect(RECONCILE_MAX_ORDERS_PER_RUN).toBe(5000);
    expect(RECONCILE_MAX_ORDERS_PER_RUN).toBe(RECONCILE_MAX_PAGES * RECONCILE_PAGE_SIZE);
  });

  it('is 5x the old 1,000-order bound', () => {
    expect(RECONCILE_MAX_ORDERS_PER_RUN).toBe(5 * 1000);
  });

  it('segments evenly: the cap is a whole number of segments', () => {
    expect(RECONCILE_SEGMENT_PAGES).toBe(10);
    expect(RECONCILE_MAX_PAGES % RECONCILE_SEGMENT_PAGES).toBe(0);
    expect(RECONCILE_MAX_PAGES / RECONCILE_SEGMENT_PAGES).toBe(5);
  });

  it('segments at 1,000 orders each', () => {
    expect(RECONCILE_SEGMENT_PAGES * RECONCILE_PAGE_SIZE).toBe(1000);
  });
});
