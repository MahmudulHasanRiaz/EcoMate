/**
 * Product matching — WooCommerce product import (§16).
 *
 * Pure comparison helpers. The service owns DB lookups; this module owns
 * the comparison rules so they are unit-testable without a database.
 *
 * Tiers (§16.2): 1. normalized exact SKU (the STRONG suggestion — same SKU
 * is near-certainly the same product); 2. name similarity (top 2
 * candidates, high threshold — a wrong suggestion is worse than none);
 * 3. no match. Already-linked outranks all tiers (the service checks the
 * mapping first, before calling here).
 */

/**
 * Name-similarity acceptance threshold (§16.2). Tunable constant, not a
 * console setting in v1. Calibrated on the bigram Dice score (measured,
 * not estimated): "Blue Panjabi" vs "Blue Panjabi Large" scores 0.786 and
 * vs "Blue Panjabi Medium" 0.759 — both genuine same-product variants and
 * both must suggest; vs "Red Panjabi" 0.667 — a different product sharing
 * a word, must not suggest. 0.75 sits between them. Known miss: long
 * suffixes dilute Dice ("Blue Panjabi for Men" scores 0.733) — the SKU
 * tier is the strong signal, and the operator can always link manually.
 */
export const MATCH_NAME_SIMILARITY_THRESHOLD = 0.75;

/** Max name-similarity candidates returned per remote product (§4.1). */
export const MATCH_NAME_CANDIDATE_LIMIT = 2;

/**
 * SKU normalization (§16.1): trim, case-fold, collapse internal whitespace
 * runs to a single space. Hyphens, underscores and dots are SIGNIFICANT —
 * `ABC-123` is not `ABC123`.
 */
export function normalizeSku(sku: string): string {
  return (sku ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Name normalization (§16.1): trim, case-fold, collapse whitespace, strip
 * punctuation for the similarity score (the UI still shows original names).
 */
export function normalizeName(name: string): string {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ');
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * Bigram Dice coefficient over normalized names (0..1). 1 = identical,
 * 0 = no shared bigrams. Short names (< 2 chars after normalization) fall
 * back to exact equality — Dice is meaningless on single characters.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let shared = 0;
  for (const g of ba) if (bb.has(g)) shared += 1;
  return (2 * shared) / (ba.size + bb.size);
}

export interface NameCandidate {
  id: string;
  name: string;
  sku: string | null;
}

/**
 * Rank local products by name similarity to the remote name; return the top
 * candidates above the threshold (at most MATCH_NAME_CANDIDATE_LIMIT).
 * Ties break by shorter name first (closer to the remote name), then by id
 * for determinism.
 */
export function topNameCandidates(
  remoteName: string,
  locals: NameCandidate[],
  threshold: number = MATCH_NAME_SIMILARITY_THRESHOLD,
  limit: number = MATCH_NAME_CANDIDATE_LIMIT,
): Array<NameCandidate & { score: number }> {
  const scored = locals
    .map((local) => ({ ...local, score: nameSimilarity(remoteName, local.name) }))
    .filter((c) => c.score >= threshold)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.name.length - b.name.length ||
        a.id.localeCompare(b.id),
    );
  return scored.slice(0, limit);
}
