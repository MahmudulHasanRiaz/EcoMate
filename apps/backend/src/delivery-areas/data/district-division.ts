/**
 * Canonical Bangladesh district → division resolver (spec §19-21).
 *
 * Single authoritative mapping for the whole monorepo: storefront, backend
 * orders, POS, admin and tracking all resolve districts through this one
 * table. Keyed on the project's canonical district names (delivery-areas
 * BD_DISTRICTS), with a small alias map for common spelling variants so that
 * both "Chattogram" and "Chittagong" resolve identically.
 *
 * Directories follow official 8-division names (BD_DIVISIONS in
 * bd-districts.ts): Dhaka, Chittagong, Rajshahi, Khulna, Barisal, Sylhet,
 * Rangpur, Mymensingh. New orders persist the resolved division into
 * shippingAddress JSON; historical orders (no division) are lazily resolved
 * at tracking/read time — never a DB backfill.
 */

export const BD_DIVISIONS = [
  'Dhaka',
  'Chittagong',
  'Rajshahi',
  'Khulna',
  'Barisal',
  'Sylhet',
  'Rangpur',
  'Mymensingh',
] as const;

export type BDDivision = (typeof BD_DIVISIONS)[number];

/**
 * district -> division. Keys are the project's canonical English district
 * names; all 64 districts are present (one entry each, no duplicates).
 * Added as `@@`-stable plain object so it is directly importable by the
 * delivery-areas module and the tracking/orders services without a cycle.
 */
export const DISTRICT_TO_DIVISION: Readonly<Record<string, BDDivision>> = {
  // Dhaka division (13)
  Dhaka: 'Dhaka',
  Faridpur: 'Dhaka',
  Gazipur: 'Dhaka',
  Gopalganj: 'Dhaka',
  Kishoreganj: 'Dhaka',
  Madaripur: 'Dhaka',
  Manikganj: 'Dhaka',
  Munshiganj: 'Dhaka',
  Narayanganj: 'Dhaka',
  Narsingdi: 'Dhaka',
  Rajbari: 'Dhaka',
  Shariatpur: 'Dhaka',
  Tangail: 'Dhaka',
  // Chittagong division (11)
  Bandarban: 'Chittagong',
  Brahmanbaria: 'Chittagong',
  Chandpur: 'Chittagong',
  Chittagong: 'Chittagong',
  Comilla: 'Chittagong',
  "Cox's Bazar": 'Chittagong',
  Feni: 'Chittagong',
  Khagrachari: 'Chittagong',
  Lakshmipur: 'Chittagong',
  Noakhali: 'Chittagong',
  Rangamati: 'Chittagong',
  // Rajshahi division (8)
  Bogura: 'Rajshahi',
  Chapainawabganj: 'Rajshahi',
  Joypurhat: 'Rajshahi',
  Naogaon: 'Rajshahi',
  Natore: 'Rajshahi',
  Pabna: 'Rajshahi',
  Rajshahi: 'Rajshahi',
  Sirajganj: 'Rajshahi',
  // Khulna division (10)
  Bagerhat: 'Khulna',
  Chuadanga: 'Khulna',
  Jashore: 'Khulna',
  Jhenaidah: 'Khulna',
  Khulna: 'Khulna',
  Kushtia: 'Khulna',
  Magura: 'Khulna',
  Meherpur: 'Khulna',
  Narail: 'Khulna',
  Satkhira: 'Khulna',
  // Barisal division (6)
  Barguna: 'Barisal',
  Barisal: 'Barisal',
  Bhola: 'Barisal',
  Jhalokati: 'Barisal',
  Patuakhali: 'Barisal',
  Pirojpur: 'Barisal',
  // Sylhet division (4)
  Habiganj: 'Sylhet',
  Moulvibazar: 'Sylhet',
  Sunamganj: 'Sylhet',
  Sylhet: 'Sylhet',
  // Rangpur division (8)
  Dinajpur: 'Rangpur',
  Gaibandha: 'Rangpur',
  Kurigram: 'Rangpur',
  Lalmonirhat: 'Rangpur',
  Nilphamari: 'Rangpur',
  Panchagarh: 'Rangpur',
  Rangpur: 'Rangpur',
  Thakurgaon: 'Rangpur',
  // Mymensingh division (4)
  Jamalpur: 'Mymensingh',
  Mymensingh: 'Mymensingh',
  Netrokona: 'Mymensingh',
  Sherpur: 'Mymensingh',
};

/**
 * Common spelling variants (official Gazette vs project delivery-areas names).
 * Both forms resolve; the canonical project spelling is the primary key above.
 */
const DISTRICT_ALIASES: Readonly<Record<string, string>> = {
  Chattogram: 'Chittagong',
  Cumilla: 'Comilla',
  Barishal: 'Barisal',
  Jhalokathi: 'Jhalokati',
  Khagrachhari: 'Khagrachari',
  Khagrachory: 'Khagrachari',
};

function normalizeDistrict(district: string): string {
  return district.trim().replace(/\s+/g, ' ');
}

/** Canonical division for a district (project spelling), or undefined on miss. */
export function resolveDivision(
  district?: string | null,
): BDDivision | undefined {
  if (!district) return undefined;
  const key = normalizeDistrict(district);

  // Exact project-spelling key first (fast path).
  const exact = DISTRICT_TO_DIVISION[key];
  if (exact) return exact;

  // Official-spelling alias -> canonical district -> division.
  const aliasTarget = DISTRICT_ALIASES[key];
  if (aliasTarget) return DISTRICT_TO_DIVISION[aliasTarget];

  // Case-insensitive scan (handles `dhaka`, `COX'S BAZAR`, etc.) over both the
  // canonical keys and the aliases — still fully single-sourced.
  const lower = key.toLowerCase();
  for (const [name, division] of Object.entries(DISTRICT_TO_DIVISION)) {
    if (name.toLowerCase() === lower) return division;
  }
  for (const [alias, name] of Object.entries(DISTRICT_ALIASES)) {
    if (alias.toLowerCase() === lower) return DISTRICT_TO_DIVISION[name];
  }
  return undefined;
}

/** True when the district is a known Bangladesh district (project list). */
export function isKnownDistrict(district?: string | null): boolean {
  if (!district) return false;
  return resolveDivision(district) !== undefined;
}

/**
 * WooCommerce Bangladesh state codes → district (ISO 3166-2:BD).
 *
 * WooCommerce ships orders with the state as a two-letter country + two-digit
 * district code (e.g. `BD-13` = Dhaka) — see WooCommerce `i18n/states.php`
 * (`BD` section) and ISO 3166-2:BD. The values are this project's canonical
 * district spellings so `resolveDivision()` works on them directly.
 * All 64 districts are present.
 */
export const WOO_BD_STATE_TO_DISTRICT: Readonly<Record<string, string>> = {
  // Dhaka division (13)
  'BD-13': 'Dhaka',
  'BD-15': 'Faridpur',
  'BD-18': 'Gazipur',
  'BD-17': 'Gopalganj',
  'BD-26': 'Kishoreganj',
  'BD-33': 'Madaripur',
  'BD-64': 'Manikganj',
  'BD-38': 'Munshiganj',
  'BD-40': 'Narayanganj',
  'BD-41': 'Narsingdi',
  'BD-51': 'Rajbari',
  'BD-56': 'Shariatpur',
  'BD-61': 'Tangail',
  // Chittagong division (11)
  'BD-01': 'Bandarban',
  'BD-04': 'Brahmanbaria',
  'BD-09': 'Chandpur',
  'BD-10': 'Chittagong',
  'BD-08': 'Comilla',
  'BD-11': "Cox's Bazar",
  'BD-16': 'Feni',
  'BD-29': 'Khagrachari',
  'BD-31': 'Lakshmipur',
  'BD-45': 'Noakhali',
  'BD-54': 'Rangamati',
  // Rajshahi division (8)
  'BD-03': 'Bogura',
  'BD-63': 'Chapainawabganj',
  'BD-24': 'Joypurhat',
  'BD-39': 'Naogaon',
  'BD-42': 'Natore',
  'BD-47': 'Pabna',
  'BD-52': 'Rajshahi',
  'BD-58': 'Sirajganj',
  // Khulna division (10)
  'BD-05': 'Bagerhat',
  'BD-12': 'Chuadanga',
  'BD-22': 'Jashore',
  'BD-23': 'Jhenaidah',
  'BD-27': 'Khulna',
  'BD-30': 'Kushtia',
  'BD-34': 'Magura',
  'BD-36': 'Meherpur',
  'BD-46': 'Narail',
  'BD-55': 'Satkhira',
  // Barisal division (6)
  'BD-02': 'Barguna',
  'BD-06': 'Barisal',
  'BD-07': 'Bhola',
  'BD-25': 'Jhalokati',
  'BD-49': 'Patuakhali',
  'BD-50': 'Pirojpur',
  // Sylhet division (4)
  'BD-20': 'Habiganj',
  'BD-37': 'Moulvibazar',
  'BD-59': 'Sunamganj',
  'BD-60': 'Sylhet',
  // Rangpur division (8)
  'BD-14': 'Dinajpur',
  'BD-19': 'Gaibandha',
  'BD-28': 'Kurigram',
  'BD-32': 'Lalmonirhat',
  'BD-44': 'Nilphamari',
  'BD-48': 'Panchagarh',
  'BD-53': 'Rangpur',
  'BD-62': 'Thakurgaon',
  // Mymensingh division (4)
  'BD-21': 'Jamalpur',
  'BD-35': 'Mymensingh',
  'BD-43': 'Netrokona',
  'BD-57': 'Sherpur',
};

/**
 * Resolve a WooCommerce BD state code (e.g. `BD-13`) to the canonical
 * district name, or undefined for anything that is not a known code
 * (callers keep the raw value then — fail-safe, never a wrong district).
 */
export function resolveDistrictFromWooStateCode(
  code?: string | null,
): string | undefined {
  if (!code) return undefined;
  return WOO_BD_STATE_TO_DISTRICT[code.trim().toUpperCase()];
}