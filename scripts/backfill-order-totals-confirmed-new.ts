import prisma from '../src/lib/prisma';

type Args = {
  apply: boolean;
  limit?: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (const raw of argv) {
    if (raw === '--apply') args.apply = true;
    if (raw.startsWith('--limit=')) {
      const n = Number(raw.split('=')[1]);
      if (Number.isFinite(n) && n > 0) args.limit = Math.floor(n);
    }
  }
  return args;
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nearlyEqual(a: number, b: number, epsilon = 0.01): boolean {
  return Math.abs(a - b) <= epsilon;
}

function computeSiteDiscountTotal(products: Array<{ siteDiscount: unknown }>): number {
  return round2(products.reduce((sum, p) => sum + toNumber(p.siteDiscount), 0));
}

function computeExpectedTotal(order: {
  shipping: unknown;
  discount: unknown;
  products: Array<{ price: unknown; quantity: unknown; siteDiscount: unknown }>;
}): number {
  const subtotal = order.products.reduce(
    (sum, p) => sum + toNumber(p.price) * toNumber(p.quantity),
    0
  );
  const siteDiscountTotal = order.products.reduce(
    (sum, p) => sum + toNumber(p.siteDiscount),
    0
  );
  const total = subtotal + toNumber(order.shipping) - toNumber(order.discount) - siteDiscountTotal;
  return round2(total);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const statuses = ['New', 'Confirmed'] as const;
  const batchSize = 500;

  let scanned = 0;
  let mismatched = 0;
  let updated = 0;
  let confirmedDiscountNormalized = 0;
  let cursorId: string | undefined;
  let stoppedByLimit = false;

  console.log('--- Backfill Order Totals (New + Confirmed) ---');
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);
  if (args.limit) console.log(`Limit: ${args.limit}`);

  while (true) {
    const rows = await prisma.order.findMany({
      where: { status: { in: [...statuses] as any } },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: {
        id: true,
        orderNumber: true,
        status: true,
        total: true,
        shipping: true,
        discount: true,
        products: {
          select: {
            price: true,
            quantity: true,
            siteDiscount: true,
          },
        },
      },
    });

    if (rows.length === 0) break;
    cursorId = rows[rows.length - 1]?.id;

    for (const row of rows) {
      scanned += 1;
      const currentTotal = round2(toNumber(row.total));
      const currentDiscount = round2(toNumber(row.discount));
      const siteDiscountTotal = computeSiteDiscountTotal(row.products);

      // Cleanup rule requested:
      // For Confirmed orders, if main discount duplicates site discount exactly,
      // zero out main discount and keep site discount only.
      const shouldNormalizeConfirmedDiscount =
        row.status === 'Confirmed' &&
        siteDiscountTotal > 0 &&
        nearlyEqual(currentDiscount, siteDiscountTotal);

      const effectiveDiscount = shouldNormalizeConfirmedDiscount ? 0 : currentDiscount;
      const expected = computeExpectedTotal({
        ...row,
        discount: effectiveDiscount,
      });
      const delta = Math.abs(expected - currentTotal);
      if (delta <= 0.009) {
        if (shouldNormalizeConfirmedDiscount && args.apply) {
          await prisma.order.update({
            where: { id: row.id },
            data: { discount: 0 },
          });
          confirmedDiscountNormalized += 1;
        }
        if (args.limit && scanned >= args.limit) {
          stoppedByLimit = true;
          break;
        }
        continue;
      }

      mismatched += 1;
      console.log(
        `[MISMATCH] ${row.id} (${row.orderNumber || '-'}) status=${row.status} total=${currentTotal.toFixed(
          2
        )} expected=${expected.toFixed(2)} discount=${currentDiscount.toFixed(2)} siteDiscount=${siteDiscountTotal.toFixed(2)}${shouldNormalizeConfirmedDiscount ? ' [CONFIRMED_DISCOUNT_NORMALIZE]' : ''}`
      );

      if (args.apply) {
        await prisma.order.update({
          where: { id: row.id },
          data: {
            total: expected,
            ...(shouldNormalizeConfirmedDiscount ? { discount: 0 } : {}),
          },
        });
        updated += 1;
        if (shouldNormalizeConfirmedDiscount) confirmedDiscountNormalized += 1;
      }

      if (args.limit && scanned >= args.limit) {
        stoppedByLimit = true;
        break;
      }
    }

    if (stoppedByLimit) break;
  }

  console.log('');
  console.log(`Scanned: ${scanned}`);
  console.log(`Mismatched: ${mismatched}`);
  console.log(`Updated: ${updated}`);
  console.log(`Confirmed discount normalized: ${confirmedDiscountNormalized}`);
  if (!args.apply) {
    console.log('Dry run complete. Use --apply to persist changes.');
  }
}

main()
  .catch((err) => {
    console.error('[BACKFILL_ORDER_TOTALS_ERROR]', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
