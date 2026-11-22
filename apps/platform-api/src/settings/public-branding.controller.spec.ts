import { PublicBrandingController } from './public-branding.controller';

describe('PublicBrandingController', () => {
  const domainConfig = {
    landingUrl: jest.fn().mockReturnValue('https://www.ecomate.bd'),
    getConfig: jest.fn().mockReturnValue({ primaryDomain: 'ecomate.bd' }),
  };

  it('returns only the public branding fields, with nulls for unset images', () => {
    const settings = {
      getBranding: jest.fn().mockReturnValue({
        platformName: 'Acme',
        supportEmail: 'help@acme.test',
        logoUrl: '',
        faviconUrl: 'https://cdn.acme.test/favicon.png',
      }),
    };
    const controller = new PublicBrandingController(
      settings as any,
      domainConfig as any,
    );

    expect(controller.branding()).toEqual({
      platformName: 'Acme',
      logoUrl: null,
      faviconUrl: 'https://cdn.acme.test/favicon.png',
    });
  });

  it('returns the public landing settings (locale + indexing flag + domains)', () => {
    const settings = {
      getLanding: jest.fn().mockReturnValue({
        defaultLocale: 'bn',
        seoIndexingEnabled: false,
        seoIndexingSource: 'env',
      }),
    };
    const controller = new PublicBrandingController(
      settings as any,
      domainConfig as any,
    );

    expect(controller.landingSettings()).toEqual({
      defaultLocale: 'bn',
      seoIndexingEnabled: false,
      landingUrl: 'https://www.ecomate.bd',
      tenantDomain: 'ecomate.bd',
    });
  });
});
