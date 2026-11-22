import {
  describeLimits,
  formatDhakaDate,
  mergePlanLimitsWithOverrides,
  usagePercent,
} from './usage.limits';

describe('usage limit helpers', () => {
  it('merges a tenant override over the plan value', () => {
    expect(
      mergePlanLimitsWithOverrides(
        { products: 100, staff_users: 5 },
        [{ key: 'products', value: 250 }],
      ),
    ).toEqual({ products: 250, staff_users: 5 });
  });

  it('keeps unknown plan keys untouched and ignores unknown override keys', () => {
    expect(
      mergePlanLimitsWithOverrides(
        { products: 100, future_limit: 7 },
        [
          { key: 'products', value: 250 },
          { key: 'seats', value: 3 },
        ],
      ),
    ).toEqual({ products: 250, future_limit: 7 });
  });

  it('ignores an invalid override instead of locking the tenant out', () => {
    expect(
      mergePlanLimitsWithOverrides({ products: 100 }, [
        { key: 'products', value: Number.NaN },
      ]),
    ).toEqual({ products: 100 });
  });

  it('treats a non-object plan payload as empty', () => {
    expect(mergePlanLimitsWithOverrides(null, [])).toEqual({});
    expect(mergePlanLimitsWithOverrides(['x'], [])).toEqual({});
  });

  it('describes plan, override and effective values per catalogue key', () => {
    expect(
      describeLimits({ products: 100, staff_users: 5 }, [
        { key: 'products', value: 250, note: 'negotiated' },
      ]),
    ).toEqual([
      {
        key: 'products',
        label: 'Products',
        planLimit: 100,
        override: 250,
        limit: 250,
      },
      {
        key: 'staff_users',
        label: 'Staff users',
        planLimit: 5,
        override: null,
        limit: 5,
      },
      {
        key: 'orders_per_month',
        label: 'Orders per month',
        planLimit: null,
        override: null,
        limit: null,
      },
      {
        key: 'storage_mb',
        label: 'Media storage (MB)',
        planLimit: null,
        override: null,
        limit: null,
      },
      {
        key: 'external_stores',
        label: 'External stores',
        planLimit: null,
        override: null,
        limit: null,
      },
    ]);
  });

  it('restores the plan value when the override is cleared', () => {
    const rows = describeLimits({ products: 100 }, []);
    expect(rows[0]).toMatchObject({
      planLimit: 100,
      override: null,
      limit: 100,
    });
  });

  it('reports null percent when usage or the limit is unknown', () => {
    expect(usagePercent(null, 10)).toBeNull();
    expect(usagePercent(5, null)).toBeNull();
  });

  it('reports 0/100 percent for a zero limit', () => {
    expect(usagePercent(0, 0)).toBe(0);
    expect(usagePercent(2, 0)).toBe(100);
  });

  it('lets an over-limit percent exceed 100 so the dashboard can flag it', () => {
    expect(usagePercent(15, 10)).toBe(150);
    expect(usagePercent(4, 10)).toBe(40);
  });

  it('formats a Dhaka calendar day, not the UTC day', () => {
    // 18:30 UTC is already the next day in Dhaka (UTC+6).
    expect(formatDhakaDate(new Date('2026-11-16T18:30:00.000Z'))).toBe(
      '2026-11-17',
    );
    expect(formatDhakaDate(new Date('2026-11-16T10:00:00.000Z'))).toBe(
      '2026-11-16',
    );
  });
});
