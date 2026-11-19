import * as crypto from 'crypto';

/**
 * Per-platform sender contract (CMS batch 2, item 21). Each platform
 * implements this interface: Meta CAPI, TikTok Events API, and the
 * stub sender used in tests. A sender throws on ANY failure (HTTP
 * error, non-2xx, provider error code) — the service turns the throw
 * into a retry-schedule step. A sender must never swallow a failure
 * and return normally: that would mark a lost event as sent.
 */
export interface AdLeadContext {
  /** Platform id this send is for (matches the sender's platform). */
  platform: string;
  /** The lead the event is about (Prisma Lead row shape, minimal). */
  lead: {
    id: string;
    name: string;
    contact: string;
    contactType: 'email' | 'phone';
    fbp?: string | null;
    fbc?: string | null;
    eventId?: string | null;
    ttclid?: string | null;
    tiktokEventId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    createdAt: Date;
  };
  /** The dispatch row being sent (dedupe fallback + event time). */
  dispatch: {
    id: string;
    eventName: string;
    createdAt: Date;
  };
  /** Resolved platform config (decrypted token, from SettingsService). */
  config: {
    pixelId: string;
    accessToken: string;
  };
  /** Event source URL (landing page) when AD_DISPATCH_EVENT_SOURCE_URL is set. */
  eventSourceUrl?: string;
}

export interface AdSender {
  /** Platform id this sender serves (must match AD_PLATFORMS). */
  readonly platform: string;
  send(context: AdLeadContext): Promise<void>;
}

/** SHA-256 hex of a normalized identifier (Meta + TikTok both want it). */
export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Meta/TikTok user-data hashing. Email: lowercase + trim, then SHA-256.
 * Phone: digits only; a Bangladeshi 11-digit number starting with 0 is
 * rewritten to the 880 country-code form (Meta wants the country code,
 * no `+`, no spaces). Anything unparseable returns null (the field is
 * omitted, never sent raw).
 */
export function hashContact(
  contact: string,
  contactType: 'email' | 'phone',
): { email?: string; phone?: string } {
  if (contactType === 'email') {
    const email = contact.trim().toLowerCase();
    return email.includes('@') ? { email: sha256Hex(email) } : {};
  }
  const digits = contact.replace(/\D/g, '');
  if (!digits) return {};
  const normalized =
    digits.length === 11 && digits.startsWith('0')
      ? `880${digits.slice(1)}`
      : digits;
  return normalized.length >= 7 ? { phone: sha256Hex(normalized) } : {};
}

/** Unix seconds for an event time (both providers take seconds). */
export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
