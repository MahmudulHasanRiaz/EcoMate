import prisma from '../src/lib/prisma';

type FixCandidate = {
  id: string;
  orderNumber: string | null;
  businessId: string | null;
  courierStatus: string | null;
  latestPathaoSignal: string | null;
  reason: string;
};

type DateWindow = {
  from: Date;
  to: Date;
};

const PRE_DISPATCH_SIGNALS = new Set([
  'pending',
  'pickup_requested',
  'processing',
  'order.created',
  'order.updated',
  'order.pickup_requested',
  'order.assigned_for_pickup',
  'order.pickup_failed',
]);

const ACTIVE_OR_FINAL_SIGNALS = new Set([
  'picked',
  'in_transit',
  'at_the_sorting_hub',
  'received_at_last_mile_hub',
  'assigned_for_delivery',
  'on_hold',
  'delivered',
  'delivered_approval_pending',
  'partial_delivered',
  'partial_delivered_approval_pending',
  'partial_delivery',
  'cancelled',
  'canceled',
  'returned',
  'return_pending',
  'delivery_failed',
  'order.picked',
  'order.at_the_sorting_hub',
  'order.in_transit',
  'order.received_at_last_mile_hub',
  'order.assigned_for_delivery',
  'order.on_hold',
  'order.delivered',
  'order.partial_delivery',
  'order.cancelled',
  'order.canceled',
  'order.returned',
  'order.delivery_failed',
  'order.paid_return',
]);

const SHIPPED_OR_FINAL_TITLES = new Set([
  'rts (ready to ship)',
  'rts__ready_to_ship_',
  'ready to ship',
  'shipped',
  'delivered',
  'return pending',
  'returned',
  'partial',
  'damaged',
]);

const CONFIRMED_TITLES = new Set(['confirmed']);

function normalizeToken(value?: string | null): string {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
}

function normalizeTitle(value?: string | null): string {
  return (value || '').toString().trim().toLowerCase();
}

function extractStatusSignal(description?: string | null): string | null {
  const text = (description || '').toString().trim();
  if (!text) return null;
  const match = text.match(/status:\s*([^\n\r]+)/i);
  if (!match?.[1]) return null;
  const signal = match[1].trim().toLowerCase();
  return signal || null;
}

function parseArgs() {
  const raw = process.argv.slice(2);
  const flags = new Set(raw.filter((arg) => arg.startsWith('--')));

  const getValue = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const entry = raw.find((arg) => arg.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : undefined;
  };

  const apply = flags.has('--apply');
  const businessId = getValue('businessId');
  const fromRaw = getValue('from');
  const confirmedDateRaw = getValue('confirmedDate');
  const confirmedFromRaw = getValue('confirmedFrom');
  const confirmedToRaw = getValue('confirmedTo');
  const dateOnlyMode = flags.has('--dateOnlyMode');
  const includeUnknownCourier = flags.has('--includeUnknownCourier');
  const limitRaw = getValue('limit');
  const limit = Number.isFinite(Number(limitRaw)) && Number(limitRaw) > 0 ? Number(limitRaw) : 5000;

  let from: Date | undefined;
  if (fromRaw) {
    const parsed = new Date(fromRaw);
    if (!Number.isNaN(parsed.getTime())) from = parsed;
  }

  const parseDateInput = (value?: string): Date | undefined => {
    if (!value) return undefined;
    const trimmed = value.trim();
    // Accept DD-MM-YYYY
    const ddmmyyyy = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      const parsed = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
      return undefined;
    }
    // Accept YYYY-MM-DD
    const yyyymmdd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (yyyymmdd) {
      const parsed = new Date(`${trimmed}T00:00:00.000Z`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
      return undefined;
    }
    // Accept full ISO date-time
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    return undefined;
  };

  let confirmedWindow: DateWindow | undefined;

  if (confirmedDateRaw) {
    const dayStart = parseDateInput(confirmedDateRaw);
    if (dayStart) {
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCHours(23, 59, 59, 999);
      confirmedWindow = { from: dayStart, to: dayEnd };
    }
  } else {
    const confirmedFrom = parseDateInput(confirmedFromRaw);
    const confirmedTo = parseDateInput(confirmedToRaw);
    if (confirmedFrom && confirmedTo) {
      const to = new Date(confirmedTo);
      // If only date provided, include full day.
      if (/^\d{2}-\d{2}-\d{4}$/.test(confirmedToRaw || '') || /^\d{4}-\d{2}-\d{2}$/.test(confirmedToRaw || '')) {
        to.setUTCHours(23, 59, 59, 999);
      }
      confirmedWindow = { from: confirmedFrom, to };
    }
  }

  return { apply, businessId, from, confirmedWindow, dateOnlyMode, includeUnknownCourier, limit };
}

async function main() {
  const { apply, businessId, from, confirmedWindow, dateOnlyMode, includeUnknownCourier, limit } = parseArgs();
  console.log('--- Pathao In-Courier Rollback (created/updated regression) ---');
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Limit: ${limit}`);
  if (businessId) console.log(`Business filter: ${businessId}`);
  if (from) console.log(`Updated since: ${from.toISOString()}`);
  if (confirmedWindow) {
    console.log(`Confirmed window (UTC): ${confirmedWindow.from.toISOString()} -> ${confirmedWindow.to.toISOString()}`);
    if (dateOnlyMode) {
      console.log('Mode flag: --dateOnlyMode (pre-dispatch signal requirement is relaxed)');
    }
  }
  if (includeUnknownCourier) {
    console.log('Mode flag: --includeUnknownCourier (scan In_Courier regardless of courierService, but keep Pathao evidence guard)');
  }

  const where: any = {
    status: 'In_Courier',
  };
  if (!includeUnknownCourier) {
    where.courierService = 'Pathao';
  }
  if (businessId) where.businessId = businessId;
  if (from) where.updatedAt = { gte: from };

  const orders = await prisma.order.findMany({
    where,
    take: limit,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      orderNumber: true,
      businessId: true,
      courierService: true,
      courierStatus: true,
      isStockDeducted: true,
      OrderLog: {
        where: {
          OR: [
            { title: { in: ['Pathao status update', 'Pathao status sync', 'Confirmed', 'RTS (Ready to Ship)', 'RTS__Ready_to_Ship_', 'Shipped', 'Delivered', 'Return Pending', 'Returned', 'Partial', 'Damaged'] } },
            { user: { in: ['Pathao Webhook', 'System Sync'] } },
          ],
        },
        select: { title: true, description: true, timestamp: true, user: true },
        orderBy: { timestamp: 'desc' },
      },
    },
  });

  const candidates: FixCandidate[] = [];
  let skippedNoPreDispatchSignal = 0;
  let skippedHasCourierProgress = 0;
  let skippedHasShippedHistory = 0;
  let skippedNoConfirmedHistory = 0;
  let skippedNoConfirmedInWindow = 0;
  let skippedNoPathaoEvidence = 0;

  for (const order of orders) {
    const logs = order.OrderLog || [];
    const hasConfirmedHistory = logs.some((l) => CONFIRMED_TITLES.has(normalizeTitle(l.title)));
    const hasConfirmedInWindow = confirmedWindow
      ? logs.some(
        (l) =>
          CONFIRMED_TITLES.has(normalizeTitle(l.title)) &&
          l.timestamp >= confirmedWindow.from &&
          l.timestamp <= confirmedWindow.to
      )
      : false;
    const hasShippedOrFinalHistory = logs.some((l) => SHIPPED_OR_FINAL_TITLES.has(normalizeTitle(l.title)));

    const pathaoSignals = logs
      .map((l) => ({
        token: extractStatusSignal(l.description),
        timestamp: l.timestamp,
      }))
      .filter((x) => Boolean(x.token)) as Array<{ token: string; timestamp: Date }>;

    const latestPathaoSignal = pathaoSignals.length > 0 ? pathaoSignals[0].token : null;
    const latestPathaoSignalNorm = latestPathaoSignal ? normalizeToken(latestPathaoSignal) : '';
    const courierStatusNorm = normalizeToken(order.courierStatus);
    const hasPathaoLogEvidence = logs.some((l) =>
      /pathao/i.test(l.title || '') || /pathao/i.test(l.user || '') || /pathao/i.test(l.description || '')
    );
    const hasPathaoEvidence =
      order.courierService === 'Pathao' ||
      hasPathaoLogEvidence ||
      Boolean(latestPathaoSignalNorm);

    if (includeUnknownCourier && !hasPathaoEvidence) {
      skippedNoPathaoEvidence++;
      continue;
    }

    const hasPreDispatchSignal =
      PRE_DISPATCH_SIGNALS.has(courierStatusNorm) ||
      (latestPathaoSignalNorm ? PRE_DISPATCH_SIGNALS.has(latestPathaoSignalNorm) : false);

    const hasCourierProgressSignal =
      ACTIVE_OR_FINAL_SIGNALS.has(courierStatusNorm) ||
      pathaoSignals.some((s) => ACTIVE_OR_FINAL_SIGNALS.has(normalizeToken(s.token)));

    if (!dateOnlyMode && !hasPreDispatchSignal) {
      skippedNoPreDispatchSignal++;
      continue;
    }
    if (hasCourierProgressSignal) {
      skippedHasCourierProgress++;
      continue;
    }
    if (hasShippedOrFinalHistory) {
      skippedHasShippedHistory++;
      continue;
    }
    if (confirmedWindow && !hasConfirmedInWindow) {
      skippedNoConfirmedInWindow++;
      continue;
    }
    if (!confirmedWindow && !hasConfirmedHistory) {
      skippedNoConfirmedHistory++;
      continue;
    }

    const reason = [
      `courierStatus=${order.courierStatus || 'null'}`,
      `latestPathaoSignal=${latestPathaoSignal || 'null'}`,
      `isStockDeducted=${order.isStockDeducted}`,
    ].join(', ');

    candidates.push({
      id: order.id,
      orderNumber: order.orderNumber,
      businessId: order.businessId,
      courierStatus: order.courierStatus,
      latestPathaoSignal,
      reason,
    });
  }

  console.log(`\nScanned In-Courier Pathao orders: ${orders.length}`);
  console.log(`Candidates (safe rollback to Confirmed): ${candidates.length}`);
  console.log(`Skipped (no pre-dispatch signal): ${skippedNoPreDispatchSignal}`);
  console.log(`Skipped (has courier-progress signal): ${skippedHasCourierProgress}`);
  console.log(`Skipped (has shipped/final history): ${skippedHasShippedHistory}`);
  if (includeUnknownCourier) {
    console.log(`Skipped (no Pathao evidence): ${skippedNoPathaoEvidence}`);
  }
  if (confirmedWindow) {
    console.log(`Skipped (no confirmed history in window): ${skippedNoConfirmedInWindow}`);
  } else {
    console.log(`Skipped (no confirmed history): ${skippedNoConfirmedHistory}`);
  }

  if (candidates.length > 0) {
    console.log('\nSample candidates (up to 20):');
    candidates.slice(0, 20).forEach((c, idx) => {
      console.log(`${idx + 1}. ${c.orderNumber || c.id} | ${c.reason}`);
    });
  }

  if (!apply) {
    console.log('\nDry run finished. Re-run with --apply to execute rollback.');
    return;
  }

  let updated = 0;
  for (const c of candidates) {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: c.id },
        data: {
          status: 'Confirmed',
          OrderLog: {
            create: {
              title: 'Confirmed',
              description: `Auto-corrected from In-Courier due Pathao pre-dispatch webhook (${c.latestPathaoSignal || c.courierStatus || 'unknown'}).`,
              user: 'System Script',
            },
          },
        },
      });
    });
    updated++;
  }

  console.log(`\nApplied rollback successfully. Updated: ${updated}`);
}

main()
  .catch((err) => {
    console.error('[FIX_PATHAO_IN_COURIER_ERROR]', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
