/**
 * P0 payload proof: once PushMediaService has absolutized + verified the
 * images, every provider maps primaryImage/galleryImages verbatim into
 * `images: [{ src }]` — so the absolute faah.net URL is what Woo,
 * Shopify and the custom bridge actually send.
 */
import { wooFieldToPayload } from '../../providers/woocommerce.provider';
import { shopifyFieldToPayload } from '../../providers/shopify.provider';
import { bridgeFieldToPayload } from '../../providers/custom-bridge.provider';

const ABS_PRIMARY = 'https://features-test-store.staging.faah.net/uploads/a.jpg';
const ABS_GALLERY = 'https://features-test-store.staging.faah.net/uploads/b.jpg';
const INPUT = { primaryImage: ABS_PRIMARY, galleryImages: [ABS_GALLERY] };
const EXPECTED = [{ src: ABS_PRIMARY }, { src: ABS_GALLERY }];

describe('push media payloads (P0)', () => {
  it('Woo sends the absolute URLs as images[{src}]', () => {
    expect(wooFieldToPayload(INPUT).images).toEqual(EXPECTED);
  });

  it('Shopify sends the absolute URLs as images[{src}]', () => {
    expect(shopifyFieldToPayload(INPUT).images).toEqual(EXPECTED);
  });

  it('custom bridge sends the absolute URLs as images[{src}]', () => {
    expect(
      bridgeFieldToPayload(INPUT, { media: true } as any).images,
    ).toEqual(EXPECTED);
  });

  it('bridge with media capability off sends no images key', () => {
    expect(
      bridgeFieldToPayload(INPUT, { media: false } as any).images,
    ).toBeUndefined();
  });

  it('an imageless push (all images dropped) sends no images key anywhere', () => {
    const imageless = { primaryImage: null, galleryImages: [] };
    expect(wooFieldToPayload(imageless).images).toBeUndefined();
    expect(shopifyFieldToPayload(imageless).images).toBeUndefined();
    expect(
      bridgeFieldToPayload(imageless, { media: true } as any).images,
    ).toBeUndefined();
  });
});
