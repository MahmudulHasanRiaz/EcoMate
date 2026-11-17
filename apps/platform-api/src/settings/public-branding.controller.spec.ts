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
});
