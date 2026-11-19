import {
  hashContact,
  toUnixSeconds,
  type AdLeadContext,
  type AdSender,
} from './ad-sender';

/**
 * TikTok Events API sender (CMS batch 2, item 21).
 *
 * POST https://business-api.tiktok.com/open_api/v1.3/event/track/
 * Header: Access-Token: {token}
 * Body: { pixel_code, event, event_id, event_time, user, properties,
 *   page? }
 *
 * user carries SHA-256 hashed email/phone_number (TikTok requires
 * hashing) and the raw ttclid click id from the form capture.
 * event_id is the form-generated TikTok dedup id (falls back to the
 * dispatch row id). TikTok answers `{ code: 0 }` on success — any
 * other code, or a non-2xx HTTP status, throws.
 */
export const TIKTOK_EVENTS_URL =
  'https://business-api.tiktok.com/open_api/v1.3/event/track/';
export const TIKTOK_EVENTS_TIMEOUT_MS = 15_000;

export function buildTikTokEventsPayload(context: AdLeadContext): {
  url: string;
  body: Record<string, unknown>;
} {
  const { lead, dispatch, config } = context;
  const hashed = hashContact(lead.contact, lead.contactType);
  const user: Record<string, unknown> = {};
  if (hashed.email) user.email = hashed.email;
  if (hashed.phone) user.phone_number = hashed.phone;
  if (lead.ttclid) user.ttclid = lead.ttclid;

  const body: Record<string, unknown> = {
    pixel_code: config.pixelId,
    event: dispatch.eventName,
    event_id: lead.tiktokEventId || dispatch.id,
    event_time: toUnixSeconds(dispatch.createdAt),
    user,
    properties: { lead_id: lead.id },
  };
  if (context.eventSourceUrl) {
    body.page = { url: context.eventSourceUrl };
  }
  return { url: TIKTOK_EVENTS_URL, body };
}

export class TikTokEventsSender implements AdSender {
  readonly platform = 'tiktok';

  async send(context: AdLeadContext): Promise<void> {
    const { url, body } = buildTikTokEventsPayload(context);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': context.config.accessToken,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIKTOK_EVENTS_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        `TikTok Events API ${response.status}: ${tiktokErrorMessage(payload)}`,
      );
    }
    const code =
      typeof payload === 'object' && payload !== null
        ? (payload as { code?: unknown }).code
        : undefined;
    if (code !== 0) {
      throw new Error(
        `TikTok Events API error: ${tiktokErrorMessage(payload)}`,
      );
    }
  }
}

function tiktokErrorMessage(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    const message =
      typeof record.message === 'string' ? record.message : '';
    const code = record.code !== undefined ? ` (code ${String(record.code)})` : '';
    if (message) return `${message}${code}`;
    if (code) return `request failed${code}`;
  }
  return 'request failed';
}
