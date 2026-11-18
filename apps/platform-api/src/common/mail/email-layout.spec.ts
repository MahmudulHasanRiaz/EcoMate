import {
  escapeHtml,
  link,
  para,
  renderDetails,
  renderEmailLayout,
  type EmailBrand,
} from './email-layout';

const BRAND: EmailBrand = {
  platformName: 'EcoMate',
  supportEmail: 'support@ecomate.bd',
  logoUrl: '',
};

describe('escapeHtml', () => {
  it('escapes all five HTML-special characters', () => {
    expect(escapeHtml(`<a href="x">&'y'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&#39;&lt;/a&gt;',
    );
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Acme Store 123')).toBe('Acme Store 123');
  });
});

describe('para / link / renderDetails', () => {
  it('wraps a paragraph with email-safe margins', () => {
    expect(para('Hi,')).toBe('<p style="margin:0 0 12px 0;">Hi,</p>');
  });

  it('renders an accent link with escaped url and label', () => {
    const html = link('https://x.test/a?b=1&c=2', 'Open <here>');
    expect(html).toContain('href="https://x.test/a?b=1&amp;c=2"');
    expect(html).toContain('>Open &lt;here&gt;</a>');
    expect(html).toContain('color:#4f46e5');
  });

  it('renders a details box with escaped labels and values', () => {
    const html = renderDetails([
      { label: 'Invoice', value: 'INV-1' },
      { label: 'Note', value: '<b>not bold</b> & "quoted"' },
    ]);
    expect(html).toContain('Invoice');
    expect(html).toContain('INV-1');
    expect(html).toContain('&lt;b&gt;not bold&lt;/b&gt; &amp; &quot;quoted&quot;');
    expect(html).not.toContain('<b>not bold</b>');
    expect(html).toContain('background-color:#f9fafb');
  });
});

describe('renderEmailLayout', () => {
  const base = {
    brand: BRAND,
    heading: 'Hello',
    bodyHtml: para('Body text.'),
  };

  it('is table-based, inline-CSS only, and capped at 600px', () => {
    const html = renderEmailLayout(base);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<table');
    expect(html).toContain('max-width:600px');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('data:');
  });

  it('renders the heading, body and a hidden preheader', () => {
    const html = renderEmailLayout({
      ...base,
      heading: 'Your <store> is ready & waiting',
      preheader: 'Preview line here.',
    });
    expect(html).toContain('Your &lt;store&gt; is ready &amp; waiting');
    expect(html).not.toContain('Your <store> is ready');
    expect(html).toContain('Preview line here.');
    expect(html).toContain('mso-hide:all');
  });

  it('renders one indigo CTA button plus a plain-text fallback link', () => {
    const html = renderEmailLayout({
      ...base,
      cta: {
        label: 'Verify email',
        url: 'https://x.test/verify?token=abc&next=1',
      },
    });
    expect(html).toContain('bgcolor="#4f46e5"');
    expect(html).toContain('padding:12px 24px');
    expect(html).toContain('>Verify email</a>');
    expect(html).toContain('href="https://x.test/verify?token=abc&amp;next=1"');
    expect(html).toContain('copy and paste this link');
    expect(html).toContain('word-break:break-all');
  });

  it('omits the CTA block entirely when there is no call to action', () => {
    const html = renderEmailLayout(base);
    expect(html).not.toContain('copy and paste this link');
    // The button's padding is the CTA marker: the header wordmark also
    // uses the indigo bgcolor, so bgcolor alone cannot tell them apart.
    expect(html).not.toContain('padding:12px 24px');
  });

  it('escapes the CTA label and url', () => {
    const html = renderEmailLayout({
      ...base,
      cta: { label: 'Click <me>', url: 'https://x.test/?q="x"' },
    });
    expect(html).toContain('Click &lt;me&gt;');
    expect(html).toContain('href="https://x.test/?q=&quot;x&quot;"');
  });

  it('renders a text wordmark (initial mark + name) with no logo', () => {
    const html = renderEmailLayout(base);
    expect(html).not.toContain('<img');
    expect(html).toContain('>E</td>');
    expect(html).toContain('>EcoMate</td>');
  });

  it('renders the logo image only for an https URL', () => {
    const html = renderEmailLayout({
      ...base,
      brand: { ...BRAND, logoUrl: 'https://cdn.ecomate.bd/logo.png' },
    });
    expect(html).toContain(
      '<img src="https://cdn.ecomate.bd/logo.png" alt="EcoMate"',
    );
    expect(html).not.toContain('>E</td>');
  });

  it('falls back to the text wordmark for data:, http: and junk logo URLs', () => {
    for (const logoUrl of [
      'data:image/png;base64,iVBORw0KGgo=',
      'http://cdn.ecomate.bd/logo.png',
      '//cdn.ecomate.bd/logo.png',
      'https://cdn.ecomate.bd/logo with space.png',
      'javascript:alert(1)',
    ]) {
      const html = renderEmailLayout({
        ...base,
        brand: { ...BRAND, logoUrl },
      });
      expect(html).not.toContain('<img');
      expect(html).not.toContain('data:');
      expect(html).toContain('>EcoMate</td>');
    }
  });

  it('renders a restrained footer with the year, platform name and help line', () => {
    const html = renderEmailLayout(base);
    expect(html).toContain(`&copy; ${new Date().getFullYear()} EcoMate.`);
    expect(html).toContain('mailto:support@ecomate.bd');
    expect(html).toContain('Questions?');
    expect(html).not.toContain('facebook');
    expect(html).not.toContain('twitter');
    expect(html).not.toContain('instagram');
  });

  it('omits the help line when no support email is configured', () => {
    const html = renderEmailLayout({
      ...base,
      brand: { ...BRAND, supportEmail: '' },
    });
    expect(html).toContain(`&copy; ${new Date().getFullYear()} EcoMate.`);
    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('Questions?');
  });
});
