/**
 * normalizeProduct mapping table (§8.1) — WooCommerce product import.
 *
 * Pure-function tests: every row of the §8.1 mapping, the stock rule (R4),
 * the 10-image cap (R5), the HTML strip, and the unsupported-type gate.
 */
import {
  IMPORT_IMAGE_CAP,
  normalizeProduct,
  stripUnsafeHtml,
} from '../normalize-product';

function woo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 101,
    name: 'Blue Panjabi',
    slug: 'blue-panjabi',
    sku: 'BP-001',
    type: 'simple',
    status: 'publish',
    regular_price: '1200',
    sale_price: '999',
    description: '<p>A fine panjabi.</p>',
    short_description: 'Fine panjabi',
    categories: [{ id: 5, name: 'Panjabi', slug: 'panjabi' }],
    tags: [{ id: 7, name: 'Eid' }],
    images: [{ id: 1, src: 'https://woo.test/img1.jpg', alt: 'front' }],
    attributes: [],
    variations: [],
    manage_stock: true,
    stock_quantity: 12,
    stock_status: 'instock',
    weight: '0.5',
    dimensions: { length: '30', width: '20', height: '2' },
    date_created: '2026-11-20T10:00:00',
    date_modified: '2026-11-22T10:00:00',
    permalink: 'https://woo.test/product/blue-panjabi/',
    ...overrides,
  };
}

describe('normalizeProduct (§8.1)', () => {
  it('maps the full simple-product shape', () => {
    const out = normalizeProduct(woo(), [], { publishMode: 'draft', stockTick: true });
    expect(out.externalId).toBe('101');
    expect(out.name).toBe('Blue Panjabi');
    expect(out.slug).toBe('blue-panjabi');
    expect(out.sku).toBe('BP-001');
    expect(out.skuGenerated).toBe(false);
    expect(out.basePrice).toBe(1200);
    expect(out.salePrice).toBe(999);
    expect(out.status).toBe('draft');
    expect(out.isActive).toBe(false);
    expect(out.categories).toEqual([{ name: 'Panjabi', slug: 'panjabi', externalId: '5' }]);
    expect(out.tags).toEqual(['Eid']);
    expect(out.images).toEqual([{ src: 'https://woo.test/img1.jpg', alt: 'front' }]);
    expect(out.stock).toEqual({ manageStock: true, quantity: 12, stockStatus: 'instock' });
    expect(out.remoteStatus).toBe('publish');
    expect(out.supported).toBe(true);
  });

  it('falls back name → slug → woo-{id}', () => {
    expect(normalizeProduct(woo({ name: '', slug: 'fallback-slug' })).name).toBe('fallback-slug');
    expect(normalizeProduct(woo({ name: '', slug: '' })).name).toBe('woo-101');
  });

  it('generates woo-{id} SKU when the remote SKU is empty (D4)', () => {
    const out = normalizeProduct(woo({ sku: '  ' }));
    expect(out.sku).toBe('woo-101');
    expect(out.skuGenerated).toBe(true);
  });

  it.each([
    ['publish + active mode → active', 'publish', 'active', 'active', true],
    ['publish + draft mode → draft', 'publish', 'draft', 'draft', false],
    ['draft remote + active mode → draft', 'draft', 'active', 'draft', false],
    ['private remote + active mode → draft', 'private', 'active', 'draft', false],
  ])('%s', (_label, remoteStatus, mode, status, isActive) => {
    const out = normalizeProduct(
      woo({ status: remoteStatus }),
      [],
      { publishMode: mode as 'draft' | 'active', stockTick: true },
    );
    expect(out.status).toBe(status);
    expect(out.isActive).toBe(isActive);
  });

  it('parses prices as numbers; empty sale price → null; negative → 0', () => {
    const out = normalizeProduct(woo({ regular_price: '250.50', sale_price: '' }));
    expect(out.basePrice).toBe(250.5);
    expect(out.salePrice).toBeNull();
    expect(normalizeProduct(woo({ regular_price: '-5' })).basePrice).toBe(0);
    expect(normalizeProduct(woo({ regular_price: '' })).basePrice).toBe(0);
  });

  it('sends weight/dimensions to seoMeta, NEVER weightGram', () => {
    const out = normalizeProduct(woo());
    expect(out.seoMeta.weight).toBe('0.5');
    expect(out.seoMeta.length).toBe('30');
    expect(out.seoMeta.width).toBe('20');
    expect(out.seoMeta.height).toBe('2');
    expect('weightGram' in out).toBe(false);
  });

  it('does NOT import cost price or SEO (§8.4)', () => {
    const out = normalizeProduct(
      woo({
        meta_data: [
          { key: '_cost', value: '500' },
          { key: '_yoast_wpseo_title', value: 'Buy Blue Panjabi' },
        ],
      }),
    );
    expect('standardCost' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('500');
    expect(JSON.stringify(out.seoMeta)).not.toContain('Buy Blue Panjabi');
  });

  it('caps images at 10 and reports the cap (R5)', () => {
    const images = Array.from({ length: 12 }, (_, i) => ({
      id: i,
      src: `https://woo.test/img${i}.jpg`,
      alt: null,
    }));
    const out = normalizeProduct(woo({ images }));
    expect(out.images).toHaveLength(IMPORT_IMAGE_CAP);
    expect(out.images).toHaveLength(10);
    expect(out.imagesCapped).toBe(true);
    expect(out.imageTotal).toBe(12);
    expect(out.images[0]!.src).toBe('https://woo.test/img0.jpg');
  });

  it('drops empty image sources', () => {
    const out = normalizeProduct(
      woo({ images: [{ src: '' }, { src: 'https://woo.test/ok.jpg', alt: '' }] }),
    );
    expect(out.images).toEqual([{ src: 'https://woo.test/ok.jpg', alt: null }]);
  });

  it('maps variation attributes as axes, non-variation attributes to seoMeta', () => {
    const out = normalizeProduct(
      woo({
        attributes: [
          { name: 'Size', options: ['M', 'L'], variation: true, visible: true },
          { name: 'Material', options: ['Cotton'], variation: false, visible: true },
        ],
      }),
    );
    expect(out.attributes).toHaveLength(2);
    expect(out.seoMeta.attributes).toEqual([{ name: 'Material', values: ['Cotton'] }]);
  });

  it('maps variations: generated SKU, stock, attributes, image', () => {
    const out = normalizeProduct(
      woo({ type: 'variable' }),
      [
        {
          id: 201,
          sku: '',
          regular_price: '1300',
          sale_price: '',
          manage_stock: true,
          stock_quantity: 3,
          status: 'publish',
          attributes: [{ name: 'Size', option: 'M' }],
          image: { src: 'https://woo.test/var.jpg' },
        },
        {
          id: 202,
          sku: 'BP-001-L',
          regular_price: '1400',
          sale_price: '1299',
          manage_stock: false,
          attributes: [{ name: 'Size', option: 'L' }],
        },
      ],
      { publishMode: 'draft', stockTick: true },
    );
    expect(out.variants).toHaveLength(2);
    expect(out.variants[0]).toMatchObject({
      externalId: '201',
      sku: 'woo-101-201',
      skuGenerated: true,
      price: 1300,
      salePrice: null,
      manageStock: true,
      stockQuantity: 3,
      attributes: [{ name: 'Size', value: 'M' }],
      imageSrc: 'https://woo.test/var.jpg',
    });
    expect(out.variants[1]).toMatchObject({
      sku: 'BP-001-L',
      skuGenerated: false,
      manageStock: false,
      stockQuantity: 0,
      salePrice: 1299,
      imageSrc: null,
    });
  });

  it('stock tick OFF seeds nothing (R4)', () => {
    const out = normalizeProduct(woo(), [], { publishMode: 'draft', stockTick: false });
    expect(out.stock).toEqual({ manageStock: false, quantity: 0, stockStatus: 'instock' });
  });

  it('untracked remote stock → unmanaged locally, even when out of stock', () => {
    const out = normalizeProduct(woo({ manage_stock: false, stock_quantity: 0, stock_status: 'outofstock' }));
    expect(out.stock).toEqual({ manageStock: false, quantity: 0, stockStatus: 'outofstock' });
  });

  it('reads brand from brands[] and from the _ecomate_brand push marker', () => {
    expect(normalizeProduct(woo({ brands: [{ name: 'Aarong' }] })).brandName).toBe('Aarong');
    expect(
      normalizeProduct(woo({ meta_data: [{ key: '_ecomate_brand', value: 'Ecstasy' }] })).brandName,
    ).toBe('Ecstasy');
    expect(normalizeProduct(woo()).brandName).toBeNull();
  });

  it('marks grouped/external products unsupported (§8.6)', () => {
    expect(normalizeProduct(woo({ type: 'grouped' })).supported).toBe(false);
    expect(normalizeProduct(woo({ type: 'external' })).supported).toBe(false);
    expect(normalizeProduct(woo({ type: 'variable' })).supported).toBe(true);
  });
});

describe('stripUnsafeHtml', () => {
  it('removes script blocks, event handlers and javascript: URLs', () => {
    const dirty =
      '<p onclick="steal()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>';
    const clean = stripUnsafeHtml(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
    expect(clean).toContain('<p>Hi</p>');
    expect(clean).toContain('<a href="alert(1)">x</a>');
  });

  it('leaves benign markup alone', () => {
    expect(stripUnsafeHtml('<p><strong>Fine</strong> panjabi</p>')).toBe(
      '<p><strong>Fine</strong> panjabi</p>',
    );
  });
});
