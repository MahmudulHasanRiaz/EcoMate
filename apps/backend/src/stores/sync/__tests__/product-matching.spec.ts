/**
 * Product matching tiers (§16) — WooCommerce product import.
 *
 * Pure comparison helpers: SKU normalization (hyphens significant),
 * bigram-Dice name similarity, and the top-2 high-threshold candidate
 * ranking.
 */
import {
  MATCH_NAME_CANDIDATE_LIMIT,
  MATCH_NAME_SIMILARITY_THRESHOLD,
  nameSimilarity,
  normalizeName,
  normalizeSku,
  topNameCandidates,
} from '../product-matching';

describe('normalizeSku (§16.1)', () => {
  it('trims, case-folds and collapses whitespace', () => {
    expect(normalizeSku('  ABC-123  ')).toBe('abc-123');
    expect(normalizeSku('AB  C\t123')).toBe('ab c 123');
  });

  it('treats hyphens, underscores and dots as significant', () => {
    expect(normalizeSku('ABC-123')).not.toBe(normalizeSku('ABC123'));
    expect(normalizeSku('ABC_123')).not.toBe(normalizeSku('ABC-123'));
    expect(normalizeSku('ABC.123')).not.toBe(normalizeSku('ABC123'));
  });
});

describe('normalizeName (§16.1)', () => {
  it('trims, case-folds, strips punctuation, collapses whitespace', () => {
    expect(normalizeName('  Blue  Panjabi! (Eid) ')).toBe('blue panjabi eid');
  });
});

describe('nameSimilarity (bigram Dice)', () => {
  it('returns 1 for identical names (after normalization)', () => {
    expect(nameSimilarity('Blue Panjabi', 'blue  panjabi!')).toBe(1);
  });

  it('scores near-identical names above the threshold (calibrated values)', () => {
    // Measured Dice scores — the threshold (0.75) sits between the
    // same-product variants and the different-product lookalike.
    expect(nameSimilarity('Blue Panjabi', 'Blue Panjabi Large')).toBeCloseTo(0.786, 3);
    expect(nameSimilarity('Blue Panjabi', 'Blue Panjabi Medium')).toBeCloseTo(0.759, 3);
    expect(nameSimilarity('Blue Panjabi', 'Blue Panjabi Large')).toBeGreaterThanOrEqual(
      MATCH_NAME_SIMILARITY_THRESHOLD,
    );
  });

  it('scores clearly different names below the threshold', () => {
    expect(nameSimilarity('Blue Panjabi', 'Red Panjabi')).toBeCloseTo(0.667, 3);
    expect(nameSimilarity('Blue Panjabi', 'Red Panjabi')).toBeLessThan(
      MATCH_NAME_SIMILARITY_THRESHOLD,
    );
    expect(nameSimilarity('Blue Panjabi', 'Leather Wallet')).toBeLessThan(0.3);
  });

  it('returns 0 for short names that differ', () => {
    expect(nameSimilarity('A', 'B')).toBe(0);
    expect(nameSimilarity('AB', 'AB')).toBe(1);
  });
});

describe('topNameCandidates (§16.2)', () => {
  const pool = [
    { id: 'p1', name: 'Blue Panjabi Large', sku: 'BP-L' },
    { id: 'p2', name: 'Blue Panjabi', sku: 'BP-001' },
    { id: 'p3', name: 'Red Panjabi', sku: 'RP-001' },
    { id: 'p4', name: 'Blue Panjabi Medium', sku: 'BP-M' },
  ];

  it('returns at most 2 candidates above the threshold, best first', () => {
    const out = topNameCandidates('Blue Panjabi', pool);
    expect(out).toHaveLength(MATCH_NAME_CANDIDATE_LIMIT);
    expect(out[0]!.id).toBe('p2'); // exact match first
    expect(out[0]!.score).toBe(1);
    expect(out[1]!.score).toBeGreaterThanOrEqual(MATCH_NAME_SIMILARITY_THRESHOLD);
  });

  it('returns nothing when no candidate clears the threshold', () => {
    expect(topNameCandidates('Leather Wallet', pool)).toEqual([]);
    expect(topNameCandidates('Blue Panjabi', [])).toEqual([]);
  });

  it('respects a custom threshold', () => {
    const out = topNameCandidates('Blue Panjabi', pool, 0.99);
    expect(out.map((c) => c.id)).toEqual(['p2']);
  });
});
