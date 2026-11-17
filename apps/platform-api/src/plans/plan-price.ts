/**
 * Prisma Decimal columns serialize to JSON STRINGS ("1500") — but the
 * API contract (landing PublicPlan + console PlanVersion) says number.
 * Normalize at the source so no consumer has to defend against the
 * string form. A non-finite value becomes null rather than leaking NaN
 * (which JSON.stringify would turn into null anyway, but explicitly is
 * better than by accident).
 */
export function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** A plan version row with its Decimal price converted to a JSON number. */
export function normalizeVersionPrice<T extends { price?: unknown }>(
  version: T,
): T & { price: number | null } {
  return { ...version, price: decimalToNumber(version.price) };
}

/**
 * A plan row (with embedded versions) with every Decimal price
 * converted to a JSON number — versions[] and currentVersion alike.
 */
export function normalizePlanPrices<
  T extends { versions?: any[]; currentVersion?: any },
>(plan: T): T {
  const versions = plan.versions?.map((version) =>
    normalizeVersionPrice(version),
  );
  const currentVersion = plan.currentVersion
    ? normalizeVersionPrice(plan.currentVersion)
    : plan.currentVersion;
  return { ...plan, versions, currentVersion };
}
