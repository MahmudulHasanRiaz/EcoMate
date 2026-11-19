# Ad tracking for the lead form (CMS batch 2, item 21)

Server-side lead attribution for the ad platforms EcoMate runs ads on:
Meta Conversions API + TikTok Events API today, extensible to whatever
else clients run. No ad-account credentials exist yet — every platform
starts unconfigured and dispatch stays a no-op until an operator wires
one in console Settings → Ad tracking.

## How a lead becomes an ad event

1. **Capture (landing).** `apps/landing/lib/ad-capture.ts` reads `_fbp` /
   `_fbc` cookies and the `ttclid` URL param when present (no Pixel is
   loaded on the landing, so these are usually absent) and generates
   fresh UUID dedup ids per submission (`eventId` for Meta,
   `tiktokEventId` for TikTok). `components/v3/Closing.tsx` sends them
   in the `POST /public/leads` body; the `Lead` model stores them
   (`fbp`, `fbc`, `eventId`, `ttclid`, `tiktokEventId` — all nullable).
2. **Trigger (platform-api).** `LeadsService` calls `AdDispatchService`
   (one fire-and-forget line per hook; the service never throws, so a
   dispatch failure can never fail a lead submit):
   - **instant** mode: enqueue on lead creation.
   - **validated** mode: enqueue when the lead's status changes to the
     platform's configured trigger status.
   Enqueue is idempotent per `(leadId, platform, eventName)` — a
   re-fire never creates a second row.
3. **Dispatch (platform-api).** `AdDispatchService.processDue` sends
   due `pending` rows through the per-platform sender and records the
   outcome on the `AdDispatch` row.

## The queue (`AdDispatch`)

| Field | Meaning |
|---|---|
| `platform` | String, validated at the API layer against the configured platforms — a new platform needs **no migration**. |
| `eventName` | Event name from the platform config at enqueue time. |
| `status` | `pending` = queued or retrying · `sent` = delivered (`sentAt` set) · `failed` = ladder exhausted (terminal until an operator retries). |
| `attempts` | Send attempts so far. |
| `lastError` | Last failure message (shown in the lead drawer). |
| `nextRetryAt` | Next retry time while pending; null when due now or terminal. |

**Backoff ladder** (mirror of the reference `dispatch_queue`):
1m → 5m → 30m → 2h → 12h. That's 5 retries (6 attempts total); the
6th failed attempt makes the row terminal `failed`. An operator
retries it from the lead drawer (`POST /ad-dispatch/:id/retry`),
which resets the row to `pending` with a fresh ladder (audited).

**Skip, don't fail:** a row whose platform is unconfigured, disabled,
or has no sender implementation is *skipped* (stays `pending`, no
attempt burned) — it sends once the platform is configured. Only a
real send failure burns an attempt.

## Runner choice

A **dedicated processor in the `ad-dispatch` module**, not the
billing-jobs runner: billing jobs tick hourly (their work is
date-driven), while ad dispatch needs minute-level retries (first
backoff is 1 minute) and is marketing-side, not billing-side. The
processor reuses the billing runner's shape — `setInterval` +
running guard + env gate + a manual run endpoint:

- `AD_DISPATCH_ENABLED` (default on; `false` disables the interval)
- `AD_DISPATCH_INTERVAL_MS` (default 60000)
- Manual run: `POST /ad-dispatch/process` (SUPERADMIN/BILLING, audited;
  409 while a run is in progress)

## Senders (`src/ad-dispatch/senders/`)

One class per platform behind the `AdSender` interface (`send()` throws
on any failure — a sender must never swallow one):

- **Meta CAPI** — `POST https://graph.facebook.com/v21.0/{pixelId}/events?access_token=…`,
  `{ data: [{ event_name, event_time, event_id, action_source:
  'website', user_data, custom_data }] }`. `user_data` carries
  SHA-256 `em`/`ph` (email lowercased+trimmed; BD phones normalized
  to the 880 form), `fbp`/`fbc` passthrough, client IP + user agent.
  `event_id` is the form's dedup id (dispatch id as fallback).
- **TikTok Events API** — `POST https://business-api.tiktok.com/open_api/v1.3/event/track/`
  with `Access-Token`, `{ pixel_code, event, event_id, event_time,
  user: { email?, phone_number?, ttclid? }, properties }`. Success is
  `{ code: 0 }`; anything else throws.
- **Stub** — in-memory, never the network. Records every send; fails
  the first N sends when `AD_DISPATCH_STUB_FAIL_COUNT` is set. Selected
  with `AD_DISPATCH_SENDER=stub` (tests + live verification).

`AD_DISPATCH_EVENT_SOURCE_URL` sets the `event_source_url` / page URL
sent with each event; unset = omitted.

## Settings (console Settings → Ad tracking)

Per platform: pixel/dataset ID, access token, mode
(instant/validated), trigger status (validated mode), event name,
enabled toggle. Stored as one `PlatformSetting` row (`ad_tracking`),
keyed by platform id. **Tokens are encrypted at rest (AES-256-GCM,
same pattern as the SMTP password)** and never returned by any read —
the API returns `hasToken` / `configured` only; the audit record for
a settings change carries the public view. An undecryptable token
(rotated key) fails closed for that platform only.

API: `GET /settings/ad-tracking`, `PATCH /settings/ad-tracking/:platform`
(SUPERADMIN). The full settings dump (`GET /settings`) also carries
`adTracking` (public view).

## Console

- **Settings → Ad tracking** — one card per platform (from the
  `AD_TRACKING_PLATFORMS` list in `platform-admin/src/lib/ad-dispatch.ts`,
  which mirrors the API registry in `ad-platforms.ts`).
- **Leads → lead drawer → Ad tracking** — per-platform sync status
  (status badge, attempts, next retry / sent time, error text) + a
  Retry button for terminal failures. The drawer reads
  `GET /ad-dispatch/leads/:leadId`.

## Adding a platform

1. One row in `ad-platforms.ts` (+ the console mirror list).
2. One sender class implementing `AdSender` (+ a case in
   `AdSenderRegistry`).
3. No migration, no schema change. The settings UI renders the new
   platform's card from the list; triggers fan out over the registry.

## Env vars

See `apps/platform-api/.env.example` (`AD_DISPATCH_*`). No new
secrets in compose: tokens live in the encrypted setting, not env.
