import { addInterval, wholeDaysBetween } from './billing-dates';

describe('addInterval', () => {
  it('adds one calendar month', () => {
    expect(
      addInterval(new Date('2026-11-16T10:00:00.000Z'), 'MONTHLY', null),
    ).toEqual(new Date('2026-12-16T10:00:00.000Z'));
  });

  it('clamps Jan 31 to Feb 28 instead of rolling into March', () => {
    expect(
      addInterval(new Date('2026-01-31T00:00:00.000Z'), 'MONTHLY', null),
    ).toEqual(new Date('2026-02-28T00:00:00.000Z'));
  });

  it('adds twelve months for yearly', () => {
    expect(
      addInterval(new Date('2024-02-29T00:00:00.000Z'), 'YEARLY', null),
    ).toEqual(new Date('2025-02-28T00:00:00.000Z'));
  });

  it('uses intervalDays for custom intervals', () => {
    expect(
      addInterval(new Date('2026-11-16T00:00:00.000Z'), 'CUSTOM', 45),
    ).toEqual(new Date('2026-12-31T00:00:00.000Z'));
  });

  it('defaults a custom interval without days to 30', () => {
    expect(
      addInterval(new Date('2026-11-16T00:00:00.000Z'), 'CUSTOM', null),
    ).toEqual(new Date('2026-12-16T00:00:00.000Z'));
  });
});

describe('wholeDaysBetween', () => {
  it('counts whole days, rounding down', () => {
    expect(
      wholeDaysBetween(
        new Date('2026-11-16T10:00:00.000Z'),
        new Date('2026-11-18T09:00:00.000Z'),
      ),
    ).toBe(1);
  });

  it('never goes negative', () => {
    expect(
      wholeDaysBetween(
        new Date('2026-11-18T00:00:00.000Z'),
        new Date('2026-11-16T00:00:00.000Z'),
      ),
    ).toBe(0);
  });
});
