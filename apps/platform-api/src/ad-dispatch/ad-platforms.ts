/**
 * Ad-platform registry (CMS batch 2, item 21) — the extensibility point
 * for lead ad tracking. A platform is one row here + one sender in
 * ./senders + (for the console) one row in the platform-admin
 * lib/ad-dispatch.ts mirror. Platform ids are stored as plain Strings
 * on AdDispatch and in the ad_tracking setting, so a new platform needs
 * NO migration — only code.
 *
 * Boss approved Meta AND TikTok AND whatever else clients run: never
 * hard-code a platform id anywhere else; always go through this list
 * (settings validation, trigger fan-out, the console section).
 */
export interface AdPlatformDef {
  /** Stable id: the AdDispatch.platform value + ad_tracking setting key. */
  id: string;
  /** Console display label. */
  label: string;
  /** Label for the pixel/dataset id field in the console. */
  idLabel: string;
  idPlaceholder: string;
  /** Default event name when the operator leaves it blank. */
  defaultEventName: string;
  /** Lead capture fields this platform's sender reads. */
  captureFields: string[];
}

export const AD_PLATFORMS: AdPlatformDef[] = [
  {
    id: 'meta',
    label: 'Meta',
    idLabel: 'Pixel / dataset ID',
    idPlaceholder: 'e.g. 123456789012345',
    defaultEventName: 'Lead',
    captureFields: ['fbp', 'fbc', 'eventId'],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    idLabel: 'Pixel ID',
    idPlaceholder: 'e.g. CXXXXXXXXXXXXXXX',
    defaultEventName: 'SubmitForm',
    captureFields: ['ttclid', 'tiktokEventId'],
  },
];

export const AD_PLATFORM_IDS: string[] = AD_PLATFORMS.map((p) => p.id);

export function getAdPlatform(id: string): AdPlatformDef | undefined {
  return AD_PLATFORMS.find((platform) => platform.id === id);
}

export function isKnownAdPlatform(id: unknown): id is string {
  return typeof id === 'string' && AD_PLATFORM_IDS.includes(id);
}
