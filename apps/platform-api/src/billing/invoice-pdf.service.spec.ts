import * as zlib from 'zlib';
import { InvoicePdfService, type InvoicePdfData } from './invoice-pdf.service';

/**
 * pdfkit Flate-compresses content streams and writes text as hex strings
 * inside TJ arrays, so inflate the streams and decode the hex before
 * asserting on visible text.
 */
function pdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  const inflated = streams
    .map((match) => {
      try {
        return zlib
          .inflateSync(Buffer.from(match[1], 'latin1'))
          .toString('latin1');
      } catch {
        return match[1];
      }
    })
    .join('\n');
  // pdfkit splits one visible string into several hex fragments separated
  // by kerning numbers inside TJ arrays, so join the decoded fragments in
  // document order instead of matching the raw stream text.
  const fragments = [...inflated.matchAll(/<([0-9a-fA-F]+)>/g)].map(
    (match) => Buffer.from(match[1], 'hex').toString('latin1'),
  );
  const literals = [...inflated.matchAll(/\(([^()\\]*)\)/g)].map(
    (match) => match[1],
  );
  return `${fragments.join('')}\n${literals.join(' ')}`;
}

function baseData(overrides: Partial<InvoicePdfData> = {}): InvoicePdfData {
  return {
    number: 'INV-2611-0001',
    status: 'OPEN',
    tenantName: 'Acme',
    tenantSlug: 'acme',
    ownerEmail: 'owner@acme.test',
    createdAt: new Date('2026-11-16T00:00:00.000Z'),
    dueAt: new Date('2026-11-23T00:00:00.000Z'),
    lines: [
      { description: 'Growth plan — monthly', quantity: 1, unitPrice: 1000, amount: 1000 },
    ],
    subtotal: 1000,
    discount: 0,
    tax: 150,
    total: 1150,
    currency: 'BDT',
    payments: [],
    creditAmount: 0,
    platformName: 'EcoMate',
    supportEmail: 'support@ecomate.bd',
    ...overrides,
  };
}

describe('InvoicePdfService', () => {
  it('renders a valid PDF that names the invoice and the tenant', async () => {
    const service = new InvoicePdfService();
    const buffer = await service.render(baseData());

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const text = pdfText(buffer);
    expect(text).toContain('INV-2611-0001');
    expect(text).toContain('Acme');
  });

  it('marks a paid invoice and lists its payments (receipt)', async () => {
    const service = new InvoicePdfService();
    const buffer = await service.render(
      baseData({
        status: 'PAID',
        payments: [
          {
            amount: 1150,
            currency: 'BDT',
            receivedAt: new Date('2026-11-17T00:00:00.000Z'),
            methodName: 'bKash',
            reference: 'TX-99',
          },
        ],
      }),
    );

    const text = pdfText(buffer);
    expect(text).toContain('PAID');
    expect(text).toContain('TX-99');
  });
});
