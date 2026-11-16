import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

export interface InvoicePdfLine {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface InvoicePdfPayment {
  amount: number;
  receivedAt: Date | string;
  reference?: string | null;
}

export interface InvoicePdfData {
  number: string;
  status: string;
  tenantName: string;
  tenantSlug: string;
  ownerEmail: string;
  createdAt: Date | string;
  dueAt: Date | string;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  lines: InvoicePdfLine[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  currency: string;
  payments: InvoicePdfPayment[];
  creditAmount: number;
  platformName: string;
  supportEmail: string;
}

const DHAKA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatDate(value: Date | string): string {
  return DHAKA_DATE.format(new Date(value));
}

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Renders an invoice as a PDF. A PAID invoice doubles as the receipt: it
 * shows the payments applied and a PAID stamp. Pure rendering — no Prisma,
 * so the unit test feeds it a plain object.
 */
@Injectable()
export class InvoicePdfService {
  async render(data: InvoicePdfData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const paid = data.status === 'PAID';
    doc.fontSize(20).text(data.platformName, { align: 'left' });
    doc
      .fontSize(11)
      .fillColor('#555555')
      .text(paid ? 'RECEIPT' : 'INVOICE', { align: 'left' })
      .fillColor('#000000');
    doc.moveDown();

    doc.fontSize(12).text(`Invoice ${data.number}`);
    doc.fontSize(10).text(`Issued: ${formatDate(data.createdAt)}`);
    doc.text(`Due: ${formatDate(data.dueAt)}`);
    if (data.periodStart && data.periodEnd) {
      doc.text(
        `Period: ${formatDate(data.periodStart)} — ${formatDate(data.periodEnd)}`,
      );
    }
    doc.moveDown();
    doc.text(`Billed to: ${data.tenantName} (${data.tenantSlug})`);
    doc.text(`Email: ${data.ownerEmail}`);
    doc.moveDown();

    if (paid) {
      doc
        .fontSize(16)
        .fillColor('#1a7f37')
        .text('PAID', { align: 'right' })
        .fillColor('#000000')
        .fontSize(10);
      doc.moveDown(0.5);
    }

    // Lines table (fixed columns, no external table lib).
    const left = 50;
    const qtyX = 380;
    const unitX = 430;
    const amountX = 500;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Description', left, doc.y);
    doc.text('Qty', qtyX, doc.y, { width: 40, align: 'right' });
    doc.text('Unit price', unitX, doc.y, { width: 60, align: 'right' });
    doc.text('Amount', amountX, doc.y, { width: 70, align: 'right' });
    doc.moveDown(0.5);
    doc
      .moveTo(left, doc.y)
      .lineTo(570, doc.y)
      .stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica');
    for (const line of data.lines) {
      const y = doc.y;
      doc.text(line.description, left, y, { width: 320 });
      doc.text(String(line.quantity), qtyX, y, { width: 40, align: 'right' });
      doc.text(money(line.unitPrice, data.currency), unitX, y, {
        width: 60,
        align: 'right',
      });
      doc.text(money(line.amount, data.currency), amountX, y, {
        width: 70,
        align: 'right',
      });
      doc.moveDown(0.5);
    }
    doc.moveDown(0.5);
    doc
      .moveTo(left, doc.y)
      .lineTo(570, doc.y)
      .stroke();
    doc.moveDown(0.5);

    const totalRow = (label: string, value: string, bold = false) => {
      const y = doc.y;
      if (bold) doc.font('Helvetica-Bold');
      doc.text(label, unitX - 80, y, { width: 130, align: 'right' });
      doc.text(value, amountX, y, { width: 70, align: 'right' });
      if (bold) doc.font('Helvetica');
      doc.moveDown(0.5);
    };
    totalRow('Subtotal', money(data.subtotal, data.currency));
    if (data.discount > 0) {
      totalRow('Discount', `-${money(data.discount, data.currency)}`);
    }
    if (data.tax > 0) {
      totalRow('Tax', money(data.tax, data.currency));
    }
    totalRow('Total', money(data.total, data.currency), true);
    if (data.creditAmount > 0) {
      totalRow('Credit applied', `-${money(data.creditAmount, data.currency)}`);
    }
    for (const payment of data.payments) {
      totalRow(
        `Paid ${formatDate(payment.receivedAt)}${payment.reference ? ` (${payment.reference})` : ''}`,
        `-${money(payment.amount, data.currency)}`,
      );
    }
    const remaining = Math.max(
      0,
      data.total -
        data.creditAmount -
        data.payments.reduce((sum, p) => sum + p.amount, 0),
    );
    totalRow('Amount due', money(remaining, data.currency), true);

    doc.moveDown(2);
    doc
      .fontSize(9)
      .fillColor('#555555')
      .text(
        `Questions about this invoice? Contact ${data.supportEmail}.`,
        { align: 'center' },
      );
    doc.end();
    return done;
  }
}
