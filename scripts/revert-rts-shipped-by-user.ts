import prisma from '../src/lib/prisma';

type Args = {
  date?: string;
  staffId?: string;
  staffName?: string;
  businessId?: string;
  businessName?: string;
  utcOffset: string;
  fromLocal?: string;
  toLocal?: string;
  apply: boolean;
  limit: number;
  runBy: string;
  includeNameFallback: boolean;
};

type LogHit = {
  id: string;
  orderId: string;
  description: string;
  timestamp: Date;
  user: string;
  userId: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    utcOffset: '+06:00',
    apply: false,
    limit: 10000,
    runBy: 'System Script',
    includeNameFallback: false,
  };

  for (const token of argv) {
    if (token === '--apply') {
      args.apply = true;
      continue;
    }
    if (token === '--includeNameFallback') {
      args.includeNameFallback = true;
      continue;
    }
    if (!token.startsWith('--')) continue;
    const [k, ...rest] = token.slice(2).split('=');
    const v = rest.join('=');
    if (!k) continue;
    if (k === 'date') args.date = v;
    if (k === 'staffId') args.staffId = v;
    if (k === 'staffName') args.staffName = v;
    if (k === 'businessId') args.businessId = v;
    if (k === 'businessName') args.businessName = v;
    if (k === 'utcOffset' && v) args.utcOffset = v;
    if (k === 'fromLocal' && v) args.fromLocal = v;
    if (k === 'toLocal' && v) args.toLocal = v;
    if (k === 'runBy' && v) args.runBy = v;
    if (k === 'limit' && v) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) args.limit = Math.floor(n);
    }
  }

  return args;
}

function assertRequired(args: Args) {
  if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error('Missing/invalid --date. Use YYYY-MM-DD, e.g. --date=2026-03-04');
  }
  if (!args.staffId && !args.staffName) {
    throw new Error('Provide either --staffId or --staffName');
  }
  if (args.businessId && args.businessName) {
    throw new Error('Use either --businessId or --businessName (not both)');
  }
  if (!/^[+-]\d{2}:\d{2}$/.test(args.utcOffset)) {
    throw new Error('Invalid --utcOffset. Use format +06:00 or -05:00');
  }
  if (args.fromLocal && !/^\d{2}:\d{2}$/.test(args.fromLocal)) {
    throw new Error('Invalid --fromLocal. Use HH:mm, e.g. --fromLocal=20:40');
  }
  if (args.toLocal && !/^\d{2}:\d{2}$/.test(args.toLocal)) {
    throw new Error('Invalid --toLocal. Use HH:mm, e.g. --toLocal=20:50');
  }
}

function getUtcRange(localDate: string, utcOffset: string, fromLocal?: string, toLocal?: string) {
  const startLocal = fromLocal ? `${fromLocal}:00` : '00:00:00';
  const endLocal = toLocal ? `${toLocal}:00` : '23:59:59';

  const start = new Date(`${localDate}T${startLocal}${utcOffset}`);
  const end = new Date(`${localDate}T${endLocal}${utcOffset}`);

  if (Number.isNaN(start.getTime())) throw new Error('Could not parse local date + offset');
  if (Number.isNaN(end.getTime())) throw new Error('Could not parse local date + offset');
  if (end.getTime() <= start.getTime()) {
    throw new Error('--toLocal must be after --fromLocal within same date');
  }

  return { start, end };
}

function normalizeStatusToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

function isRtsToShippedLog(description: string): boolean {
  const m = description.match(/Status:\s*(.+?)\s*->\s*Shipped\b/i);
  if (!m) return false;
  const fromToken = normalizeStatusToken(m[1] || '');
  return fromToken === 'rtsreadytoship' || fromToken === 'rts';
}

async function resolveStaff(args: Args) {
  if (args.staffId) {
    const byId = await prisma.staffMember.findUnique({
      where: { id: args.staffId },
      select: { id: true, name: true },
    });
    if (!byId) throw new Error(`No staff found for --staffId=${args.staffId}`);
    return byId;
  }

  const name = (args.staffName || '').trim();
  const matches = await prisma.staffMember.findMany({
    where: {
      name: { equals: name, mode: 'insensitive' },
    },
    select: { id: true, name: true },
    take: 5,
  });

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Multiple staff matched "${name}". Use --staffId explicitly. Matches: ${matches
        .map((s) => `${s.name}(${s.id})`)
        .join(', ')}`
    );
  }

  // Fallback: no staff row found (historical logs may still have user text)
  return { id: null, name };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertRequired(args);

  const { start, end } = getUtcRange(args.date as string, args.utcOffset, args.fromLocal, args.toLocal);
  const staff = await resolveStaff(args);

  console.log('--- RTS -> Shipped Rollback Script ---');
  console.log(`Mode: ${args.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Date (local): ${args.date}  Offset: ${args.utcOffset}`);
  if (args.fromLocal || args.toLocal) {
    console.log(`Local time window: ${args.fromLocal || '00:00'} -> ${args.toLocal || '23:59'}`);
  }
  console.log(`Window (UTC): ${start.toISOString()} -> ${end.toISOString()}`);
  console.log(`Target staff: ${staff.name}${staff.id ? ` (${staff.id})` : ''}`);
  if (args.businessId) {
    console.log(`Business filter: id=${args.businessId}`);
  } else if (args.businessName) {
    console.log(`Business filter: name="${args.businessName}"`);
  } else {
    console.log('Business filter: none (all businesses)');
  }
  console.log(`Match mode: ${staff.id ? (args.includeNameFallback ? 'userId OR user name' : 'userId only') : 'user name only'}`);
  console.log(`Scan limit: ${args.limit}`);

  const logWhere: any = {
    title: { equals: 'Shipped', mode: 'insensitive' },
    timestamp: { gte: start, lt: end },
    description: { contains: '-> Shipped', mode: 'insensitive' },
  };

  if (staff.id) {
    if (args.includeNameFallback) {
      logWhere.OR = [{ userId: staff.id }, { user: { equals: staff.name, mode: 'insensitive' } }];
    } else {
      logWhere.userId = staff.id;
    }
  } else {
    logWhere.user = { equals: staff.name, mode: 'insensitive' };
  }

  const rawLogs = await prisma.orderLog.findMany({
    where: logWhere,
    orderBy: { timestamp: 'desc' },
    take: args.limit,
    select: {
      id: true,
      orderId: true,
      description: true,
      timestamp: true,
      user: true,
      userId: true,
    },
  });

  const rtsToShippedLogs = rawLogs.filter((l) => isRtsToShippedLog(l.description)) as LogHit[];
  const latestPerOrder = new Map<string, LogHit>();
  for (const log of rtsToShippedLogs) {
    const prev = latestPerOrder.get(log.orderId);
    if (!prev || log.timestamp.getTime() > prev.timestamp.getTime()) {
      latestPerOrder.set(log.orderId, log);
    }
  }

  const orderIds = Array.from(latestPerOrder.keys());
  if (orderIds.length === 0) {
    console.log('\nNo matching RTS -> Shipped logs found for the given criteria.');
    return;
  }

  const orderWhere: any = { id: { in: orderIds } };
  if (args.businessId) {
    orderWhere.businessId = args.businessId;
  } else if (args.businessName) {
    orderWhere.businessName = { equals: args.businessName, mode: 'insensitive' };
  }

  const orders = await prisma.order.findMany({
    where: orderWhere,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      updatedAt: true,
      businessId: true,
      businessName: true,
    },
  });

  const byId = new Map(orders.map((o) => [o.id, o]));
  const businessBuckets = new Map<string, number>();
  for (const order of orders) {
    const key = order.businessName || order.businessId || '[unknown-business]';
    businessBuckets.set(key, (businessBuckets.get(key) || 0) + 1);
  }
  const actionable: Array<{ orderId: string; orderNumber: string | null; log: LogHit }> = [];
  const skippedNonShipped: Array<{ orderId: string; orderNumber: string | null; status: string }> = [];

  for (const orderId of orderIds) {
    const order = byId.get(orderId);
    if (!order) continue;
    const hit = latestPerOrder.get(orderId)!;
    if (String(order.status) !== 'Shipped') {
      skippedNonShipped.push({
        orderId,
        orderNumber: order.orderNumber || null,
        status: String(order.status),
      });
      continue;
    }
    actionable.push({
      orderId,
      orderNumber: order.orderNumber || null,
      log: hit,
    });
  }

  console.log('');
  console.log(`[Scan] Raw logs matched: ${rawLogs.length}`);
  console.log(`[Scan] RTS -> Shipped logs: ${rtsToShippedLogs.length}`);
  console.log(`[Scan] Unique orders from logs: ${orderIds.length}`);
  console.log(`[Scan] Orders after business filter: ${orders.length}`);
  console.log(`[Plan] Actionable (currently Shipped): ${actionable.length}`);
  console.log(`[Plan] Skipped (status no longer Shipped): ${skippedNonShipped.length}`);
  console.log(`[Info] Duplicate logs on same order ignored: ${Math.max(0, rtsToShippedLogs.length - orderIds.length)}`);

  if (businessBuckets.size > 0) {
    console.log('\nBusiness breakdown (after business filter):');
    [...businessBuckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach(([name, count]) => {
        console.log(`- ${name}: ${count}`);
      });
  }

  if (skippedNonShipped.length > 0) {
    console.log('\nSkipped examples:');
    skippedNonShipped.slice(0, 20).forEach((s) => {
      console.log(`- ${s.orderNumber || s.orderId}: current status=${s.status}`);
    });
    if (skippedNonShipped.length > 20) {
      console.log(`... and ${skippedNonShipped.length - 20} more`);
    }
  }

  console.log('\nActionable examples:');
  actionable.slice(0, 30).forEach((a) => {
    console.log(
      `- ${a.orderNumber || a.orderId} | log=${a.log.id} | at=${a.log.timestamp.toISOString()} | by=${a.log.user}`
    );
  });
  if (actionable.length > 30) {
    console.log(`... and ${actionable.length - 30} more`);
  }

  if (!args.apply) {
    console.log('\nDry run complete. Re-run with --apply to perform rollback.');
    return;
  }

  let changed = 0;
  let failed = 0;
  let skippedAtApply = 0;

  for (const item of actionable) {
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.order.findUnique({
          where: { id: item.orderId },
          select: { status: true, orderNumber: true },
        });
        if (!current || String(current.status) !== 'Shipped') {
          skippedAtApply += 1;
          return;
        }

        await tx.order.update({
          where: { id: item.orderId },
          data: {
            status: 'RTS__Ready_to_Ship_' as any,
            OrderLog: {
              create: {
                title: 'RTS (Ready to Ship)',
                description: `Status: Shipped -> RTS (Ready to Ship) | Script rollback from log ${item.log.id}`,
                user: args.runBy,
                meta: {
                  script: 'revert-rts-shipped-by-user',
                  sourceLogId: item.log.id,
                  sourceTimestamp: item.log.timestamp.toISOString(),
                  sourceUser: item.log.user,
                  sourceUserId: item.log.userId,
                },
              },
            },
          },
        });
      });
      changed += 1;
    } catch (err: any) {
      failed += 1;
      console.error('[ROLLBACK_FAIL]', {
        orderId: item.orderId,
        orderNumber: item.orderNumber,
        message: err?.message || String(err),
      });
    }
  }

  console.log('');
  console.log(`[Done] Changed: ${changed}`);
  console.log(`[Done] Failed: ${failed}`);
  console.log(`[Done] Skipped during apply (status changed concurrently): ${skippedAtApply}`);
}

main()
  .catch((err) => {
    console.error('[REVERT_RTS_SHIPPED_ERROR]', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
