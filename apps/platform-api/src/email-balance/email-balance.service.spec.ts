import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EmailBalanceService } from './email-balance.service';
import {
  DEFAULT_SAAS_SMTP,
  type SaasSmtpSettings,
} from './email-balance.utils';

/**
 * In-memory fake Prisma client with real state, so the tests prove the
 * invariants (FEFO order, idempotency, cache == Σ lots, status-guard
 * claims) instead of asserting mock calls. The fake honours `select`
 * projections — the money-visibility test depends on that: a top-up
 * row returned without projection would leak amountBDT spuriously.
 */

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  ownerEmail: string;
  currentPeriodEnd: Date | null;
}

interface AccountRow {
  tenantId: string;
  balanceCached: number;
  freeGrantClaimed: boolean;
  lowBalanceNotifiedAt: Date | null;
}

interface LotRow {
  id: string;
  tenantId: string;
  source: string;
  emailsTotal: number;
  emailsRemaining: number;
  expiresAt: Date | null;
  createdAt: Date;
  topUpId?: string | null;
}

interface LedgerRow {
  id: string;
  tenantId: string;
  lotId: string | null;
  kind: string;
  delta: number;
  balanceAfter: number;
  reference: string | null;
  note: string | null;
  createdAt: Date;
}

interface TopUpRow {
  id: string;
  tenantId: string;
  invoiceId: string;
  amountBDT: number;
  emailsGranted: number;
  rateSnapshot: Record<string, unknown>;
  status: string;
  createdAt: Date;
  paidAt: Date | null;
}

interface FakeDb {
  tenants: Map<string, TenantRow>;
  invoices: Map<string, { id: string; number: string; status: string }>;
  accounts: Map<string, AccountRow>;
  lots: LotRow[];
  ledger: LedgerRow[];
  topUps: TopUpRow[];
  reminders: Array<{ tenantId: string; kind: string; referenceId: string }>;
  settingRows: Map<string, unknown>;
  usageDaily: Array<{ tenantId: string; date: string; metric: string; value: number }>;
  /** When true, the next SEND findFirst misses (simulates the race window for the P2002 path). */
  blindFindFirstOnce: boolean;
  seq: number;
}

function project<T extends object>(row: T, select?: Record<string, boolean>): any {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (select[key]) out[key] = (row as Record<string, unknown>)[key];
  }
  return out;
}

function applyUpdate(row: Record<string, any>, data: Record<string, any>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'decrement' in value) {
      row[key] = (row[key] ?? 0) - (value as { decrement: number }).decrement;
    } else if (value && typeof value === 'object' && 'increment' in value) {
      row[key] = (row[key] ?? 0) + (value as { increment: number }).increment;
    } else {
      row[key] = value;
    }
  }
}

function lotMatches(lot: LotRow, where: any): boolean {
  if (!where) return true;
  if (where.tenantId !== undefined && lot.tenantId !== where.tenantId) return false;
  if (where.emailsRemaining?.gt !== undefined && !(lot.emailsRemaining > where.emailsRemaining.gt)) return false;
  if (where.expiresAt?.lte !== undefined) {
    if (lot.expiresAt === null || !(lot.expiresAt <= where.expiresAt.lte)) return false;
  }
  if (where.expiresAt?.gt !== undefined) {
    if (lot.expiresAt === null || !(lot.expiresAt > where.expiresAt.gt)) return false;
  }
  if (where.OR) {
    const ok = where.OR.some((cond: any) => {
      if (cond.expiresAt === null) return lot.expiresAt === null;
      if (cond.expiresAt?.gt !== undefined) {
        return lot.expiresAt !== null && lot.expiresAt > cond.expiresAt.gt;
      }
      return false;
    });
    if (!ok) return false;
  }
  return true;
}

function buildPrisma(db: FakeDb): any {
  const nextId = (prefix: string) => `${prefix}-${++db.seq}`;
  const now = () => new Date(Date.now() + db.seq); // strictly increasing createdAt

  const prisma: any = {
    // Callback form snapshots + restores state on error — real Prisma
    // rolls the whole transaction back (the P2002 backstop test depends
    // on the lot decrements being undone when the ledger write fails).
    $transaction: async (arg: any) => {
      if (typeof arg !== 'function') return Promise.all(arg);
      const snapshot = {
        accounts: new Map(
          [...db.accounts].map(([k, v]) => [k, { ...v }] as const),
        ),
        lots: db.lots.map((l) => ({ ...l })),
        ledger: db.ledger.map((r) => ({ ...r })),
        topUps: db.topUps.map((t) => ({ ...t })),
        reminders: db.reminders.map((r) => ({ ...r })),
        usageDaily: db.usageDaily.map((u) => ({ ...u })),
        seq: db.seq,
      };
      try {
        return await arg(prisma);
      } catch (error) {
        db.accounts = snapshot.accounts;
        db.lots.length = 0;
        db.lots.push(...snapshot.lots);
        db.ledger.length = 0;
        db.ledger.push(...snapshot.ledger);
        db.topUps.length = 0;
        db.topUps.push(...snapshot.topUps);
        db.reminders.length = 0;
        db.reminders.push(...snapshot.reminders);
        db.usageDaily.length = 0;
        db.usageDaily.push(...snapshot.usageDaily);
        db.seq = snapshot.seq;
        throw error;
      }
    },

    // SELECT ... FOR UPDATE FEFO lock query (drainLots).
    $queryRaw: async (_strings: TemplateStringsArray, ...values: any[]) => {
      const tenantId = values[0];
      const at = new Date();
      return db.lots
        .filter(
          (lot) =>
            lot.tenantId === tenantId &&
            lot.emailsRemaining > 0 &&
            (lot.expiresAt === null || lot.expiresAt > at),
        )
        .sort((a, b) => {
          if (a.expiresAt === null && b.expiresAt === null) {
            return a.createdAt.getTime() - b.createdAt.getTime();
          }
          if (a.expiresAt === null) return 1;
          if (b.expiresAt === null) return -1;
          const byExpiry = a.expiresAt.getTime() - b.expiresAt.getTime();
          return byExpiry !== 0
            ? byExpiry
            : a.createdAt.getTime() - b.createdAt.getTime();
        })
        .map((lot) => ({ id: lot.id, emailsRemaining: lot.emailsRemaining }));
    },

    tenant: {
      findUnique: async ({ where, select }: any) => {
        const row = db.tenants.get(where.id) ?? null;
        return row ? project(row, select) : null;
      },
    },

    invoice: {
      update: async ({ where, data }: any) => {
        const row = db.invoices.get(where.id);
        if (row) applyUpdate(row as any, data);
        return row ?? { id: where.id };
      },
    },

    platformSetting: {
      findUnique: async ({ where }: any) =>
        db.settingRows.has(where.key)
          ? { key: where.key, value: db.settingRows.get(where.key) }
          : null,
    },

    tenantEmailAccount: {
      upsert: async ({ where, create }: any) => {
        let row = db.accounts.get(where.tenantId);
        if (!row) {
          row = {
            tenantId: where.tenantId,
            balanceCached: 0,
            freeGrantClaimed: false,
            lowBalanceNotifiedAt: null,
            ...create,
          };
          db.accounts.set(where.tenantId, row);
        }
        return { ...row };
      },
      findUnique: async ({ where, select }: any) => {
        const row = db.accounts.get(where.tenantId) ?? null;
        return row ? project(row, select) : null;
      },
      findMany: async ({ where, orderBy, take, include }: any = {}) => {
        let rows = [...db.accounts.values()];
        if (where?.balanceCached?.lte !== undefined) {
          rows = rows.filter((r) => r.balanceCached <= where.balanceCached.lte);
        }
        if (orderBy?.balanceCached === 'asc') {
          rows.sort((a, b) => a.balanceCached - b.balanceCached);
        } else if (orderBy?.tenantId === 'asc') {
          rows.sort((a, b) => a.tenantId.localeCompare(b.tenantId));
        }
        if (take !== undefined) rows = rows.slice(0, take);
        return rows.map((row) => {
          const out = { ...row } as any;
          if (include?.tenant) {
            const tenant = db.tenants.get(row.tenantId);
            out.tenant = tenant ? project(tenant, include.tenant.select) : null;
          }
          return out;
        });
      },
      update: async ({ where, data }: any) => {
        const row = db.accounts.get(where.tenantId);
        if (!row) throw new Error('account not found');
        applyUpdate(row as any, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        const row = db.accounts.get(where.tenantId);
        if (!row) return { count: 0 };
        if (
          where.freeGrantClaimed !== undefined &&
          row.freeGrantClaimed !== where.freeGrantClaimed
        ) {
          return { count: 0 };
        }
        if (
          where.lowBalanceNotifiedAt !== undefined &&
          row.lowBalanceNotifiedAt !== where.lowBalanceNotifiedAt
        ) {
          return { count: 0 };
        }
        applyUpdate(row as any, data);
        return { count: 1 };
      },
    },

    emailBalanceLot: {
      aggregate: async ({ where }: any) => ({
        _sum: {
          emailsRemaining: db.lots
            .filter((lot) => lotMatches(lot, where))
            .reduce((sum, lot) => sum + lot.emailsRemaining, 0),
        },
      }),
      findMany: async ({ where, orderBy, take, skip, select, include }: any = {}) => {
        let rows = db.lots.filter((lot) => lotMatches(lot, where));
        const order = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
        for (const clause of order.reverse()) {
          if (clause.expiresAt === 'asc') {
            rows.sort((a, b) => {
              // Prisma ASC sorts NULL first.
              if (a.expiresAt === null && b.expiresAt === null) return 0;
              if (a.expiresAt === null) return -1;
              if (b.expiresAt === null) return 1;
              return a.expiresAt.getTime() - b.expiresAt.getTime();
            });
          }
          if (clause.createdAt === 'asc') {
            rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          }
        }
        if (skip) rows = rows.slice(skip);
        if (take !== undefined) rows = rows.slice(0, take);
        return rows.map((lot) => {
          const out = project(lot, select);
          if (include?.tenant) {
            const tenant = db.tenants.get(lot.tenantId);
            out.tenant = tenant ? project(tenant, include.tenant.select) : null;
          }
          return out;
        });
      },
      findUnique: async ({ where, select }: any) => {
        const row = db.lots.find((lot) => lot.id === where.id) ?? null;
        return row ? project(row, select) : null;
      },
      create: async ({ data }: any) => {
        const row: LotRow = {
          id: nextId('lot'),
          tenantId: data.tenantId,
          source: data.source,
          emailsTotal: data.emailsTotal,
          emailsRemaining: data.emailsRemaining,
          expiresAt: data.expiresAt ?? null,
          createdAt: now(),
          topUpId: data.topUpId ?? null,
        };
        db.lots.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = db.lots.find((lot) => lot.id === where.id);
        if (!row) throw new Error('lot not found');
        applyUpdate(row as any, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        const row = db.lots.find((lot) => lot.id === where.id);
        if (!row) return { count: 0 };
        if (
          where.emailsRemaining !== undefined &&
          row.emailsRemaining !== where.emailsRemaining
        ) {
          return { count: 0 };
        }
        applyUpdate(row as any, data);
        return { count: 1 };
      },
    },

    emailBalanceLedger: {
      findFirst: async ({ where }: any) => {
        if (db.blindFindFirstOnce) {
          db.blindFindFirstOnce = false;
          return null;
        }
        return (
          db.ledger.find(
            (row) =>
              row.tenantId === where.tenantId &&
              row.kind === where.kind &&
              row.reference === where.reference,
          ) ?? null
        );
      },
      findMany: async ({ where, orderBy, skip, take, select }: any = {}) => {
        let rows = db.ledger.filter((row) => row.tenantId === where?.tenantId);
        if (orderBy?.createdAt === 'desc') {
          rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (skip) rows = rows.slice(skip);
        if (take !== undefined) rows = rows.slice(0, take);
        return rows.map((row) => project(row, select));
      },
      count: async ({ where }: any) =>
        db.ledger.filter((row) => row.tenantId === where?.tenantId).length,
      create: async ({ data }: any) => {
        // The partial unique index (tenantId, reference) WHERE kind='SEND'.
        if (data.kind === 'SEND' && data.reference) {
          const dup = db.ledger.find(
            (row) =>
              row.tenantId === data.tenantId &&
              row.kind === 'SEND' &&
              row.reference === data.reference,
          );
          if (dup) {
            const error: any = new Error('Unique constraint failed');
            error.code = 'P2002';
            throw error;
          }
        }
        const row: LedgerRow = {
          id: nextId('ledger'),
          tenantId: data.tenantId,
          lotId: data.lotId ?? null,
          kind: data.kind,
          delta: data.delta,
          balanceAfter: data.balanceAfter,
          reference: data.reference ?? null,
          note: data.note ?? null,
          createdAt: now(),
        };
        db.ledger.push(row);
        return { ...row };
      },
    },

    emailTopUp: {
      create: async ({ data }: any) => {
        const row: TopUpRow = {
          id: nextId('topup'),
          tenantId: data.tenantId,
          invoiceId: data.invoiceId,
          amountBDT: data.amountBDT,
          emailsGranted: data.emailsGranted,
          rateSnapshot: data.rateSnapshot,
          status: 'PENDING',
          createdAt: now(),
          paidAt: null,
        };
        db.topUps.push(row);
        return { ...row };
      },
      findUnique: async ({ where }: any) => {
        const row = where.invoiceId
          ? db.topUps.find((t) => t.invoiceId === where.invoiceId)
          : db.topUps.find((t) => t.id === where.id);
        return row ? { ...row } : null;
      },
      findMany: async ({ where, orderBy, skip, take, select, include }: any = {}) => {
        let rows = db.topUps.filter((t) => {
          if (where?.tenantId !== undefined && t.tenantId !== where.tenantId) return false;
          if (where?.status !== undefined && t.status !== where.status) return false;
          return true;
        });
        if (orderBy?.createdAt === 'desc') {
          rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (skip) rows = rows.slice(skip);
        if (take !== undefined) rows = rows.slice(0, take);
        return rows.map((t) => {
          const out = project(t, select);
          if (include?.invoice) {
            const inv = db.invoices.get(t.invoiceId);
            out.invoice = inv ? project(inv, include.invoice.select) : null;
          }
          return out;
        });
      },
      count: async ({ where }: any = {}) =>
        db.topUps.filter((t) => {
          if (where?.tenantId !== undefined && t.tenantId !== where.tenantId) return false;
          if (where?.status !== undefined && t.status !== where.status) return false;
          return true;
        }).length,
      updateMany: async ({ where, data }: any) => {
        const row = db.topUps.find((t) => t.id === where.id);
        if (!row) return { count: 0 };
        if (where.status !== undefined && row.status !== where.status) {
          return { count: 0 };
        }
        applyUpdate(row as any, data);
        return { count: 1 };
      },
      aggregate: async ({ where }: any) => {
        const rows = db.topUps.filter(
          (t) => where?.status === undefined || t.status === where.status,
        );
        return {
          _count: { id: rows.length },
          _sum: {
            emailsGranted: rows.reduce((s, t) => s + t.emailsGranted, 0),
            amountBDT: rows.reduce((s, t) => s + t.amountBDT, 0),
          },
        };
      },
    },

    invoiceReminder: {
      findUnique: async ({ where }: any) => {
        const key = where.tenantId_kind_referenceId;
        return (
          db.reminders.find(
            (r) =>
              r.tenantId === key.tenantId &&
              r.kind === key.kind &&
              r.referenceId === key.referenceId,
          ) ?? null
        );
      },
      create: async ({ data }: any) => {
        const dup = db.reminders.find(
          (r) =>
            r.tenantId === data.tenantId &&
            r.kind === data.kind &&
            r.referenceId === data.referenceId,
        );
        if (dup) {
          const error: any = new Error('Unique constraint failed');
          error.code = 'P2002';
          throw error;
        }
        db.reminders.push({ ...data });
        return { ...data };
      },
    },

    usageDaily: {
      upsert: async ({ where, create, update }: any) => {
        const key = where.tenantId_date_metric;
        const existing = db.usageDaily.find(
          (u) =>
            u.tenantId === key.tenantId &&
            u.date === key.date &&
            u.metric === key.metric,
        );
        if (existing) {
          applyUpdate(existing as any, update);
          return { ...existing };
        }
        const row = { ...create };
        db.usageDaily.push(row);
        return { ...row };
      },
    },
  };
  return prisma;
}

function freshDb(): FakeDb {
  return {
    tenants: new Map(),
    invoices: new Map(),
    accounts: new Map(),
    lots: [],
    ledger: [],
    topUps: [],
    reminders: [],
    settingRows: new Map([['saas_smtp', {}]]),
    usageDaily: [],
    blindFindFirstOnce: false,
    seq: 0,
  };
}

/** Recursively collect every key in a value (for the money-visibility test). */
function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((v) => collectKeys(v, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.add(k);
      collectKeys(v, out);
    }
  }
  return out;
}

const TENANT_ID = 'tenant-1';
const OTHER_TENANT_ID = 'tenant-2';

function buildService(settingsOverrides: Partial<SaasSmtpSettings> = {}) {
  const db = freshDb();
  const prisma = buildPrisma(db);
  const settingsValue: SaasSmtpSettings = {
    ...DEFAULT_SAAS_SMTP,
    ...settingsOverrides,
    expiry: {
      ...DEFAULT_SAAS_SMTP.expiry,
      ...(settingsOverrides.expiry ?? {}),
    },
  };
  const settings = { getSaasSmtp: jest.fn(() => settingsValue) };
  const mail = {
    isConfigured: jest.fn(() => true),
    sendRelay: jest.fn(async () => undefined),
    sendLowBalance: jest.fn(async () => undefined),
    sendEmailExpiryWarning: jest.fn(async () => undefined),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const invoices = { createInvoice: jest.fn() };
  const service = new EmailBalanceService(
    prisma,
    settings as any,
    mail as any,
    audit as any,
    invoices as any,
  );
  const addTenant = (over: Partial<TenantRow> = {}) => {
    const tenant: TenantRow = {
      id: TENANT_ID,
      name: 'Test Store',
      slug: 'test-store',
      status: 'TRIAL',
      ownerEmail: 'owner@example.com',
      currentPeriodEnd: null,
      ...over,
    };
    db.tenants.set(tenant.id, tenant);
    return tenant;
  };
  const addLot = (over: Partial<LotRow> = {}) => {
    const lot: LotRow = {
      id: `lot-${++db.seq}`,
      tenantId: TENANT_ID,
      source: 'FREE_GRANT',
      emailsTotal: 10,
      emailsRemaining: 10,
      expiresAt: null,
      createdAt: new Date(Date.now() + db.seq),
      topUpId: null,
      ...over,
    };
    db.lots.push(lot);
    return lot;
  };
  return {
    db,
    prisma,
    service,
    settings,
    settingsValue,
    mail,
    audit,
    invoices,
    addTenant,
    addLot,
  };
}

const DAY_MS = 86_400_000;

describe('EmailBalanceService — free grant', () => {
  it('grants the free allowance exactly once', async () => {
    const { service, db, addTenant } = buildService();
    addTenant();
    const first = await service.grantFreeAllowance(TENANT_ID);
    expect(first).toEqual({ granted: true, emails: 10 });
    const second = await service.grantFreeAllowance(TENANT_ID);
    expect(second).toEqual({ granted: false, emails: 0 });
    expect(db.lots).toHaveLength(1);
    expect(db.lots[0]).toMatchObject({
      source: 'FREE_GRANT',
      emailsTotal: 10,
      emailsRemaining: 10,
      expiresAt: null,
    });
    expect(db.accounts.get(TENANT_ID)).toMatchObject({
      balanceCached: 10,
      freeGrantClaimed: true,
    });
    expect(db.ledger).toHaveLength(1);
    expect(db.ledger[0]).toMatchObject({
      kind: 'GRANT',
      delta: 10,
      balanceAfter: 10,
      reference: 'free-grant',
    });
  });

  it('consumes the claim without a lot when the allowance is 0', async () => {
    const { service, db, addTenant } = buildService({ freeAllowance: 0 });
    addTenant();
    const result = await service.grantFreeAllowance(TENANT_ID);
    expect(result).toEqual({ granted: true, emails: 0 });
    expect(db.lots).toHaveLength(0);
    expect(db.accounts.get(TENANT_ID)?.freeGrantClaimed).toBe(true);
  });

  it('computes the lot expiry from the grant moment (FIXED_DAYS)', async () => {
    const { service, db, addTenant } = buildService({
      expiry: { mode: 'FIXED_DAYS', days: 30, warnDays: 7 },
    });
    addTenant();
    const before = Date.now();
    await service.grantFreeAllowance(TENANT_ID);
    const expiresAt = db.lots[0].expiresAt?.getTime() ?? 0;
    expect(expiresAt).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS);
  });
});

describe('EmailBalanceService — consume', () => {
  function seedLots(ctx: ReturnType<typeof buildService>) {
    const { addLot, db } = ctx;
    const soon = addLot({
      id: 'lot-soon',
      emailsTotal: 5,
      emailsRemaining: 5,
      expiresAt: new Date(Date.now() + 5 * DAY_MS),
    });
    const later = addLot({
      id: 'lot-later',
      emailsTotal: 5,
      emailsRemaining: 5,
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
    });
    const never = addLot({
      id: 'lot-never',
      emailsTotal: 5,
      emailsRemaining: 5,
      expiresAt: null,
    });
    db.accounts.set(TENANT_ID, {
      tenantId: TENANT_ID,
      balanceCached: 15,
      freeGrantClaimed: true,
      lowBalanceNotifiedAt: null,
    });
    return { soon, later, never };
  }

  it('drains FEFO: earliest-expiring first, never-expiring last', async () => {
    const ctx = buildService();
    ctx.addTenant();
    const { soon, later, never } = seedLots(ctx);
    const result = await ctx.service.consume(TENANT_ID, 7, 'job-1');
    expect(result).toEqual({ allowed: true, remaining: 8 });
    expect(
      ctx.db.lots.find((l) => l.id === soon.id)?.emailsRemaining,
    ).toBe(0);
    expect(
      ctx.db.lots.find((l) => l.id === later.id)?.emailsRemaining,
    ).toBe(3);
    expect(
      ctx.db.lots.find((l) => l.id === never.id)?.emailsRemaining,
    ).toBe(5);
    expect(ctx.db.accounts.get(TENANT_ID)?.balanceCached).toBe(8);
    // Two ledger rows (one per lot touched), the reference on the first only.
    const sends = ctx.db.ledger.filter((r) => r.kind === 'SEND');
    expect(sends).toHaveLength(2);
    expect(sends[0]).toMatchObject({ delta: -5, reference: 'job-1' });
    expect(sends[1]).toMatchObject({ delta: -2, reference: null });
    expect(sends.map((r) => r.balanceAfter)).toEqual([10, 8]);
  });

  it('is all-or-nothing when the balance is short', async () => {
    const ctx = buildService();
    ctx.addTenant();
    seedLots(ctx);
    const result = await ctx.service.consume(TENANT_ID, 16, 'job-1');
    expect(result).toEqual({ allowed: false, remaining: 15 });
    expect(ctx.db.lots.every((l) => l.emailsRemaining === 5)).toBe(true);
    expect(ctx.db.ledger).toHaveLength(0);
    expect(ctx.db.accounts.get(TENANT_ID)?.balanceCached).toBe(15);
  });

  it('never spends expired lots', async () => {
    const ctx = buildService();
    ctx.addTenant();
    ctx.addLot({
      emailsTotal: 10,
      emailsRemaining: 10,
      expiresAt: new Date(Date.now() - DAY_MS),
    });
    ctx.db.accounts.set(TENANT_ID, {
      tenantId: TENANT_ID,
      balanceCached: 10,
      freeGrantClaimed: true,
      lowBalanceNotifiedAt: null,
    });
    const result = await ctx.service.consume(TENANT_ID, 1, 'job-1');
    expect(result).toEqual({ allowed: false, remaining: 0 });
  });

  it('is idempotent on the reference: a retry never double-charges', async () => {
    const ctx = buildService();
    ctx.addTenant();
    seedLots(ctx);
    const first = await ctx.service.consume(TENANT_ID, 3, 'job-9');
    expect(first).toEqual({ allowed: true, remaining: 12 });
    const retry = await ctx.service.consume(TENANT_ID, 3, 'job-9');
    expect(retry).toEqual({ allowed: true, remaining: 12, duplicate: true });
    expect(ctx.db.lots.reduce((s, l) => s + l.emailsRemaining, 0)).toBe(12);
    expect(ctx.db.ledger.filter((r) => r.kind === 'SEND')).toHaveLength(1);
  });

  it('resolves a concurrent retry via the P2002 backstop', async () => {
    const ctx = buildService();
    ctx.addTenant();
    seedLots(ctx);
    await ctx.service.consume(TENANT_ID, 3, 'job-race');
    // Simulate the race: the idempotency check misses, the ledger
    // create hits the partial unique index instead.
    ctx.db.blindFindFirstOnce = true;
    const retry = await ctx.service.consume(TENANT_ID, 3, 'job-race');
    expect(retry).toEqual({ allowed: true, remaining: 12, duplicate: true });
    expect(ctx.db.lots.reduce((s, l) => s + l.emailsRemaining, 0)).toBe(12);
  });

  it('rejects a non-positive count', async () => {
    const ctx = buildService();
    ctx.addTenant();
    await expect(ctx.service.consume(TENANT_ID, 0, 'job-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('warns once per low-balance crossing, then again after recovery', async () => {
    const ctx = buildService({ lowBalanceThreshold: 10 });
    ctx.addTenant();
    seedLots(ctx);
    // 15 → 9 crosses the threshold: one warning.
    await ctx.service.consume(TENANT_ID, 6, 'job-1');
    expect(ctx.mail.sendLowBalance).toHaveBeenCalledTimes(1);
    expect(ctx.mail.sendLowBalance).toHaveBeenCalledWith(
      expect.objectContaining({ remaining: 9, threshold: 10 }),
    );
    // Still below: no second warning.
    await ctx.service.consume(TENANT_ID, 1, 'job-2');
    expect(ctx.mail.sendLowBalance).toHaveBeenCalledTimes(1);
    // Recover above the threshold (operator adjustment clears the flag),
    // then cross again: a second warning.
    await ctx.service.adjustBalance(TENANT_ID, 5, 'test recovery', 'op-1');
    expect(ctx.db.accounts.get(TENANT_ID)?.lowBalanceNotifiedAt).toBeNull();
    await ctx.service.consume(TENANT_ID, 4, 'job-3');
    expect(ctx.mail.sendLowBalance).toHaveBeenCalledTimes(2);
  });

  it('does not warn when the balance starts below the threshold', async () => {
    const ctx = buildService({ lowBalanceThreshold: 10 });
    ctx.addTenant();
    ctx.addLot({ emailsTotal: 5, emailsRemaining: 5 });
    ctx.db.accounts.set(TENANT_ID, {
      tenantId: TENANT_ID,
      balanceCached: 5,
      freeGrantClaimed: true,
      lowBalanceNotifiedAt: null,
    });
    await ctx.service.consume(TENANT_ID, 1, 'job-1');
    expect(ctx.mail.sendLowBalance).not.toHaveBeenCalled();
  });
});

describe('EmailBalanceService — top-up', () => {
  const RATE = { unit: 'PER_EMAIL' as const, pricePerUnit: 0.5 };

  function mockInvoice(ctx: ReturnType<typeof buildService>, status = 'OPEN') {
    const invoice = {
      id: 'inv-1',
      number: 'INV-001',
      status,
      total: 500,
    };
    ctx.invoices.createInvoice.mockResolvedValue(invoice);
    ctx.db.invoices.set(invoice.id, {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
    });
    return invoice;
  }

  it('creates a PENDING top-up with the rate snapshotted + a TOPUP invoice', async () => {
    const ctx = buildService(RATE);
    ctx.addTenant();
    mockInvoice(ctx);
    const result = await ctx.service.createTopUp(TENANT_ID, 500, 'op-1');
    expect(result).toMatchObject({
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-001',
      emailsGranted: 1000,
    });
    expect(ctx.invoices.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        taxRatePercent: 0,
        lines: [
          expect.objectContaining({
            quantity: 1,
            unitPrice: 500,
            description: expect.stringContaining('1,000 emails'),
          }),
        ],
      }),
      'op-1',
    );
    expect(ctx.db.topUps).toHaveLength(1);
    expect(ctx.db.topUps[0]).toMatchObject({
      status: 'PENDING',
      amountBDT: 500,
      emailsGranted: 1000,
      rateSnapshot: { unit: 'PER_EMAIL', pricePerUnit: 0.5 },
    });
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.topup.create' }),
    );
  });

  it('rejects a top-up when the rate is not configured', async () => {
    const ctx = buildService();
    ctx.addTenant();
    await expect(ctx.service.createTopUp(TENANT_ID, 500)).rejects.toThrow(
      BadRequestException,
    );
    expect(ctx.invoices.createInvoice).not.toHaveBeenCalled();
  });

  it('rejects an amount below the price of 1 email', async () => {
    const ctx = buildService(RATE);
    ctx.addTenant();
    await expect(ctx.service.createTopUp(TENANT_ID, 0.49)).rejects.toThrow(
      /Minimum top-up/,
    );
  });

  it('rejects a top-up for a deleted tenant', async () => {
    const ctx = buildService(RATE);
    ctx.addTenant({ status: 'DELETED' });
    await expect(ctx.service.createTopUp(TENANT_ID, 500)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('credits immediately when open credit settles the invoice at creation', async () => {
    const ctx = buildService(RATE);
    ctx.addTenant();
    mockInvoice(ctx, 'PAID');
    const result = await ctx.service.createTopUp(TENANT_ID, 500, 'op-1');
    expect(result.emailsGranted).toBe(1000);
    expect(ctx.db.topUps[0].status).toBe('PAID');
    expect(ctx.db.lots).toHaveLength(1);
    expect(ctx.db.lots[0]).toMatchObject({
      source: 'TOPUP',
      emailsRemaining: 1000,
    });
    expect(ctx.db.accounts.get(TENANT_ID)?.balanceCached).toBe(1000);
  });
});

describe('EmailBalanceService — creditTopUp (approveProof hook)', () => {
  const RATE = { unit: 'PER_EMAIL' as const, pricePerUnit: 0.5 };

  async function pendingTopUp(
    ctx: ReturnType<typeof buildService>,
    emailsGranted = 1000,
  ) {
    ctx.addTenant();
    ctx.db.invoices.set('inv-1', {
      id: 'inv-1',
      number: 'INV-001',
      status: 'PAID',
    });
    const topUp = await ctx.prisma.emailTopUp.create({
      data: {
        tenantId: TENANT_ID,
        invoiceId: 'inv-1',
        amountBDT: 500,
        emailsGranted,
        rateSnapshot: { unit: 'PER_EMAIL', pricePerUnit: 0.5 },
      },
    });
    return topUp;
  }

  it('credits the lot + ledger + cache and marks the top-up PAID', async () => {
    const ctx = buildService(RATE);
    const topUp = await pendingTopUp(ctx);
    const result = await ctx.service.creditTopUp(ctx.prisma, {
      id: 'inv-1',
      status: 'PAID',
      number: 'INV-001',
    });
    expect(result).toEqual({ topUpId: topUp.id, emailsGranted: 1000 });
    expect(ctx.db.topUps[0]).toMatchObject({ status: 'PAID' });
    expect(ctx.db.topUps[0].paidAt).not.toBeNull();
    expect(ctx.db.lots).toHaveLength(1);
    expect(ctx.db.lots[0]).toMatchObject({
      source: 'TOPUP',
      emailsTotal: 1000,
      emailsRemaining: 1000,
      topUpId: topUp.id,
    });
    expect(ctx.db.ledger).toHaveLength(1);
    expect(ctx.db.ledger[0]).toMatchObject({
      kind: 'GRANT',
      delta: 1000,
      balanceAfter: 1000,
      reference: 'INV-001',
    });
    expect(ctx.db.accounts.get(TENANT_ID)?.balanceCached).toBe(1000);
  });

  it('is a no-op for a non-PAID invoice (partial payment credits nothing)', async () => {
    const ctx = buildService(RATE);
    await pendingTopUp(ctx);
    const result = await ctx.service.creditTopUp(ctx.prisma, {
      id: 'inv-1',
      status: 'PARTIALLY_PAID',
    });
    expect(result).toBeNull();
    expect(ctx.db.lots).toHaveLength(0);
    expect(ctx.db.topUps[0].status).toBe('PENDING');
  });

  it('is a no-op for an invoice with no top-up', async () => {
    const ctx = buildService(RATE);
    ctx.addTenant();
    const result = await ctx.service.creditTopUp(ctx.prisma, {
      id: 'inv-other',
      status: 'PAID',
    });
    expect(result).toBeNull();
  });

  it('cannot double-credit: the second call is a no-op', async () => {
    const ctx = buildService(RATE);
    await pendingTopUp(ctx);
    await ctx.service.creditTopUp(ctx.prisma, { id: 'inv-1', status: 'PAID' });
    const second = await ctx.service.creditTopUp(ctx.prisma, {
      id: 'inv-1',
      status: 'PAID',
    });
    expect(second).toBeNull();
    expect(ctx.db.lots).toHaveLength(1);
    expect(ctx.db.accounts.get(TENANT_ID)?.balanceCached).toBe(1000);
  });

  it('grants exactly the snapshotted count — an overpayment adds nothing', async () => {
    const ctx = buildService(RATE);
    // The invoice was overpaid (the excess is BDT credit, handled by
    // approveProof's CreditNote path); the lot is the snapshot only.
    await pendingTopUp(ctx, 1000);
    await ctx.service.creditTopUp(ctx.prisma, {
      id: 'inv-1',
      status: 'PAID',
    });
    expect(ctx.db.lots[0].emailsRemaining).toBe(1000);
  });

  it('computes expiry at credit time, not creation time', async () => {
    const ctx = buildService({
      ...RATE,
      expiry: { mode: 'FIXED_DAYS', days: 30, warnDays: 7 },
    });
    await pendingTopUp(ctx);
    const before = Date.now();
    await ctx.service.creditTopUp(ctx.prisma, {
      id: 'inv-1',
      status: 'PAID',
    });
    const expiresAt = ctx.db.lots[0].expiresAt?.getTime() ?? 0;
    expect(expiresAt).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
  });
});

describe('EmailBalanceService — operator adjustment', () => {
  it('adds a never-expiring lot for a positive delta', async () => {
    const ctx = buildService();
    ctx.addTenant();
    const result = await ctx.service.adjustBalance(
      TENANT_ID,
      25,
      'goodwill credit',
      'op-1',
    );
    expect(result).toMatchObject({ balance: 25, delta: 25 });
    expect(result.lotId).not.toBeNull();
    expect(ctx.db.lots[0]).toMatchObject({
      source: 'ADJUSTMENT',
      emailsRemaining: 25,
      expiresAt: null,
    });
    expect(ctx.db.ledger[0]).toMatchObject({
      kind: 'ADJUSTMENT',
      delta: 25,
      balanceAfter: 25,
      note: 'goodwill credit',
    });
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.balance.adjust' }),
    );
  });

  it('drains FEFO for a negative delta and cannot go below zero', async () => {
    const ctx = buildService();
    ctx.addTenant();
    ctx.addLot({ emailsTotal: 5, emailsRemaining: 5 });
    ctx.db.accounts.set(TENANT_ID, {
      tenantId: TENANT_ID,
      balanceCached: 5,
      freeGrantClaimed: true,
      lowBalanceNotifiedAt: null,
    });
    await expect(
      ctx.service.adjustBalance(TENANT_ID, -6, 'too much', 'op-1'),
    ).rejects.toThrow(/exceeds the spendable balance/);
    const result = await ctx.service.adjustBalance(
      TENANT_ID,
      -5,
      'correction',
      'op-1',
    );
    expect(result).toEqual({ balance: 0, delta: -5, lotId: null });
    expect(ctx.db.accounts.get(TENANT_ID)?.balanceCached).toBe(0);
  });

  it('requires a non-zero delta and a reason', async () => {
    const ctx = buildService();
    ctx.addTenant();
    await expect(
      ctx.service.adjustBalance(TENANT_ID, 0, 'x', 'op-1'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.service.adjustBalance(TENANT_ID, 5, '   ', 'op-1'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('EmailBalanceService — relay', () => {
  function seeded(ctx: ReturnType<typeof buildService>, emails = 10) {
    ctx.addTenant();
    ctx.addLot({ emailsTotal: emails, emailsRemaining: emails });
    ctx.db.accounts.set(TENANT_ID, {
      tenantId: TENANT_ID,
      balanceCached: emails,
      freeGrantClaimed: true,
      lowBalanceNotifiedAt: null,
    });
  }

  const INPUT = {
    tenantId: TENANT_ID,
    to: 'customer@example.com',
    subject: 'Order confirmed',
    html: '<p>Hi</p>',
    reference: 'job-1',
  };

  it('consumes 1, sends via the shared transport, and meters the send', async () => {
    const ctx = buildService();
    seeded(ctx);
    const result = await ctx.service.relaySend(INPUT);
    expect(result).toEqual({ sent: true, remaining: 9 });
    expect(ctx.mail.sendRelay).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'customer@example.com',
        subject: 'Order confirmed',
        fromName: 'Test Store',
      }),
    );
    expect(ctx.db.usageDaily).toHaveLength(1);
    expect(ctx.db.usageDaily[0]).toMatchObject({
      tenantId: TENANT_ID,
      metric: 'emails_sent_saas',
      value: 1,
    });
  });

  it('fails exhausted without sending when the balance is empty', async () => {
    const ctx = buildService();
    seeded(ctx, 0);
    const result = await ctx.service.relaySend(INPUT);
    expect(result).toEqual({
      sent: false,
      reason: 'email_balance_exhausted',
      remaining: 0,
    });
    expect(ctx.mail.sendRelay).not.toHaveBeenCalled();
  });

  it('fails for a suspended tenant without consuming', async () => {
    const ctx = buildService();
    seeded(ctx);
    ctx.db.tenants.get(TENANT_ID)!.status = 'SUSPENDED';
    const result = await ctx.service.relaySend(INPUT);
    expect(result.reason).toBe('tenant_suspended');
    expect(ctx.db.accounts.get(TENANT_ID)?.balanceCached).toBe(10);
    expect(ctx.mail.sendRelay).not.toHaveBeenCalled();
  });

  it('fails when the saas_smtp setting row is missing (kill switch)', async () => {
    const ctx = buildService();
    seeded(ctx);
    ctx.db.settingRows.delete('saas_smtp');
    const result = await ctx.service.relaySend(INPUT);
    expect(result.reason).toBe('saas_smtp_disabled');
    expect(ctx.db.accounts.get(TENANT_ID)?.balanceCached).toBe(10);
  });

  it('fails before consuming when platform SMTP is unconfigured', async () => {
    const ctx = buildService();
    seeded(ctx);
    ctx.mail.isConfigured.mockReturnValue(false);
    const result = await ctx.service.relaySend(INPUT);
    expect(result.reason).toBe('platform_smtp_unconfigured');
    expect(ctx.db.accounts.get(TENANT_ID)?.balanceCached).toBe(10);
  });

  it('reports send_failed after consuming (no automatic refund)', async () => {
    const ctx = buildService();
    seeded(ctx);
    ctx.mail.sendRelay.mockRejectedValueOnce(new Error('SMTP down'));
    const result = await ctx.service.relaySend(INPUT);
    expect(result).toEqual({
      sent: false,
      reason: 'send_failed',
      remaining: 9,
    });
    // Consumed and NOT refunded — the ledger shows the SEND.
    expect(ctx.db.accounts.get(TENANT_ID)?.balanceCached).toBe(9);
    expect(ctx.db.ledger.filter((r) => r.kind === 'SEND')).toHaveLength(1);
  });

  it('throws for an unknown tenant', async () => {
    const ctx = buildService();
    await expect(ctx.service.relaySend(INPUT)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('EmailBalanceService — expiry + warnings + reconcile', () => {
  it('expires past-due lots, zeroes them, and audits per tenant', async () => {
    const ctx = buildService();
    ctx.addTenant();
    const expired = ctx.addLot({
      emailsTotal: 8,
      emailsRemaining: 8,
      expiresAt: new Date(Date.now() - DAY_MS),
    });
    ctx.addLot({
      emailsTotal: 5,
      emailsRemaining: 5,
      expiresAt: new Date(Date.now() + 5 * DAY_MS),
    });
    ctx.db.accounts.set(TENANT_ID, {
      tenantId: TENANT_ID,
      balanceCached: 13,
      freeGrantClaimed: true,
      lowBalanceNotifiedAt: null,
    });
    const result = await ctx.service.expireLots();
    expect(result).toEqual({
      lotsExpired: 1,
      emailsExpired: 8,
      tenantsAffected: 1,
    });
    expect(
      ctx.db.lots.find((l) => l.id === expired.id)?.emailsRemaining,
    ).toBe(0);
    expect(ctx.db.accounts.get(TENANT_ID)?.balanceCached).toBe(5);
    expect(ctx.db.ledger).toHaveLength(1);
    expect(ctx.db.ledger[0]).toMatchObject({
      kind: 'EXPIRE',
      delta: -8,
      balanceAfter: 5,
      reference: expired.id,
    });
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.balance.expire' }),
    );
    // Idempotent: a second run expires nothing.
    expect(await ctx.service.expireLots()).toEqual({
      lotsExpired: 0,
      emailsExpired: 0,
      tenantsAffected: 0,
    });
  });

  it('warns once per lot inside the warn window', async () => {
    const ctx = buildService({
      expiry: { mode: 'FIXED_DAYS', days: 30, warnDays: 7 },
    });
    ctx.addTenant();
    ctx.addLot({
      emailsTotal: 4,
      emailsRemaining: 4,
      expiresAt: new Date(Date.now() + 3 * DAY_MS),
    });
    ctx.addLot({
      emailsTotal: 9,
      emailsRemaining: 9,
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
    });
    const first = await ctx.service.warnExpiringLots();
    expect(first).toEqual({ warningsSent: 1 });
    expect(ctx.mail.sendEmailExpiryWarning).toHaveBeenCalledTimes(1);
    expect(ctx.mail.sendEmailExpiryWarning).toHaveBeenCalledWith(
      expect.objectContaining({ emails: 4 }),
    );
    const second = await ctx.service.warnExpiringLots();
    expect(second).toEqual({ warningsSent: 0 });
    expect(ctx.mail.sendEmailExpiryWarning).toHaveBeenCalledTimes(1);
  });

  it('sends no warnings when warnDays is 0', async () => {
    const ctx = buildService({
      expiry: { mode: 'FIXED_DAYS', days: 30, warnDays: 0 },
    });
    ctx.addTenant();
    ctx.addLot({
      emailsTotal: 4,
      emailsRemaining: 4,
      expiresAt: new Date(Date.now() + DAY_MS),
    });
    expect(await ctx.service.warnExpiringLots()).toEqual({ warningsSent: 0 });
  });

  it('reconcile fixes a drifted cache and logs an ADJUSTMENT row', async () => {
    const ctx = buildService();
    ctx.addTenant();
    ctx.addLot({ emailsTotal: 10, emailsRemaining: 7 });
    ctx.db.accounts.set(TENANT_ID, {
      tenantId: TENANT_ID,
      balanceCached: 10, // drifted: lots sum to 7
      freeGrantClaimed: true,
      lowBalanceNotifiedAt: null,
    });
    const result = await ctx.service.reconcile();
    expect(result).toEqual({ checked: 1, drifted: 1 });
    expect(ctx.db.accounts.get(TENANT_ID)?.balanceCached).toBe(7);
    expect(ctx.db.ledger).toHaveLength(1);
    expect(ctx.db.ledger[0]).toMatchObject({
      kind: 'ADJUSTMENT',
      delta: -3,
      balanceAfter: 7,
      note: 'reconcile: cache drift correction',
    });
    expect(await ctx.service.reconcile()).toEqual({
      checked: 1,
      drifted: 0,
    });
  });
});

describe('EmailBalanceService — reads + money visibility', () => {
  it('getBalance returns lots in FEFO order (never-expiring last)', async () => {
    const ctx = buildService();
    ctx.addTenant();
    ctx.addLot({
      id: 'lot-never',
      emailsTotal: 5,
      emailsRemaining: 5,
      expiresAt: null,
    });
    ctx.addLot({
      id: 'lot-later',
      emailsTotal: 5,
      emailsRemaining: 5,
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
    });
    ctx.addLot({
      id: 'lot-soon',
      emailsTotal: 5,
      emailsRemaining: 5,
      expiresAt: new Date(Date.now() + 5 * DAY_MS),
    });
    ctx.db.accounts.set(TENANT_ID, {
      tenantId: TENANT_ID,
      balanceCached: 15,
      freeGrantClaimed: true,
      lowBalanceNotifiedAt: null,
    });
    const result = await ctx.service.getBalance(TENANT_ID);
    expect(result.balance).toBe(15);
    expect(result.lots.map((l: any) => l.id)).toEqual([
      'lot-soon',
      'lot-later',
      'lot-never',
    ]);
  });

  it('getBalance carries NO money fields anywhere (tenant-facing counts only)', async () => {
    const ctx = buildService({ unit: 'PER_EMAIL', pricePerUnit: 0.5 });
    ctx.addTenant();
    await ctx.service.grantFreeAllowance(TENANT_ID);
    const result = await ctx.service.getBalance(TENANT_ID);
    const keys = collectKeys(result);
    // 'total' is deliberately NOT in this list: emailsTotal and the
    // ledger meta total are counts, not money.
    const moneyKeys = [...keys].filter((k) =>
      /bdt|amount|price|revenue|money|cost/i.test(k),
    );
    expect(moneyKeys).toEqual([]);
  });

  it('getInternalBalance carries no money BALANCE — only the public rate preview', async () => {
    const ctx = buildService({ unit: 'PER_1000', pricePerUnit: 500 });
    ctx.addTenant();
    await ctx.service.grantFreeAllowance(TENANT_ID);
    const result = await ctx.service.getInternalBalance(TENANT_ID);
    expect(result.balance).toBe(10);
    expect(result.topUp).toEqual({
      rateConfigured: true,
      unit: 'PER_1000',
      pricePerUnit: 500,
      minimumBDT: 0.5,
      expiryMode: 'NONE',
      expiryDays: null,
    });
    // The only money-ish keys are the documented price list
    // (pricePerUnit/minimumBDT) — never a balance.
    const keys = collectKeys(result);
    const balanceMoneyKeys = [...keys].filter((k) =>
      /balance.*(bdt|amount|money)|amountBDT|revenueBDT|moneyBalance/i.test(k),
    );
    expect(balanceMoneyKeys).toEqual([]);
  });

  it('getInternalBalance reports an unconfigured rate as nulls', async () => {
    const ctx = buildService();
    ctx.addTenant();
    const result = await ctx.service.getInternalBalance(TENANT_ID);
    expect(result.topUp.rateConfigured).toBe(false);
    expect(result.topUp.pricePerUnit).toBeNull();
    expect(result.topUp.minimumBDT).toBeNull();
  });

  it('overview lists low tenants, expiring lots, and operator-only volume', async () => {
    const ctx = buildService({ lowBalanceThreshold: 10 });
    ctx.addTenant();
    ctx.addTenant({
      id: OTHER_TENANT_ID,
      name: 'Other Store',
      slug: 'other-store',
      status: 'TRIAL',
    });
    ctx.addLot({
      tenantId: TENANT_ID,
      emailsTotal: 5,
      emailsRemaining: 5,
      expiresAt: new Date(Date.now() + 3 * DAY_MS),
    });
    ctx.db.accounts.set(TENANT_ID, {
      tenantId: TENANT_ID,
      balanceCached: 5,
      freeGrantClaimed: true,
      lowBalanceNotifiedAt: null,
    });
    ctx.db.accounts.set(OTHER_TENANT_ID, {
      tenantId: OTHER_TENANT_ID,
      balanceCached: 500,
      freeGrantClaimed: true,
      lowBalanceNotifiedAt: null,
    });
    ctx.db.topUps.push({
      id: 'topup-1',
      tenantId: TENANT_ID,
      invoiceId: 'inv-1',
      amountBDT: 500,
      emailsGranted: 1000,
      rateSnapshot: {},
      status: 'PAID',
      createdAt: new Date(),
      paidAt: new Date(),
    });
    const result = await ctx.service.overview();
    expect(result.threshold).toBe(10);
    expect(result.lowBalanceTenants).toHaveLength(1);
    expect(result.lowBalanceTenants[0]).toMatchObject({
      tenantId: TENANT_ID,
      balance: 5,
    });
    expect(result.expiringLots).toHaveLength(1);
    expect(result.expiringLots[0]).toMatchObject({
      tenantId: TENANT_ID,
      emailsRemaining: 5,
    });
    // Operator-only totals (deliberately money — this endpoint is
    // console-only, never tenant-facing).
    expect(result.topUpVolume).toEqual({
      count: 1,
      emailsGranted: 1000,
      revenueBDT: 500,
    });
  });

  it('spendableBalance ignores expired lots', async () => {
    const ctx = buildService();
    ctx.addTenant();
    ctx.addLot({
      emailsTotal: 10,
      emailsRemaining: 10,
      expiresAt: new Date(Date.now() - DAY_MS),
    });
    ctx.addLot({ emailsTotal: 3, emailsRemaining: 3, expiresAt: null });
    expect(await ctx.service.spendableBalance(TENANT_ID)).toBe(3);
  });
});
