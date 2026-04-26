import prisma from '@/lib/prisma';

type Mode = 'cancel' | 'delete';
type LeadMode = 'cancel' | 'delete';

function getArg(name: string, fallback?: string) {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  if (!hit) return fallback;
  return hit.slice(pref.length);
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function toInt(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function extractWooExternalId(orderId: string): string | null {
  if (!orderId.startsWith('woo-')) return null;
  const parts = orderId.split('-');
  if (parts.length < 3) return null;
  return parts[parts.length - 1] || null;
}

function statusRank(status: string): number {
  const ranks: Record<string, number> = {
    Delivered: 100,
    Returned: 90,
    Return_Pending: 85,
    Shipped: 80,
    In_Courier: 75,
    RTS__Ready_to_Ship_: 70,
    Confirmed: 60,
    Canceled: 20,
    C2C: 19,
    Hold: 15,
    New: 10,
    Incomplete: 8,
    Incomplete_Cancelled: 5,
    Draft: 1,
  };
  return ranks[status] ?? 0;
}

async function closeOpenLeadsCoveredByOrders(apply: boolean, leadMode: LeadMode) {
  const openLeads = await prisma.wooCheckoutLead.findMany({
    where: {
      status: 'OPEN',
      phoneNormalized: { not: null },
    },
    select: { phoneNormalized: true },
    distinct: ['phoneNormalized'],
  });

  const phones = openLeads.map((l) => l.phoneNormalized).filter(Boolean) as string[];
  if (!phones.length) {
    return { candidatePhones: 0, affectedLeads: 0 };
  }

  const orderPhonesRows = await prisma.order.findMany({
    where: {
      customerPhone: { in: phones },
      status: { notIn: ['Canceled', 'C2C', 'Incomplete_Cancelled'] as any },
    },
    select: { customerPhone: true },
    distinct: ['customerPhone'],
  });

  const coveredPhones = orderPhonesRows.map((r) => r.customerPhone).filter(Boolean);
  if (!coveredPhones.length) {
    return { candidatePhones: 0, affectedLeads: 0 };
  }

  if (!apply) {
    const count = await prisma.wooCheckoutLead.count({
      where: {
        status: 'OPEN',
        phoneNormalized: { in: coveredPhones },
      },
    });
    return { candidatePhones: coveredPhones.length, affectedLeads: count };
  }

  if (leadMode === 'delete') {
    const result = await prisma.wooCheckoutLead.deleteMany({
      where: {
        status: 'OPEN',
        phoneNormalized: { in: coveredPhones },
      },
    });
    return { candidatePhones: coveredPhones.length, affectedLeads: result.count };
  }

  const result = await prisma.wooCheckoutLead.updateMany({
    where: {
      status: 'OPEN',
      phoneNormalized: { in: coveredPhones },
    },
    data: {
      status: 'CANCELLED',
      completedAt: new Date(),
    },
  });

  return { candidatePhones: coveredPhones.length, affectedLeads: result.count };
}

async function cleanupDuplicateWooOrders(apply: boolean, mode: Mode, scanLimit: number) {
  const rows = await prisma.order.findMany({
    where: {
      source: 'woo',
      customerPhone: { not: '' },
      id: { startsWith: 'woo-' },
    },
    orderBy: { createdAt: 'asc' },
    take: scanLimit,
    select: {
      id: true,
      orderNumber: true,
      customerPhone: true,
      status: true,
      createdAt: true,
      isStockDeducted: true,
      isStockReserved: true,
      total: true,
    },
  });

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const ext = extractWooExternalId(row.id);
    if (!ext) continue;
    const key = `${ext}::${row.customerPhone}`;
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const deletableStatuses = new Set(['Draft', 'New', 'Hold', 'Incomplete', 'Incomplete_Cancelled']);
  let duplicateGroups = 0;
  let actionable = 0;
  let changed = 0;
  let failed = 0;
  let skippedStockSensitive = 0;
  let skippedNonDeletable = 0;

  for (const [, bucket] of groups) {
    if (bucket.length <= 1) continue;
    duplicateGroups += 1;

    const sorted = [...bucket].sort((a, b) => {
      const rankDiff = statusRank(b.status) - statusRank(a.status);
      if (rankDiff !== 0) return rankDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const keeper = sorted[0];
    const duplicates = sorted.slice(1);

    for (const dup of duplicates) {
      if (!deletableStatuses.has(String(dup.status))) {
        skippedNonDeletable += 1;
        continue;
      }
      if (dup.isStockDeducted || dup.isStockReserved) {
        skippedStockSensitive += 1;
        continue;
      }

      actionable += 1;
      if (!apply) continue;

      try {
        if (mode === 'delete') {
          await prisma.$transaction(async (tx) => {
            await tx.orderProduct.deleteMany({ where: { orderId: dup.id } });
            await tx.orderLog.deleteMany({ where: { orderId: dup.id } });
            await tx.order.delete({ where: { id: dup.id } });
          });
        } else {
          await prisma.order.update({
            where: { id: dup.id },
            data: {
              status: 'Canceled' as any,
              OrderLog: {
                create: {
                  title: 'Canceled',
                  description: `Auto-canceled duplicate of ${keeper.orderNumber || keeper.id} via cleanup script`,
                  user: 'System',
                },
              },
            } as any,
          });
        }
        changed += 1;
      } catch (err: any) {
        failed += 1;
        console.error('[DUPLICATE_ORDER_FIX_FAIL]', {
          id: dup.id,
          message: err?.message || String(err),
        });
      }
    }
  }

  return {
    scanned: rows.length,
    duplicateGroups,
    actionable,
    changed,
    failed,
    skippedStockSensitive,
    skippedNonDeletable,
  };
}

async function main() {
  const apply = hasFlag('apply');
  const mode = (getArg('mode', 'cancel') as Mode) === 'delete' ? 'delete' : 'cancel';
  const leadMode = (getArg('leadMode', 'delete') as LeadMode) === 'cancel' ? 'cancel' : 'delete';
  const scanLimit = toInt(getArg('scanLimit', '50000'), 50000);

  console.log('--- Woo Duplicate Cleanup ---');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Order duplicate mode: ${mode}`);
  console.log(`Incomplete lead mode: ${leadMode}`);
  console.log(`Scan limit: ${scanLimit}`);

  const leadResult = await closeOpenLeadsCoveredByOrders(apply, leadMode);
  const orderResult = await cleanupDuplicateWooOrders(apply, mode, scanLimit);

  console.log('\n[Incomplete Leads]');
  console.log(`Covered phones: ${leadResult.candidatePhones}`);
  console.log(`Leads affected: ${leadResult.affectedLeads}`);

  console.log('\n[Woo Duplicate Orders]');
  console.log(`Scanned orders: ${orderResult.scanned}`);
  console.log(`Duplicate groups: ${orderResult.duplicateGroups}`);
  console.log(`Actionable duplicates: ${orderResult.actionable}`);
  console.log(`Changed: ${orderResult.changed}`);
  console.log(`Failed: ${orderResult.failed}`);
  console.log(`Skipped (stock-sensitive): ${orderResult.skippedStockSensitive}`);
  console.log(`Skipped (non-deletable status): ${orderResult.skippedNonDeletable}`);

  if (!apply) {
    console.log('\nDry run finished. Re-run with --apply to execute changes.');
  }
}

main()
  .catch((err) => {
    console.error('[CLEANUP_WOO_DUPLICATES_ERR]', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
