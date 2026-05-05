import fs from 'fs';
import path from 'path';

type RawRow = Record<string, string>;

type NormalizedRow = {
  sourceFile: string;
  rowIndex: number;
  merchantOrderId: string;
  consignmentId: string;
  deliveryStatusRaw: string;
  normalizedKind: '' | 'delivered' | 'partial' | 'return';
  deliveredDate?: Date | null;
  invoicedDate?: Date | null;
  invoiceNumber?: string | null;
  // "Most columns with data" (per your requirement) for dedup.
  filledScore: number;
  // Secondary tie-breaker when filledScore is equal.
  priorityScore: number;
  raw: RawRow;
};

type PayloadRow = {
  merchantOrderId: string;
  consignmentId: string;
  deliveryStatus: string;
  deliveredDate?: string | null;
  invoicedDate?: string | null;
  invoiceNumber?: string | null;
  sourceFile?: string | null;
  rowIndex?: number | null;
  filledScore?: number | null;
  priorityScore?: number | null;
};

type PayloadFile = {
  generatedAt: string;
  source: 'carrybee-invoice-csv';
  dir: string;
  files: string[];
  orders: PayloadRow[];
};

type RunResult = {
  startedAt: string;
  mode: 'dry-run' | 'apply';
  dir: string;
  files: string[];
  totalRowsParsed: number;
  uniqueOrdersInSheets: number;
  updatedStatus: number;
  updatedConsignment: number;
  skippedNoChange: number;
  skippedFinalStatus: number;
  notFound: number;
  invalidRows: number;
  details: Array<{
    merchantOrderId: string;
    orderId?: string;
    action: 'UPDATED' | 'SKIPPED' | 'NOT_FOUND' | 'INVALID';
    reason?: string;
    before?: any;
    after?: any;
    chosenFrom?: { file: string; rowIndex: number; score: number };
  }>;
};

function getArgValue(prefix: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  if (!arg) return undefined;
  const idx = arg.indexOf('=');
  return idx >= 0 ? arg.slice(idx + 1) : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function findField(row: RawRow, target: string): string {
  const targetLower = target.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase().trim() === targetLower) return row[key] || '';
  }
  return '';
}

function parseDateSafe(value?: string | null): Date | null {
  const v = (value || '').toString().trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function normalizeStatusKind(raw: string): '' | 'delivered' | 'partial' | 'return' {
  if (!raw) return '';
  const s = raw.toLowerCase().trim();
  if (s === 'delivery' || s === 'delivered') return 'delivered';
  if (s === 'partial_delivery' || s === 'partial-delivery' || s === 'partial') return 'partial';
  if (
    s === 'return' ||
    s === 'returned' ||
    s === 'return_pending' ||
    s === 'return-pending' ||
    s === 'returned_to_merchant' ||
    s === 'returned-to-merchant' ||
    s === 'paid_return' ||
    s === 'paid-return' ||
    s === 'exchange'
  ) {
    return 'return';
  }
  return '';
}

function countFilledCells(row: RawRow): number {
  let filled = 0;
  for (const val of Object.values(row)) {
    if (val !== null && val !== undefined && String(val).trim() !== '') filled += 1;
  }
  return filled;
}

function computePriorityScore(row: RawRow): number {
  // Used ONLY as a tie-breaker when filledScore is equal.
  const merchantOrderId = findField(row, 'merchant_order_id');
  const consignmentId = findField(row, 'consignment_id');
  const deliveryStatus = findField(row, 'delivery_status');
  const deliveredDate = findField(row, 'delivered_date');
  const invoicedDate = findField(row, 'invoiced_date');
  const invoiceNumber = findField(row, 'invoice_number');

  let weight = 0;
  if (merchantOrderId.trim()) weight += 5;
  if (consignmentId.trim()) weight += 5;
  if (deliveryStatus.trim()) weight += 3;
  if (deliveredDate.trim()) weight += 2;
  if (invoicedDate.trim()) weight += 1;
  if (invoiceNumber.trim()) weight += 1;
  return weight;
}

function isFinalOrderStatus(status?: string | null): boolean {
  return status === 'Returned' || status === 'Paid_Return' || status === 'Damaged';
}

function mapKindToOrderStatus(kind: NormalizedRow['normalizedKind']): string | null {
  if (kind === 'delivered') return 'Delivered';
  if (kind === 'partial') return 'Partial';
  if (kind === 'return') return 'Return_Pending';
  return null;
}

function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function parsePayloadFile(inputPath: string): NormalizedRow[] {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const parsed = JSON.parse(raw);
  const list: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.orders) ? parsed.orders : [];
  return list
    .map((item, idx): NormalizedRow | null => {
      const merchantOrderId = String(item?.merchantOrderId || item?.merchant_order_id || '').trim();
      if (!merchantOrderId) return null;
      const consignmentId = String(item?.consignmentId || item?.consignment_id || '').trim();
      const deliveryStatusRaw = String(item?.deliveryStatus || item?.delivery_status || item?.Delivery_status || '').trim();
      const sourceFile = String(item?.sourceFile || path.basename(inputPath) || 'payload.json');
      const rowIndex = Number(item?.rowIndex || idx + 1) || idx + 1;
      const filledScore = Number(item?.filledScore || 0) || 0;
      const priorityScore = Number(item?.priorityScore || 0) || 0;
      return {
        sourceFile,
        rowIndex,
        merchantOrderId,
        consignmentId,
        deliveryStatusRaw,
        normalizedKind: normalizeStatusKind(deliveryStatusRaw),
        deliveredDate: parseDateSafe(item?.deliveredDate || null),
        invoicedDate: parseDateSafe(item?.invoicedDate || null),
        invoiceNumber: (String(item?.invoiceNumber || '').trim() || null),
        filledScore,
        priorityScore,
        raw: {},
      };
    })
    .filter((x): x is NormalizedRow => Boolean(x));
}

async function main() {
  const dirArg = getArgValue('--dir=') || 'draft/invoice';
  const inputArg = getArgValue('--input=');
  const payloadOnly = hasFlag('--payload-only');
  const payloadOutArg = getArgValue('--payload-out=');
  const payloadOut = resolvePath(payloadOutArg || 'draft/invoice/carrybee_invoice_payload.json');

  const dir = resolvePath(dirArg);
  const inputPath = inputArg ? resolvePath(inputArg) : null;
  const apply = hasFlag('--apply');
  const confirm = getArgValue('--confirm=');
  const writeLog = hasFlag('--write-log');

  if (apply && confirm !== 'CARRYBEE_INVOICE_STATUS_UPDATE') {
    console.error('Refusing to apply without --confirm=CARRYBEE_INVOICE_STATUS_UPDATE');
    process.exit(1);
  }

  if (inputPath && !fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  console.log('=== Carrybee Invoice Sheet -> Order Status Update ===');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  if (inputPath) {
    console.log(`Input: ${inputPath}`);
  } else {
    console.log(`Dir:  ${dir}`);
  }
  console.log(`Write OrderLog: ${writeLog ? 'YES' : 'NO'}`);
  if (!inputPath) console.log(`Payload out: ${payloadOut}`);
  if (!inputPath) console.log(`Payload only: ${payloadOnly ? 'YES' : 'NO'}`);
  if (apply) console.log('CONFIRMED: CARRYBEE_INVOICE_STATUS_UPDATE');

  const parsed: NormalizedRow[] = [];
  let inputFiles: string[] = [];
  if (inputPath) {
    const inputRows = parsePayloadFile(inputPath);
    parsed.push(...inputRows);
    inputFiles = [path.basename(inputPath)];
  } else {
    if (!fs.existsSync(dir)) {
      console.error(`Directory not found: ${dir}`);
      process.exit(1);
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.csv'))
      .map((f) => path.join(dir, f))
      .sort();

    if (files.length === 0) {
      console.error(`No CSV files found in: ${dir}`);
      process.exit(1);
    }

    inputFiles = files.map((f) => path.basename(f));

    // Lazy-load csv parser only when we actually need CSV parsing.
    // This allows production to run in --input mode even if csv-parse isn't installed there.
    let csvParse: any;
    try {
      csvParse = require('csv-parse/sync')?.parse;
    } catch (e: any) {
      console.error('Error: Missing dependency "csv-parse".');
      console.error('If you want to read CSV files on this server, install it then rebuild: npm i csv-parse');
      console.error('Otherwise, run using the JSON payload mode: --input=draft/invoice/carrybee_invoice_payload.json');
      process.exit(1);
    }

    for (const filePath of files) {
      const csvText = fs.readFileSync(filePath, 'utf8');
      const records: RawRow[] = csvParse(csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      });
      records.forEach((row, idx) => {
        const merchantOrderId = findField(row, 'merchant_order_id').trim();
        const consignmentId = findField(row, 'consignment_id').trim();
        const deliveryStatusRaw = findField(row, 'delivery_status').trim();

        if (!merchantOrderId) {
          parsed.push({
            sourceFile: path.basename(filePath),
            rowIndex: idx + 2, // header is row 1
            merchantOrderId: '',
            consignmentId,
            deliveryStatusRaw,
            normalizedKind: '',
            deliveredDate: null,
            invoicedDate: null,
            invoiceNumber: null,
            filledScore: countFilledCells(row),
            priorityScore: computePriorityScore(row),
            raw: row,
          });
          return;
        }

        parsed.push({
          sourceFile: path.basename(filePath),
          rowIndex: idx + 2,
          merchantOrderId,
          consignmentId,
          deliveryStatusRaw,
          normalizedKind: normalizeStatusKind(deliveryStatusRaw),
          deliveredDate: parseDateSafe(findField(row, 'delivered_date')),
          invoicedDate: parseDateSafe(findField(row, 'invoiced_date')),
          invoiceNumber: (findField(row, 'invoice_number') || '').trim() || null,
          filledScore: countFilledCells(row),
          priorityScore: computePriorityScore(row),
          raw: row,
        });
      });
    }
  }

  let invalidRows = 0;

  const rowsByOrder = new Map<string, NormalizedRow[]>();
  for (const row of parsed) {
    if (!row.merchantOrderId) {
      invalidRows += 1;
      continue;
    }
    const list = rowsByOrder.get(row.merchantOrderId) || [];
    list.push(row);
    rowsByOrder.set(row.merchantOrderId, list);
  }

  function pickBestRow(rows: NormalizedRow[]): NormalizedRow {
    return rows
      .slice()
      .sort((a, b) => {
        // Primary: most columns with data
        if (b.filledScore !== a.filledScore) return b.filledScore - a.filledScore;
        // Secondary: prefer rows that include key fields (consignment/status/dates)
        if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
        // Tertiary: latest delivered/invoiced date
        const ad = a.deliveredDate?.getTime?.() || 0;
        const bd = b.deliveredDate?.getTime?.() || 0;
        if (bd !== ad) return bd - ad;
        const ai = a.invoicedDate?.getTime?.() || 0;
        const bi = b.invoicedDate?.getTime?.() || 0;
        if (bi !== ai) return bi - ai;
        // Stable final tie-breaker: file+row
        const af = `${a.sourceFile}#${a.rowIndex}`;
        const bf = `${b.sourceFile}#${b.rowIndex}`;
        return bf.localeCompare(af);
      })[0];
  }

  // If reading CSVs, persist a sanitized payload file so production can run WITHOUT the CSVs.
  if (!inputPath) {
    const payloadOrders: PayloadRow[] = [];
    for (const [merchantOrderId, rows] of rowsByOrder.entries()) {
      const chosen = pickBestRow(rows);
      const bestConsignmentRow = rows.some((r) => Boolean(r.consignmentId))
        ? pickBestRow(rows.filter((r) => Boolean(r.consignmentId)))
        : null;
      const effectiveConsignmentId = (chosen.consignmentId || bestConsignmentRow?.consignmentId || '').trim();
      payloadOrders.push({
        merchantOrderId,
        consignmentId: effectiveConsignmentId,
        deliveryStatus: chosen.deliveryStatusRaw,
        deliveredDate: chosen.deliveredDate ? chosen.deliveredDate.toISOString() : null,
        invoicedDate: chosen.invoicedDate ? chosen.invoicedDate.toISOString() : null,
        invoiceNumber: chosen.invoiceNumber || null,
        sourceFile: chosen.sourceFile,
        rowIndex: chosen.rowIndex,
        filledScore: chosen.filledScore,
        priorityScore: chosen.priorityScore,
      });
    }

    const payload: PayloadFile = {
      generatedAt: new Date().toISOString(),
      source: 'carrybee-invoice-csv',
      dir: dirArg,
      files: inputFiles.slice(),
      orders: payloadOrders,
    };

    fs.mkdirSync(path.dirname(payloadOut), { recursive: true });
    fs.writeFileSync(payloadOut, JSON.stringify(payload, null, 2));
  }

  if (payloadOnly) {
    console.log('');
    console.log('==================================');
    console.log('PAYLOAD ONLY');
    console.log('==================================');
    console.log(`Rows parsed:            ${parsed.length}`);
    console.log(`Invalid rows:           ${invalidRows}`);
    console.log(`Unique orders in sheets:${rowsByOrder.size}`);
    if (!inputPath) console.log(`Payload:               ${payloadOut}`);
    console.log('');
    console.log('No database operations were performed.');
    return;
  }

  const merchantOrderIds = Array.from(rowsByOrder.keys());
  const prisma = (await import('../src/lib/prisma')).default;

  const orders = await prisma.order.findMany({
    where: { orderNumber: { in: merchantOrderIds } },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      statusUpdatedAt: true,
      courierService: true,
      courierStatus: true,
      courierConsignmentId: true,
      courierTrackingCode: true,
      courierDispatchedAt: true,
    },
  });
  const orderByNumber = new Map<string, typeof orders[number]>(orders.map((o) => [o.orderNumber || '', o]));

  const result: RunResult = {
    startedAt: new Date().toISOString(),
    mode: apply ? 'apply' : 'dry-run',
    dir: inputPath ? inputPath : dir,
    files: inputFiles.slice(),
    totalRowsParsed: parsed.length,
    uniqueOrdersInSheets: rowsByOrder.size,
    updatedStatus: 0,
    updatedConsignment: 0,
    skippedNoChange: 0,
    skippedFinalStatus: 0,
    notFound: 0,
    invalidRows,
    details: [],
  };

  const now = new Date();

  for (const [merchantOrderId, rows] of rowsByOrder.entries()) {
    const chosenRow = pickBestRow(rows);
    const bestConsignmentRow = rows.some((r) => Boolean(r.consignmentId))
      ? pickBestRow(rows.filter((r) => Boolean(r.consignmentId)))
      : null;
    const effectiveConsignmentId = (chosenRow.consignmentId || bestConsignmentRow?.consignmentId || '').trim();

    const order = orderByNumber.get(merchantOrderId);
    const chosenFrom = {
      file: chosenRow.sourceFile,
      rowIndex: chosenRow.rowIndex,
      score: chosenRow.filledScore,
    };

    if (!order) {
      result.notFound += 1;
      result.details.push({
        merchantOrderId,
        action: 'NOT_FOUND',
        reason: 'Order not found by orderNumber',
        chosenFrom,
      });
      continue;
    }

    const before = { ...order };
    const updateData: any = {};

    // Always keep courierStatus in sync with the sheet (informational, does not affect stock).
    if (chosenRow.deliveryStatusRaw && chosenRow.deliveryStatusRaw !== order.courierStatus) {
      updateData.courierStatus = chosenRow.deliveryStatusRaw;
    }

    // Consignment: set only if missing (do not overwrite).
    const hasConsignment = Boolean((order.courierConsignmentId || '').trim() || (order.courierTrackingCode || '').trim());
    if (!hasConsignment && effectiveConsignmentId) {
      updateData.courierService = 'Carrybee';
      updateData.courierConsignmentId = effectiveConsignmentId;
      updateData.courierTrackingCode = effectiveConsignmentId;
      updateData.courierDispatchedAt = order.courierDispatchedAt || now;
    }

    // Status mapping (conservative): never downgrade final statuses.
    if (isFinalOrderStatus(order.status)) {
      result.skippedFinalStatus += 1;
    } else {
      const target = mapKindToOrderStatus(chosenRow.normalizedKind);
      if (target && target !== order.status) {
        updateData.status = target as any;
        updateData.statusUpdatedAt = chosenRow.deliveredDate || chosenRow.invoicedDate || now;
      }
    }

    if (Object.keys(updateData).length === 0) {
      result.skippedNoChange += 1;
      result.details.push({ merchantOrderId, orderId: order.id, action: 'SKIPPED', reason: 'No changes needed', chosenFrom });
      continue;
    }

    if (!apply) {
      if (updateData.status) result.updatedStatus += 1;
      if (updateData.courierConsignmentId) result.updatedConsignment += 1;
      result.details.push({
        merchantOrderId,
        orderId: order.id,
        action: 'UPDATED',
        chosenFrom,
        before: {
          status: before.status,
          courierStatus: before.courierStatus,
          courierService: before.courierService,
          courierConsignmentId: before.courierConsignmentId,
          courierTrackingCode: before.courierTrackingCode,
        },
        after: {
          status: updateData.status ?? before.status,
          courierStatus: updateData.courierStatus ?? before.courierStatus,
          courierService: updateData.courierService ?? before.courierService,
          courierConsignmentId: updateData.courierConsignmentId ?? before.courierConsignmentId,
          courierTrackingCode: updateData.courierTrackingCode ?? before.courierTrackingCode,
        },
      });
      continue;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.order.update({ where: { id: order.id }, data: updateData });
      if (writeLog) {
        const from = String(before.status || '');
        const to = String(updateData.status || before.status || '');
        const inv = chosenRow.invoiceNumber ? ` | Invoice=${chosenRow.invoiceNumber}` : '';
        const cons = effectiveConsignmentId ? ` | Consignment=${effectiveConsignmentId}` : '';
        const desc =
          `Source: Carrybee invoice sheet (${chosenRow.sourceFile}#${chosenRow.rowIndex})` +
          ` | Delivery_status=${chosenRow.deliveryStatusRaw}` +
          (from && to && from !== to ? ` | Status: ${from} -> ${to}` : '') +
          inv +
          cons;
        await tx.orderLog.create({
          data: {
            orderId: order.id,
            title: 'Carrybee Invoice Sync',
            description: desc,
            user: 'Invoice Script',
          },
        });
      }
      return saved;
    });

    if (updateData.status) result.updatedStatus += 1;
    if (updateData.courierConsignmentId) result.updatedConsignment += 1;

    result.details.push({
      merchantOrderId,
      orderId: order.id,
      action: 'UPDATED',
      chosenFrom,
      before: {
        status: before.status,
        courierStatus: before.courierStatus,
        courierService: before.courierService,
        courierConsignmentId: before.courierConsignmentId,
        courierTrackingCode: before.courierTrackingCode,
      },
      after: {
        status: updated.status,
        courierStatus: updated.courierStatus,
        courierService: updated.courierService,
        courierConsignmentId: updated.courierConsignmentId,
        courierTrackingCode: updated.courierTrackingCode,
      },
    });
  }

  const outPath = path.join(
    process.cwd(),
    'scripts',
    `_carrybee_invoice_status_update_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log('');
  console.log('==================================');
  console.log('SUMMARY');
  console.log('==================================');
  console.log(`Rows parsed:            ${result.totalRowsParsed}`);
  console.log(`Invalid rows:           ${result.invalidRows}`);
  console.log(`Unique orders in sheets:${result.uniqueOrdersInSheets}`);
  console.log(`Updated status:         ${result.updatedStatus}`);
  console.log(`Updated consignment:    ${result.updatedConsignment}`);
  console.log(`Skipped (no change):    ${result.skippedNoChange}`);
  console.log(`Skipped (final status): ${result.skippedFinalStatus}`);
  console.log(`Not found:              ${result.notFound}`);
  console.log(`Report:                 ${outPath}`);

  if (!apply) {
    console.log('');
    console.log('To apply:');
    if (inputPath) {
      const printableInput = inputArg || 'draft/invoice/carrybee_invoice_payload.json';
      console.log(
        `  npx tsx scripts/update-carrybee-status-from-invoices.ts --input=${printableInput} --apply --confirm=CARRYBEE_INVOICE_STATUS_UPDATE`
      );
    } else {
      console.log(
        '  npx tsx scripts/update-carrybee-status-from-invoices.ts --input=draft/invoice/carrybee_invoice_payload.json --apply --confirm=CARRYBEE_INVOICE_STATUS_UPDATE'
      );
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err?.message || err);
  process.exit(1);
});
