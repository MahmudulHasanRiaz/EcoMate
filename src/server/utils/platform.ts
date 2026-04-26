import { OrderPlatform } from '@prisma/client';

export function inferPlatformFromUrl(landingPage?: string | null): OrderPlatform {
  if (!landingPage) return 'Website';
  try {
    const url = new URL(landingPage);
    const fbclid = url.searchParams.get('fbclid');
    const ttclid = url.searchParams.get('ttclid');
    const igshid = url.searchParams.get('igshid');
    const utmSource = (url.searchParams.get('utm_source') || '').toLowerCase();
    
    if (ttclid || utmSource.includes('tiktok') || utmSource.includes('tt')) return 'TikTok';
    if (igshid || utmSource.includes('instagram') || utmSource.includes('ig')) return 'Instagram';
    if (fbclid || utmSource.includes('facebook') || utmSource.includes('fb')) return 'Facebook';
  } catch (e) {
    // Ignore invalid URLs
  }
  return 'Website';
}

// ── Helpers for WooCommerce UTM extraction ──────────────────────────────

function safeDecode(str: string): string {
  try {
    return decodeURIComponent(str.trim());
  } catch {
    return str.trim();
  }
}

/** Parse PixelYourSite pipe-delimited utm string, e.g.
 *  "utm_source:fb|utm_medium:manual|utm_campaign:GOD1N9|..." */
function parsePysUtm(s?: string | null): string | null {
  if (!s) return null;
  const parts = s.split('|');
  for (const p of parts) {
    const [k, ...rest] = p.split(':');
    const key = (k || '').trim().toLowerCase();
    const val = rest.join(':').trim();
    if ((key === 'utm_campaign' || key === 'utm_id') && val) return safeDecode(val);
  }
  return null;
}

/** Extract utm_campaign / utm_id from a URL string. */
function parseUtmFromUrl(urlStr?: string | null): string | null {
  if (!urlStr) return null;
  try {
    const url = new URL(urlStr);
    return url.searchParams.get('utm_campaign')?.trim()
      || url.searchParams.get('utm_id')?.trim()
      || null;
  } catch {
    return null;
  }
}

/** Scan any arbitrary string for utm_campaign= / utm_id= / utm_campaign: / utm_id: patterns */
function parseUtmFromString(s?: string | null): string | null {
  if (!s || typeof s !== 'string') return null;
  // Try query-string style: utm_campaign=VALUE or utm_id=VALUE
  const qsMatch = s.match(/[?&]?utm_(?:campaign|id)=([^&|\s]+)/i);
  if (qsMatch?.[1]?.trim()) return safeDecode(qsMatch[1]);
  // Try colon style (PYS): utm_campaign:VALUE or utm_id:VALUE
  const colonMatch = s.match(/utm_(?:campaign|id):([^|&\s]+)/i);
  if (colonMatch?.[1]?.trim()) return safeDecode(colonMatch[1]);
  return null;
}

/**
 * Extract a campaign shortCode from WooCommerce payload metadata or landingPage URL.
 *
 * Checked sources (in priority order):
 *  1. meta_data `utm_campaign` / `utm_id`
 *  2. meta_data `_wc_order_attribution_utm_campaign`
 *  3. meta_data `_wc_order_attribution_session_entry` (URL → parse utm_campaign)
 *  4. meta_data `pys_enrich_data` → pys_utm / last_pys_utm
 *  5. Generic string scan of any meta_data value
 *  6. line_items[].meta_data (same checks)
 *  7. landingPage URL fallback
 *
 * Returns null if no campaign identifier is found.
 */
export function extractUtmCampaignCode(input: any): string | null {
  if (!input) return null;

  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      return null;
    }
  }

  // --- scan a single meta_data entry ---
  const scanMeta = (meta: any): string | null => {
    const k = (meta?.key ?? '').toString().toLowerCase().trim();
    const v = meta?.value;

    // Direct utm_campaign / utm_id
    if (k === 'utm_campaign' || k === 'utm_id') {
      const s = String(v || '').trim();
      if (s) return s;
    }
    // _wc_order_attribution_utm_campaign
    if (k === '_wc_order_attribution_utm_campaign') {
      const s = String(v || '').trim();
      if (s) return s;
    }
    // _wc_order_attribution_session_entry (URL)
    if (k === '_wc_order_attribution_session_entry') {
      const parsed = parseUtmFromUrl(typeof v === 'string' ? v : null);
      if (parsed) return parsed;
    }
    // pys_enrich_data (object with pys_utm / last_pys_utm)
    if (k === 'pys_enrich_data' && v && typeof v === 'object') {
      const obj = v as Record<string, any>;
      const fromPys = parsePysUtm(obj.pys_utm) || parsePysUtm(obj.last_pys_utm);
      if (fromPys) return fromPys;
    }
    // Generic fallback: if value is a string, scan it for utm_campaign=... or utm_campaign:...
    if (typeof v === 'string' && v.length > 5) {
      const fromStr = parseUtmFromString(v);
      if (fromStr) return fromStr;
    }
    return null;
  };

  // --- scan an entire meta_data structure (array or object-map) ---
  const scanMetaList = (md: any): string | null => {
    if (Array.isArray(md)) {
      for (const meta of md) {
        const code = scanMeta(meta);
        if (code) return code;
      }
    } else if (md && typeof md === 'object') {
      for (const [key, val] of Object.entries(md)) {
        const code = scanMeta({ key, value: val });
        if (code) return code;
      }
    }
    return null;
  };

  // 1. Root meta_data
  const fromRoot = scanMetaList(data?.meta_data);
  if (fromRoot) return fromRoot;

  // 2. line_items[].meta_data
  if (Array.isArray(data?.line_items)) {
    for (const li of data.line_items) {
      const fromLi = scanMetaList(li?.meta_data);
      if (fromLi) return fromLi;
    }
  }

  // 3. Fallback: parse from landingPage URL
  const landingPage = data?.landingPage
    || (Array.isArray(data?.meta_data) && data.meta_data.find?.((m: any) => m.key === 'landingPage')?.value);

  const fromLanding = parseUtmFromUrl(typeof landingPage === 'string' ? landingPage : null);
  if (fromLanding) return fromLanding;

  return null;
}
