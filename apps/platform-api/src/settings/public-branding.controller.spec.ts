import { PublicBrandingController } from './public-branding.controller';

describe('PublicBrandingController', () => {
  it('returns only the public branding fields, with nulls for unset images', () => {
    const settings = {
      getBranding: jest.fn().mockReturnValue({
        platformName: 'Acme',
        supportEmail: 'help@acme.test',
        logoUrl: '',
        faviconUrl: 'https://cdn.acme.test/favicon.png',
      }),
    };
    const controller = new PublicBrandingController(settings as any);

    expect(controller.branding()).toEqual({
      platformName: 'Acme',
      logoUrl: null,
      faviconUrl: 'https://cdn.acme.test/favicon.png',
    });
  });

  it('returns the public landing settings (locale + indexing flag)', () => {
    const settings = {
      getLanding: jest.fn().mockReturnValue({
        defaultLocale: 'bn',
        seoIndexingEnabled: false,
        seoIndexingSource: 'env',
      }),
    };
    const controller = new PublicBrandingController(settings as any);

    expect(controller.landingSettings()).toEqual({
      defaultLocale: 'bn',
      seoIndexingEnabled: false,
    });
  });
});
