/**
 * Shared branded layout for EcoMate SaaS transactional email.
 *
 * Every user-facing template renders through renderEmailLayout() so all
 * mail looks like it comes from the same product: a clean, minimal,
 * standard design — EcoMate wordmark header, one indigo primary CTA,
 * restrained footer. Quiet and confident, not loud: no banners, no
 * social-icon clutter, no marketing noise.
 *
 * Email-client-safe construction (Gmail + Outlook):
 * - Table-based layout, inline CSS only — no <style> block at all, so
 *   nothing depends on a client preserving one.
 * - Outer table is fluid (width 100%); the content table caps at 600px
 *   and shrinks on narrow screens, so the mail reads at 375px with no
 *   media query.
 * - System font stack only — no web fonts.
 * - Nothing essential depends on an image: the logo is decorative, the
 *   platform name also appears as text in the footer, and the logo
 *   carries alt text. Logo images are used ONLY when the configured
 *   logo URL is an https URL — data: URLs (what console uploads store)
 *   are blocked by most email clients, so they fall back to the text
 *   wordmark.
 *
 * Escaping contract: everything passed into these helpers is RAW and is
 * escaped inside — except `bodyHtml`, which is pre-built HTML whose
 * interpolated values the caller must already have escaped (use
 * escapeHtml / para / link / renderDetails for that).
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const ACCENT = '#4f46e5'; // EcoMate landing indigo
const PAGE_BG = '#f6f7f9';
const CARD_BG = '#ffffff';
const BORDER = '#e5e7eb';
const HEADING = '#111827';
const BODY_TEXT = '#374151';
const MUTED = '#6b7280';
const FOOTER_TEXT = '#9ca3af';
const DETAILS_BG = '#f9fafb';

export interface EmailBrand {
  platformName: string;
  supportEmail?: string;
  logoUrl?: string;
}

export interface EmailCta {
  label: string;
  url: string;
}

export interface EmailLayoutInput {
  brand: EmailBrand;
  /** Raw heading text — escaped inside. */
  heading: string;
  /** Pre-built body HTML. Interpolated values must already be escaped. */
  bodyHtml: string;
  /** The one primary action, if the email has one. Raw — escaped inside. */
  cta?: EmailCta;
  /** Hidden inbox-preview line. Raw — escaped inside. */
  preheader?: string;
}

export interface DetailRow {
  label: string;
  value: string;
}

/** A body paragraph with email-safe margins. `html` must be pre-escaped. */
export function para(html: string): string {
  return `<p style="margin:0 0 12px 0;">${html}</p>`;
}

/** An inline link in the brand accent colour. Raw label/url — escaped inside. */
export function link(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}" style="color:${ACCENT};text-decoration:underline;">${escapeHtml(label)}</a>`;
}

/**
 * A key/value summary box for genuinely tabular content (invoice totals,
 * lead details). Labels and values are raw — escaped inside. Values are
 * right-aligned like a receipt; the box keeps the email scannable.
 */
export function renderDetails(rows: DetailRow[]): string {
  const rowsHtml = rows
    .map(
      (row) =>
        `<tr><td style="padding:4px 16px 4px 0;font-family:${FONT_STACK};font-size:14px;line-height:20px;color:${MUTED};vertical-align:top;white-space:nowrap;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:4px 0;font-family:${FONT_STACK};font-size:14px;line-height:20px;color:${HEADING};font-weight:500;text-align:right;vertical-align:top;">${escapeHtml(row.value)}</td></tr>`,
    )
    .join('');
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="margin:0 0 16px 0;background-color:${DETAILS_BG};border:1px solid ${BORDER};border-radius:6px;">` +
    `<tr><td style="padding:12px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table></td></tr></table>`
  );
}

/**
 * Only an https URL may become an <img> in email. data: URLs (what the
 * console stores for uploaded logos) are blocked by most clients, http:
 * is insecure, and anything with whitespace is not a URL.
 */
function usableLogoUrl(logoUrl?: string): string | null {
  const url = (logoUrl ?? '').trim();
  if (!url) return null;
  if (!/^https:\/\/\S+$/.test(url)) return null;
  return url;
}

function renderHeader(brand: EmailBrand): string {
  const name = escapeHtml(brand.platformName);
  const logo = usableLogoUrl(brand.logoUrl);
  if (logo) {
    // Decorative: the platform name also appears as text in the footer,
    // and the alt text names it when images are blocked.
    return (
      `<img src="${escapeHtml(logo)}" alt="${name}" height="32" ` +
      `style="display:block;height:32px;width:auto;max-width:200px;border:0;" />`
    );
  }
  // Text wordmark: indigo initial-mark + platform name.
  const initial = escapeHtml(
    (brand.platformName.trim().charAt(0) || 'E').toUpperCase(),
  );
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td width="28" height="28" bgcolor="${ACCENT}" align="center" ` +
    `style="width:28px;height:28px;background-color:${ACCENT};border-radius:6px;` +
    `font-family:${FONT_STACK};font-size:16px;font-weight:700;line-height:28px;color:#ffffff;text-align:center;">${initial}</td>` +
    `<td style="padding-left:10px;font-family:${FONT_STACK};font-size:20px;font-weight:700;line-height:28px;color:${HEADING};">${name}</td>` +
    `</tr></table>`
  );
}

function renderCta(cta: EmailCta): string {
  const url = escapeHtml(cta.url);
  const label = escapeHtml(cta.label);
  // Padding on the link + bgcolor on the cell: the pattern Outlook
  // renders reliably (no VML needed for a rectangular button).
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="center" bgcolor="${ACCENT}" style="border-radius:6px;background-color:${ACCENT};">` +
    `<a href="${url}" style="display:inline-block;padding:12px 24px;font-family:${FONT_STACK};` +
    `font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;">${label}</a>` +
    `</td></tr></table>`
  );
}

function renderFooter(brand: EmailBrand): string {
  const year = new Date().getFullYear();
  const name = escapeHtml(brand.platformName);
  const support = (brand.supportEmail ?? '').trim();
  const help = support
    ? ` &middot; Questions? <a href="mailto:${escapeHtml(support)}" style="color:${FOOTER_TEXT};text-decoration:underline;">${escapeHtml(support)}</a>`
    : '';
  return (
    `<div style="border-top:1px solid ${BORDER};padding-top:16px;` +
    `font-family:${FONT_STACK};font-size:12px;line-height:18px;color:${FOOTER_TEXT};">` +
    `&copy; ${year} ${name}.${help}</div>`
  );
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const preheader = input.preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.preheader)}</div>`
    : '';
  const ctaRow = input.cta
    ? `<tr><td style="padding:12px 32px 0 32px;">${renderCta(input.cta)}</td></tr>` +
      `<tr><td style="padding:16px 32px 0 32px;">` +
      `<p style="margin:0;font-family:${FONT_STACK};font-size:13px;line-height:20px;color:${MUTED};">` +
      `If the button doesn&rsquo;t work, copy and paste this link into your browser:<br/>` +
      `<a href="${escapeHtml(input.cta.url)}" style="color:${ACCENT};text-decoration:underline;word-break:break-all;">${escapeHtml(input.cta.url)}</a></p>` +
      `</td></tr>`
    : '';
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<title>${escapeHtml(input.heading)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:${PAGE_BG};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">` +
    preheader +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">` +
    `<tr><td align="center" style="padding:32px 16px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:100%;max-width:600px;background-color:${CARD_BG};border:1px solid ${BORDER};border-radius:8px;">` +
    `<tr><td style="padding:32px 32px 0 32px;">${renderHeader(input.brand)}</td></tr>` +
    `<tr><td style="padding:24px 32px 0 32px;"><h1 style="margin:0;font-family:${FONT_STACK};font-size:20px;line-height:28px;font-weight:600;color:${HEADING};">${escapeHtml(input.heading)}</h1></td></tr>` +
    `<tr><td style="padding:12px 32px 0 32px;font-family:${FONT_STACK};font-size:15px;line-height:24px;color:${BODY_TEXT};">${input.bodyHtml}</td></tr>` +
    ctaRow +
    `<tr><td style="padding:32px;">${renderFooter(input.brand)}</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
