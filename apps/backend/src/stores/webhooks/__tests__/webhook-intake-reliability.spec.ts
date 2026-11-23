/**
 * Intake reliability — Phase 9 webhook fix (G-11, G-16; J-03, J-06, J-07, J-11).
 *
 * (e) enqueue failure → 503 (never a false 200) + ENQUEUE_FAILED row +
 *     the begun run finishes FAILED (no worker will ever finish it).
 * (h) missing delivery id on a VERIFIED delivery → 400 + anomaly row
 *     (never a silent accept, never a 401 — the signature passed).
 * (i) non-Woo unsigned probe → quiet 200 before the resolver, the DB,
 *     or any failure accounting (Woo-header gate).
 * Plus: signature failure → 401 + row + fire-and-forget heal call;
 * unknown store → 401 + UNKNOWN_STORE row; failure payloads are
 * sanitized (no PII / secrets / raw bodies — J-11).
 *
 * Service-level with mocked Prisma/queues/runs + the REAL WooCommerce
 * provider (HMAC is the thing under test on the negative paths).
 */
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { WooCommerceProvider } from '../../providers/woocommerce.provider';
import { buildWooDelivery } from '../../providers/__tests__/fixtures';
import { StoreWebhookService } from '../store-webhook.service';

const STORE_ID = 'store-rel-1';
const SECRET = 'wh_rel_secret';
const TENANT_ID = 'tenant-rel-1';

const BASE_STORE = {
  id: STORE_ID,
  tenantId: TENANT_ID,
  kind: 'WOOCOMMERCE',
  status: 'CONNECTED',
  name: 'Reliability Store',
};

// A realistic order payload carrying customer PII + a secret-looking
// meta blob — NONE of it may land in a failure row (J-11).
const ORDER_PAYLOAD = {
  id: 'ext-rel-1',
  status: 'processing',
  total: 250,
  currency: 'BDT',
  customer: { name: 'Sara Ahmed', phone: '01700000001', email: 'sara@example.com' },
  shipping: { address_1: 'House 1, Road 2, Dhaka' },
  meta_data: [{ key: '_wc_secret_note', value: 'sk_live_do_not_persist' }],
  line_items: [{ sku: 'SKU-1', quantity: 1, price: 250 }],
};

function buildIntake(opts: {
  storeRow?: any;
  secrets?: Record<string, unknown>;
  enqueueOrThrowImpl?: jest.Mock;
  resolveResult?: { tenantId: string; status: string } | null;
  withResolver?: boolean;
} = {}) {
  const storeRow = opts.storeRow === undefined ? BASE_STORE : opts.storeRow;
  const prisma: any = {
    store: {
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
        if (!storeRow || where?.id !== storeRow.id) return null;
        return storeRow;
      }),
    },
    storeWebhookDelivery: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    storeOrderMapping: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const stores: any = {
    storeWithSecrets: jest.fn().mockImplementation(async (id: string) => ({
      id,
      kind: storeRow?.kind ?? 'WOOCOMMERCE',
      settings: {},
      secrets: opts.secrets ?? { webhookSecret: SECRET },
    })),
  };
  const registry: any = {
    providerFor: jest.fn().mockReturnValue(new WooCommerceProvider()),
  };
  const runs: any = {
    begin: jest.fn().mockResolvedValue({ id: 'run-rel-1' }),
    finish: jest.fn().mockResolvedValue({}),
    recordItem: jest.fn().mockResolvedValue({}),
    upsertIssue: jest.fn().mockResolvedValue({}),
  };
  const queues: any = {
    enqueue: jest.fn().mockResolvedValue(undefined),
    enqueueOrThrow: opts.enqueueOrThrowImpl ?? jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  const resolver: any = {
    resolveStore: jest.fn().mockResolvedValue(
      opts.resolveResult === undefined ? { tenantId: TENANT_ID, status: 'ACTIVE' } : opts.resolveResult,
    ),
  };
  const failures: any = { recordFailureSafe: jest.fn().mockResolvedValue({ id: 'fail-1' }) };
  const webhookHeal: any = {
    maybeHealOnSignatureFailure: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new StoreWebhookService(
    prisma,
    registry,
    stores,
    runs,
    queues,
    opts.withResolver ? resolver : undefined,
    undefined,
    failures,
    webhookHeal,
  );
  return { svc, prisma, runs, queues, resolver, failures, webhookHeal };
}

describe('intake reliability — enqueue failure (G-11, J-03)', () => {
  it('(e) enqueue failure → 503 + ENQUEUE_FAILED row + run finished FAILED (no false 200)', async () => {
    const { svc, runs, failures } = buildIntake({
      enqueueOrThrowImpl: jest.fn().mockRejectedValue(new Error('redis down')),
    });
    const d = buildWooDelivery(SECRET, ORDER_PAYLOAD);
    let caught: unknown;
    try {
      await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect((caught as ServiceUnavailableException).getStatus()).toBe(503);
    expect((caught as Error).message).toBe('Webhook ingest temporarily unavailable');
    // The failure row carries the delivery identity + a SANITIZED payload.
    expect(failures.recordFailureSafe).toHaveBeenCalledTimes(1);
    const row = failures.recordFailureSafe.mock.calls[0][0];
    expect(row).toMatchObject({ storeId: STORE_ID, topic: 'order.created', reason: 'ENQUEUE_FAILED' });
    expect(row.deliveryKey).toMatch(/^[0-9a-f]{64}$/);
    expect(row.payload).toMatchObject({
      externalOrderId: 'ext-rel-1',
      status: 'processing',
      total: 250,
      itemCount: 1,
    });
    // J-11: no PII, no secrets, no raw body in the row.
    const serialized = JSON.stringify(row.payload);
    expect(serialized).not.toContain('Sara Ahmed');
    expect(serialized).not.toContain('01700000001');
    expect(serialized).not.toContain('sara@example.com');
    expect(serialized).not.toContain('House 1');
    expect(serialized).not.toContain('sk_live_do_not_persist');
    // No worker will ever finish this run — intake finishes it FAILED.
    expect(runs.finish).toHaveBeenCalledTimes(1);
    expect(runs.finish).toHaveBeenCalledWith('run-rel-1', {
      created: 0,
      updated: 0,
      failed: 1,
    });
  });

  it('enqueueOrThrow returning null (entitlement skip) → ack 200, run finished as skipped', async () => {
    const { svc, runs, failures } = buildIntake({
      enqueueOrThrowImpl: jest.fn().mockResolvedValue(null),
    });
    const d = buildWooDelivery(SECRET, ORDER_PAYLOAD);
    const res = await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    expect(res).toEqual({ received: true, duplicate: false });
    expect(failures.recordFailureSafe).not.toHaveBeenCalled();
    expect(runs.finish).toHaveBeenCalledWith('run-rel-1', {
      created: 0,
      updated: 0,
      skipped: 1,
      failed: 0,
    });
  });
});

describe('intake reliability — missing delivery id (J-06)', () => {
  it('(h) verified delivery without an id → 400 + MISSING_DELIVERY_ID row, no enqueue', async () => {
    const { svc, prisma, queues, failures } = buildIntake();
    const d = buildWooDelivery(SECRET, ORDER_PAYLOAD);
    delete (d.headers as Record<string, string>)['X-WC-Webhook-Delivery-ID'];
    let caught: unknown;
    try {
      await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getStatus()).toBe(400);
    expect((caught as Error).message).toBe('Missing delivery id');
    expect(failures.recordFailureSafe).toHaveBeenCalledTimes(1);
    expect(failures.recordFailureSafe).toHaveBeenCalledWith({
      storeId: STORE_ID,
      topic: 'order.created',
      reason: 'MISSING_DELIVERY_ID',
    });
    expect(prisma.storeWebhookDelivery.create).not.toHaveBeenCalled();
    expect(queues.enqueueOrThrow).not.toHaveBeenCalled();
  });
});

describe('intake reliability — Woo-header gate (J-07)', () => {
  it('(i) non-Woo unsigned probe → quiet 200 before resolver / DB / failure accounting', async () => {
    const { svc, prisma, queues, resolver, failures, webhookHeal } = buildIntake({
      withResolver: true,
    });
    const res = await svc.intake(
      'woocommerce',
      STORE_ID,
      { 'user-agent': 'masscan/1.0', 'content-type': 'application/json' },
      Buffer.from(JSON.stringify({ probe: true }), 'utf8'),
    );
    expect(res).toEqual({ received: true, duplicate: false });
    expect(resolver.resolveStore).not.toHaveBeenCalled();
    expect(prisma.store.findUnique).not.toHaveBeenCalled();
    expect(prisma.storeWebhookDelivery.findUnique).not.toHaveBeenCalled();
    expect(failures.recordFailureSafe).not.toHaveBeenCalled();
    expect(webhookHeal.maybeHealOnSignatureFailure).not.toHaveBeenCalled();
    expect(queues.enqueueOrThrow).not.toHaveBeenCalled();
  });

  it('probe carrying a signature but no Woo identity headers is still gated (header check precedes verify)', async () => {
    const { svc, prisma, failures } = buildIntake();
    const res = await svc.intake(
      'woocommerce',
      STORE_ID,
      { 'X-WC-Webhook-Signature': 'bogus-signature-value' },
      Buffer.from(JSON.stringify(ORDER_PAYLOAD), 'utf8'),
    );
    expect(res).toEqual({ received: true, duplicate: false });
    expect(prisma.store.findUnique).not.toHaveBeenCalled();
    expect(failures.recordFailureSafe).not.toHaveBeenCalled();
  });
});

describe('intake reliability — signature + unknown-store rows (G-16, J-01)', () => {
  it('bad signature → generic 401 + SIGNATURE_MISMATCH row + fire-and-forget heal call', async () => {
    const { svc, queues, failures, webhookHeal } = buildIntake();
    const d = buildWooDelivery('wrong-secret', ORDER_PAYLOAD);
    let caught: unknown;
    try {
      await svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect((caught as Error).message).toBe('Unauthorized');
    expect(failures.recordFailureSafe).toHaveBeenCalledTimes(1);
    expect(failures.recordFailureSafe).toHaveBeenCalledWith({
      storeId: STORE_ID,
      topic: 'order.created',
      reason: 'SIGNATURE_MISMATCH',
    });
    // Heal is fire-and-forget: invoked (synchronously) with the
    // provider's reason, never awaited in the request path.
    expect(webhookHeal.maybeHealOnSignatureFailure).toHaveBeenCalledTimes(1);
    expect(webhookHeal.maybeHealOnSignatureFailure).toHaveBeenCalledWith(STORE_ID, 'bad-signature');
    expect(queues.enqueueOrThrow).not.toHaveBeenCalled();
  });

  it('a throwing healer never changes the 401 (heal errors are swallowed)', async () => {
    const { svc, webhookHeal } = buildIntake();
    webhookHeal.maybeHealOnSignatureFailure.mockRejectedValue(new Error('heal exploded'));
    const d = buildWooDelivery('wrong-secret', ORDER_PAYLOAD);
    await expect(svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody)).rejects.toThrow(
      'Unauthorized',
    );
    // Let the fire-and-forget promise settle so jest sees no unhandled rejection.
    await new Promise((r) => setImmediate(r));
    expect(webhookHeal.maybeHealOnSignatureFailure).toHaveBeenCalledTimes(1);
  });

  it('no webhook secret configured → NO_SECRET row (not SIGNATURE_MISMATCH)', async () => {
    const { svc, failures } = buildIntake({ secrets: {} });
    const d = buildWooDelivery(SECRET, ORDER_PAYLOAD);
    await expect(svc.intake('woocommerce', STORE_ID, d.headers, d.rawBody)).rejects.toThrow(
      'Unauthorized',
    );
    expect(failures.recordFailureSafe).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: STORE_ID, reason: 'NO_SECRET' }),
    );
  });

  it('unknown store → generic 401 + UNKNOWN_STORE row with a null storeId (no oracle)', async () => {
    const { svc, failures } = buildIntake({ storeRow: null });
    const d = buildWooDelivery(SECRET, ORDER_PAYLOAD);
    await expect(
      svc.intake('woocommerce', 'store-ghost-1', d.headers, d.rawBody),
    ).rejects.toThrow('Unauthorized');
    expect(failures.recordFailureSafe).toHaveBeenCalledTimes(1);
    expect(failures.recordFailureSafe).toHaveBeenCalledWith({
      storeId: null,
      topic: 'order.created',
      reason: 'UNKNOWN_STORE',
      payload: { storeKey: 'store-gh…' },
    });
  });
});
