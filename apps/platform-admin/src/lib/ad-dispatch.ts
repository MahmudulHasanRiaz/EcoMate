import type { AdDispatchStatus } from '../types';

/**
 * Ad tracking console helpers (CMS batch 2, item 21). The platform
 * list mirrors the platform-api registry (ad-platforms.ts) — a new
 * platform needs a row in both places (the API is the source of
 * truth for dispatch; this list only drives the console UI).
 */
export interface AdTrackingPlatformDef {
  id: string;
  label: string;
  idLabel: string;
  idPlaceholder: string;
  defaultEventName: string;
  /** Short explainer shown under the platform card. */
  blurb: string;
}

export const AD_TRACKING_PLATFORMS: AdTrackingPlatformDef[] = [
  {
    id: 'meta',
    label: 'Meta',
    idLabel: 'Pixel / dataset ID',
    idPlaceholder: 'e.g. 123456789012345',
    defaultEventName: 'Lead',
    blurb:
      'Sends lead events to the Meta Conversions API (server-side). Needs the pixel/dataset ID and an access token from Meta Events Manager.',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    idLabel: 'Pixel ID',
    idPlaceholder: 'e.g. CXXXXXXXXXXXXXXX',
    defaultEventName: 'SubmitForm',
    blurb:
      'Sends lead events to the TikTok Events API (server-side). Needs the pixel ID and an access token from TikTok Events Manager.',
  },
];

export function adPlatformLabel(platform: string): string {
  return (
    AD_TRACKING_PLATFORMS.find((p) => p.id === platform)?.label ?? platform
  );
}

export const AD_DISPATCH_STATUS_LABELS: Record<AdDispatchStatus, string> = {
  pending: 'Pending',
  sent: 'Sent',
  failed: 'Failed',
};

export function adDispatchStatusLabel(status: string): string {
  return (
    (AD_DISPATCH_STATUS_LABELS as Record<string, string>)[status] ?? status
  );
}

/**
 * Badge tone for a dispatch status, on the console semantic mapping
 * (sent = accent/indigo, pending = warning/amber, failed =
 * danger/red). Deliberately NOT via statusTone() — that maps
 * UPPERCASE domain statuses and has no SENT entry.
 */
export function adDispatchTone(status: string): string {
  if (status === 'sent') return 'accent';
  if (status === 'failed') return 'danger';
  return 'warning';
}
