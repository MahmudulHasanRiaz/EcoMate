import {
  hashContact,
  toUnixSeconds,
  type AdLeadContext,
  type AdSender,
} from './ad-sender';

/**
 * Meta Conversions API sender (CMS batch 2, item 21).
 *
 * POST https://graph.facebook.com/v21.0/{pixelId}/events
 *   ?access_token={token}
 * Body: { data: [{ event_name, event_time, event_id, action_source,
 *   event_source_url?, user_data, custom_data }], test_event_code? }
 *
 * user_data carries SHA-256 hashed em/ph (Meta requires hashing),
 * fbp/fbc passthrough from the form capture, and the client IP +
 * user agent. event_id is the form-generated dedup id (falls back to
 * the dispatch row id). No test_event_code is sent — this sender is
 * never exercised against a real ad account in this codebase; when
 * Boss wires a real pixel, the operator verifies via Meta Events
 * Manager. A non-2xx response or a Meta error payload throws.
 */
export const META_CAPI_VERSION = 'v21.0';
export const META_CAPI_TIMEOUT_MS = 15_000;

export function buildMetaCapiPayload(context: AdLeadContext): {
  url: string;
  body: Record<string, unknown>;
} {
  const { lead, dispatch, config } = context;
  // Meta's user_data keys are em/ph (not email/phone_number).
  const hashed = hashContact(lead.contact, lead.contactType);
  const userData: Record<string, unknown> = {};
  if (hashed.email) userData.em = hashed.email;
  if (hashed.phone) userData.ph = hashed.phone;
  if (lead.fbp) userData.fbp = lead.fbp;
  if (lead.fbc) userData.fbc = lead.fbc;
  if (lead.ip) userData.client_ip_address = lead.ip;
  if (lead.userAgent) userData.client_user_agent = lead.userAgent;

  const event: Record<string, unknown> = {
    event_name: dispatch.eventName,
    event_time: toUnixSeconds(dispatch.createdAt),
    event_id: lead.eventId || dispatch.id,
    action_source: 'website',
    user_data: userData,
    custom_data: { lead_id: lead.id },
  };
  if (context.eventSourceUrl) {
    event.event_source_url = context.eventSourceUrl;
  }

  return {
    url:
      `https://graph.facebook.com/${META_CAPI_VERSION}/${encodeURIComponent(config.pixelId)}/events` +
      `?access_token=${encodeURIComponent(config.accessToken)}`,
    body: { data: [event] },
  };
}

export class MetaCapiSender implements AdSender {
  readonly platform = 'meta';

  async send(context: AdLeadContext): Promise<void> {
    const { url, body } = buildMetaCapiPayload(context);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(META_CAPI_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = metaErrorMessage(payload);
      throw new Error(`Meta CAPI ${response.status}: ${message}`);
    }
    // A 2xx with an error payload is still a failure (Meta sometimes
    // reports per-event errors this way).
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload
    ) {
      throw new Error(`Meta CAPI error: ${metaErrorMessage(payload)}`);
    }
  }
}

function metaErrorMessage(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'object' && error !== null) {
      const record = error as Record<string, unknown>;
      const message =
        typeof record.message === 'string' ? record.message : '';
      const code = record.code !== undefined ? ` (code ${String(record.code)})` : '';
      if (message) return `${message}${code}`;
    }
  }
  return 'request failed';
}
