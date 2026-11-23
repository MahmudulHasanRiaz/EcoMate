import { ORDER_TRANSITIONS, findOrderTransitionPath } from './order-transitions';

/**
 * E (owner-locked): Recall / No Response — the call-center PRE-CONFIRMATION
 * pair. Free movement inside the pre-confirmation group; the normal
 * Confirmed/Cancelled exits; never reachable once the order is Confirmed.
 * This spec pins the CANONICAL map (the DB nextStatuses rows are seeded from
 * it; the admin copy mirrors it).
 */
describe('ORDER_TRANSITIONS — Recall / No Response (E)', () => {
  const PRE_CONFIRMATION = [
    'Pending',
    'Payment Pending',
    'Payment Verifying',
    'Recall',
    'No Response',
  ];

  it.each([...PRE_CONFIRMATION, 'Hold'])(
    '%s can step into Recall and No Response',
    (from) => {
      if (from !== 'Recall') {
        expect(ORDER_TRANSITIONS[from]).toContain('Recall');
      }
      if (from !== 'No Response') {
        expect(ORDER_TRANSITIONS[from]).toContain('No Response');
      }
      expect(ORDER_TRANSITIONS[from].length).toBeGreaterThan(0);
    },
  );

  it.each(['Pending', 'Payment Pending', 'Payment Verifying', 'Hold'])(
    'Recall can step back to %s',
    (to) => {
      expect(ORDER_TRANSITIONS['Recall']).toContain(to);
    },
  );

  it.each(['Pending', 'Payment Pending', 'Payment Verifying', 'Hold'])(
    'No Response can step back to %s',
    (to) => {
      expect(ORDER_TRANSITIONS['No Response']).toContain(to);
    },
  );

  it('Recall ↔ No Response is bidirectional', () => {
    expect(ORDER_TRANSITIONS['Recall']).toContain('No Response');
    expect(ORDER_TRANSITIONS['No Response']).toContain('Recall');
  });

  it('pre-existing pre-confirmation edges are retained', () => {
    expect(ORDER_TRANSITIONS['Pending']).toContain('Payment Pending');
    expect(ORDER_TRANSITIONS['Payment Pending']).toContain('Payment Verifying');
    expect(ORDER_TRANSITIONS['Payment Verifying']).toContain('Confirmed');
  });

  it.each([...PRE_CONFIRMATION, 'Hold'])(
    '%s exits to Confirmed and Cancelled',
    (from) => {
      expect(ORDER_TRANSITIONS[from]).toContain('Confirmed');
      expect(ORDER_TRANSITIONS[from]).toContain('Cancelled');
    },
  );

  it('Hold (pause) can also step into Recall / No Response', () => {
    expect(ORDER_TRANSITIONS['Hold']).toContain('Recall');
    expect(ORDER_TRANSITIONS['Hold']).toContain('No Response');
  });

  it.each([
    'Confirmed',
    'Packed',
    'Packing Hold',
    'Shipping',
    'Delivered',
    'Partial',
    'Return Pending',
    'Returned',
    'Damaged',
  ])('%s can never go back to Recall / No Response', (from) => {
    expect(ORDER_TRANSITIONS[from] ?? []).not.toContain('Recall');
    expect(ORDER_TRANSITIONS[from] ?? []).not.toContain('No Response');
  });

  it('Recall / No Response are not initial statuses and are not final', () => {
    expect(ORDER_TRANSITIONS['Recall']).toBeDefined();
    expect(ORDER_TRANSITIONS['No Response']).toBeDefined();
    expect(ORDER_TRANSITIONS['Recall']).not.toHaveLength(0);
    expect(ORDER_TRANSITIONS['No Response']).not.toHaveLength(0);
  });

  it('no unknown targets anywhere in the map (typo guard)', () => {
    const known = new Set(Object.keys(ORDER_TRANSITIONS));
    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS)) {
      for (const to of targets) {
        expect(known.has(to)).toBe(true);
        expect(from).not.toBe(to);
      }
    }
  });
});

describe('ORDER_TRANSITIONS — Confirmed → Delivered (Boss directive 2026-11-23)', () => {
  it('Confirmed can step directly to Delivered (Woo Completed)', () => {
    expect(ORDER_TRANSITIONS['Confirmed']).toContain('Delivered');
  });

  it('Confirmed keeps Hold (Woo on-hold regression)', () => {
    expect(ORDER_TRANSITIONS['Confirmed']).toContain('Hold');
  });

  it('Partial → Delivered stays removed (owner-locked 15.4)', () => {
    expect(ORDER_TRANSITIONS['Partial']).not.toContain('Delivered');
  });
});

describe('findOrderTransitionPath', () => {
  it('direct edge returns one hop', () => {
    expect(findOrderTransitionPath('Confirmed', 'Delivered')).toEqual(['Delivered']);
    expect(findOrderTransitionPath('Confirmed', 'Hold')).toEqual(['Hold']);
  });

  it('multi-hop paths walk forward', () => {
    expect(findOrderTransitionPath('Packed', 'Delivered')).toEqual(['Shipping', 'Delivered']);
    expect(findOrderTransitionPath('Hold', 'Delivered')).toEqual(['Confirmed', 'Delivered']);
    expect(findOrderTransitionPath('Pending', 'Delivered')).toEqual(['Confirmed', 'Delivered']);
    expect(findOrderTransitionPath('Packing Hold', 'Delivered')).toEqual(['Packed', 'Shipping', 'Delivered']);
    expect(findOrderTransitionPath('Confirmed', 'Shipping')).toEqual(['Packed', 'Shipping']);
  });

  it('no path returns [] (backward / dead / same)', () => {
    expect(findOrderTransitionPath('Delivered', 'Confirmed')).toEqual([]);
    expect(findOrderTransitionPath('Partial', 'Delivered')).toEqual([]);
    expect(findOrderTransitionPath('Damaged', 'Delivered')).toEqual([]);
    expect(findOrderTransitionPath('Confirmed', 'Confirmed')).toEqual([]);
  });
});
