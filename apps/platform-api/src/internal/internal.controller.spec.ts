import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InternalController } from './internal.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const HANDOFF_ID = '22222222-2222-4222-8222-222222222222';

function makeController() {
  const prisma: any = {
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    platformSetting: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    auditLog: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const domainConfig = {
    getConfig: jest.fn().mockReturnValue({
      primaryDomain: 'ecomate.bd',
      baseDomains: ['ecomate.bd'],
      landingUrl: 'https://www.ecomate.bd',
      adminUrl: 'https://saas.ecomate.bd',
      customDomainCname: 'cname.ecomate.bd',
      allowExternalFallback: false,
      primaryHealthy: true,
      platformHosts: {
        landing: 'www.ecomate.bd',
        platformAdmin: 'saas.ecomate.bd',
        platformApi: 'api.ecomate.bd',
        webhooks: 'api.ecomate.bd',
      },
    }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const platformMail = { sendAuthMail: jest.fn().mockResolvedValue({ delivered: true }) };
  const rateLimit = { assert: jest.fn().mockResolvedValue(undefined) };
  const emailBalance = { relaySend: jest.fn() };
  return {
    prisma,
    domainConfig,
    audit,
    platformMail,
    rateLimit,
    emailBalance,
    // Registry + entitlements only use prisma; the other services are
    // stubs (billing/invoices predate this spec; emailBalance is the
    // SMTP worker's param). Phase 4 removed the ImpersonationService
    // constructor param (the consume route is deleted), so the
    // positional args start at billing.
    controller: new InternalController(
      prisma,
      {} as any,
      {} as any,
      emailBalance as any,
      domainConfig as any,
      audit as any,
      platformMail as any,
      rateLimit as any,
    ),
  };
}

function tenantFixture(overrides: any[] = []) {
  return {
    id: TENANT_ID,
    slug: 'acme',
    status: 'ACTIVE',
    domains: [],
    subscription: {
      status: 'ACTIVE',
      trialEndsAt: null,
      currentPeriodEnd: null,
    },
    planVersion: {
      id: 'pv-1',
      version: 1,
      features: ['admin_products'],
      limits: { products: 100, staff_users: 5 },
      plan: { name: 'Growth' },
    },
    limitOverrides: overrides,
  };
}

describe('InternalController — registry domain config', () => {
  it('includes the live domain config in the registry payload', async () => {
    const { controller } = makeController();
    const result = await controller.registry();

    expect(result.domains).toMatchObject({
      primaryDomain: 'ecomate.bd',
      baseDomains: ['ecomate.bd'],
      customDomainCname: 'cname.ecomate.bd',
      platformHosts: {
        landing: 'www.ecomate.bd',
        platformAdmin: 'saas.ecomate.bd',
      },
    });
  });
});

describe('InternalController — effective limits', () => {
  it('applies per-tenant overrides to the registry limits', async () => {
    const { controller, prisma } = makeController();
    prisma.tenant.findMany.mockResolvedValue([
      tenantFixture([
        { key: 'products', value: 250 },
        { key: 'storage_mb', value: 2048 },
      ]),
    ]);

    const result = await controller.registry();

    expect(result.tenants[0].plan?.limits).toEqual({
      products: 250,
      staff_users: 5,
      storage_mb: 2048,
    });
  });

  it('keeps plan limits for tenants without overrides', async () => {
    const { controller, prisma } = makeController();
    prisma.tenant.findMany.mockResolvedValue([tenantFixture()]);

    const result = await controller.registry();

    expect(result.tenants[0].plan?.limits).toEqual({
      products: 100,
      staff_users: 5,
    });
  });

  it('applies overrides to the entitlement snapshot used by tenant refresh', async () => {
    const { controller, prisma } = makeController();
    prisma.tenant.findUnique.mockResolvedValue({
      ...tenantFixture([{ key: 'products', value: 7 }]),
      subscription: {
        status: 'ACTIVE',
        trialEndsAt: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        planVersion: {
          id: 'pv-1',
          version: 1,
          features: ['admin_products'],
          limits: { products: 100, staff_users: 5 },
          trialDays: 14,
          graceDays: 7,
          plan: { name: 'Growth' },
        },
      },
      planVersion: null,
      trialEndsAt: null,
      graceEndsAt: null,
    });

    const result = await controller.entitlements(TENANT_ID);

    expect(result.plan?.limits).toEqual({ products: 7, staff_users: 5 });
    expect(result.overrides).toEqual([
      { key: 'products', value: 7, note: null },
    ]);
  });
});

describe('InternalController — organization-limit (Phase 3, D12)', () => {
  it('returns the stored setting row when present', async () => {
    const { controller, prisma } = makeController();
    prisma.platformSetting.findUnique.mockResolvedValue({
      key: 'organization_limit',
      value: { limit: 3 },
    });

    const result = await controller.organizationLimit();

    expect(prisma.platformSetting.findUnique).toHaveBeenCalledWith({
      where: { key: 'organization_limit' },
    });
    expect(result).toEqual({ limit: 3, source: 'setting' });
  });

  it('accepts a bare JSON number as the stored value', async () => {
    const { controller, prisma } = makeController();
    prisma.platformSetting.findUnique.mockResolvedValue({
      key: 'organization_limit',
      value: 7,
    });

    expect(await controller.organizationLimit()).toEqual({
      limit: 7,
      source: 'setting',
    });
  });

  it('returns the D12 default (5) when no row exists', async () => {
    const { controller } = makeController();
    expect(await controller.organizationLimit()).toEqual({
      limit: 5,
      source: 'default',
    });
  });

  it('returns the default for a malformed row and clamps out-of-range values', async () => {
    const { controller, prisma } = makeController();
    prisma.platformSetting.findUnique.mockResolvedValue({
      key: 'organization_limit',
      value: { limit: 'abc' },
    });
    expect(await controller.organizationLimit()).toEqual({
      limit: 5,
      source: 'default',
    });

    prisma.platformSetting.findUnique.mockResolvedValue({
      key: 'organization_limit',
      value: { limit: 0 },
    });
    expect(await controller.organizationLimit()).toEqual({
      limit: 1,
      source: 'setting',
    });

    prisma.platformSetting.findUnique.mockResolvedValue({
      key: 'organization_limit',
      value: { limit: 2000 },
    });
    expect(await controller.organizationLimit()).toEqual({
      limit: 1000,
      source: 'setting',
    });
  });
});

describe('InternalController — impersonations/consumed (Phase 3, D8)', () => {
  const body = {
    handoffId: HANDOFF_ID,
    organizationId: TENANT_ID,
    targetUserId: 'user_target-central-id',
    adminUserId: 'user_admin-central-id',
    consumedAt: new Date().toISOString(),
  };

  it('records the consumption as an audit row and returns recorded:true', async () => {
    const { controller, prisma, audit } = makeController();
    prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });

    const result = await controller.impersonationConsumed(body);

    expect(result).toEqual({ ok: true, recorded: true });
    expect(audit.record).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      action: 'tenant.impersonate.consumed',
      entity: 'Tenant',
      entityId: TENANT_ID,
      after: {
        handoffId: HANDOFF_ID,
        targetUserId: 'user_target-central-id',
        adminUserId: 'user_admin-central-id',
        consumedAt: body.consumedAt,
      },
    });
    // The central admin id is recorded in `after`, never as actorId
    // (AuditLog.actorId FKs to PlatformUser, which has no such row).
    expect(audit.record.mock.calls[0][0].actorId).toBeUndefined();
  });

  it('is idempotent: a retried callback with the same handoffId writes no second row', async () => {
    const { controller, prisma, audit } = makeController();
    prisma.tenant.findUnique.mockResolvedValue({ id: TENANT_ID });
    prisma.auditLog.findFirst.mockResolvedValue({ id: 'audit-1' });

    const result = await controller.impersonationConsumed(body);

    expect(result).toEqual({ ok: true, recorded: false, duplicate: true });
    expect(audit.record).not.toHaveBeenCalled();
    expect(prisma.auditLog.findFirst).toHaveBeenCalledWith({
      where: {
        action: 'tenant.impersonate.consumed',
        entityId: TENANT_ID,
        after: { path: ['handoffId'], equals: HANDOFF_ID },
      },
      select: { id: true },
    });
  });

  it('404s for an unknown tenant (no audit row)', async () => {
    const { controller, audit } = makeController();
    await expect(controller.impersonationConsumed(body)).rejects.toThrow(
      'Tenant not found',
    );
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('InternalController — registry pricing + blocking', () => {
  const PAST = new Date(Date.now() - 86_400_000);
  const FUTURE = new Date(Date.now() + 86_400_000);

  function registryFixture(overrides: Record<string, unknown> = {}): any {
    return {
      ...tenantFixture(),
      graceEndsAt: null,
      blockingOverride: null,
      pricingOverrides: [],
      purchases: [],
      planVersion: {
        ...tenantFixture().planVersion,
        price: 0,
        currency: 'BDT',
        pricing: {
          pricingVersion: 1,
          baseFee: { amount: 0, currency: 'BDT' },
          billingCycle: 'MONTHLY',
          metering: {
            metric: 'orders_per_month',
            included: 0,
            ratePerUnit: 10,
            minimumMonthly: 500,
          },
        },
      },
      ...overrides,
    };
  }

  it('blocks the plan areas once a PAST_DUE tenant is past grace', async () => {
    const { controller, prisma } = makeController();
    const fixture = registryFixture({
      status: 'PAST_DUE',
      graceEndsAt: PAST,
      subscription: {
        status: 'PAST_DUE',
        trialEndsAt: null,
        currentPeriodEnd: null,
      },
    });
    fixture.planVersion.pricing.blocking = {
      mode: 'grace_then_block',
      blockedAreas: ['orders', 'pos'],
    };
    prisma.tenant.findMany.mockResolvedValue([fixture]);

    const result = await controller.registry();

    expect(result.tenants[0].blockedAreas).toEqual(['orders', 'pos']);
  });

  it('does not block a PAST_DUE tenant still inside grace (grace_then_block)', async () => {
    const { controller, prisma } = makeController();
    const fixture = registryFixture({
      status: 'PAST_DUE',
      graceEndsAt: FUTURE,
      subscription: {
        status: 'PAST_DUE',
        trialEndsAt: null,
        currentPeriodEnd: null,
      },
    });
    fixture.planVersion.pricing.blocking = {
      mode: 'grace_then_block',
      blockedAreas: ['orders', 'pos'],
    };
    prisma.tenant.findMany.mockResolvedValue([fixture]);

    const result = await controller.registry();

    expect(result.tenants[0].blockedAreas).toEqual([]);
  });

  it('lets a per-tenant blocking override win over the plan config', async () => {
    const { controller, prisma } = makeController();
    const fixture = registryFixture({
      status: 'PAST_DUE',
      graceEndsAt: FUTURE,
      subscription: {
        status: 'PAST_DUE',
        trialEndsAt: null,
        currentPeriodEnd: null,
      },
      blockingOverride: {
        mode: 'block_immediately',
        blockedAreas: ['storefront_checkout'],
      },
    });
    fixture.planVersion.pricing.blocking = {
      mode: 'grace_then_block',
      blockedAreas: ['orders', 'pos'],
    };
    prisma.tenant.findMany.mockResolvedValue([fixture]);

    const result = await controller.registry();

    // block_immediately applies even inside the grace window.
    expect(result.tenants[0].blockedAreas).toEqual(['storefront_checkout']);
  });

  it('never blocks an ACTIVE tenant', async () => {
    const { controller, prisma } = makeController();
    const fixture = registryFixture();
    fixture.planVersion.pricing.blocking = {
      mode: 'block_immediately',
      blockedAreas: ['orders', 'pos'],
    };
    prisma.tenant.findMany.mockResolvedValue([fixture]);

    const result = await controller.registry();

    expect(result.tenants[0].blockedAreas).toEqual([]);
  });

  it('resolves effective pricing: override beats purchase beats plan', async () => {
    const { controller, prisma } = makeController();
    prisma.tenant.findMany.mockResolvedValue([
      registryFixture({
        pricingOverrides: [{ key: 'per_order_rate', value: 2 }],
        purchases: [
          {
            type: 'RATE_TIER',
            feeKey: 'lifetime-pro',
            effect: { type: 'rate_tier', perOrderRate: 1.5 },
          },
        ],
      }),
      registryFixture({
        purchases: [
          {
            type: 'RATE_TIER',
            feeKey: 'lifetime-pro',
            effect: { type: 'rate_tier', perOrderRate: 1.5 },
          },
        ],
      }),
      registryFixture(),
    ]);

    const result = await controller.registry();

    expect(result.tenants[0].effectivePricing).toEqual({
      baseFee: 0,
      ratePerUnit: 2,
      minimumMonthly: 500,
      currency: 'BDT',
    });
    expect(result.tenants[1].effectivePricing.ratePerUnit).toBe(1.5);
    expect(result.tenants[2].effectivePricing.ratePerUnit).toBe(10);
  });

  it('unions add-on + unlock features and merges add-on limits with max()', async () => {
    const { controller, prisma } = makeController();
    const fixture = registryFixture();
    fixture.subscription = {
      status: 'ACTIVE',
      trialEndsAt: null,
      currentPeriodEnd: null,
      addOns: [
        {
          addOn: {
            features: ['inbox'],
            limits: { products: 500, inbox_accounts: 5 },
          },
        },
      ],
    };
    fixture.purchases = [
      {
        type: 'FEATURE_UNLOCK',
        feeKey: 'unlock-analytics',
        effect: { type: 'feature_unlock', features: ['analytics'] },
      },
    ];
    fixture.limitOverrides = [{ key: 'products', value: 250 }];
    prisma.tenant.findMany.mockResolvedValue([fixture]);

    const result = await controller.registry();

    expect(result.tenants[0].plan?.features).toEqual(
      expect.arrayContaining(['admin_products', 'inbox', 'analytics']),
    );
    // Plan 100, override 250, add-on 500 → the max wins (500).
    expect(result.tenants[0].plan?.limits).toEqual({
      products: 500,
      staff_users: 5,
      inbox_accounts: 5,
    });
  });
});

describe('InternalController — auth-mail/send (Option 2, 2026-11-27)', () => {
  // Domain config for the auth-mail tests: staging-shaped — the auth
  // host derives as auth.<appDomain> and tenant hosts live under faah.net.
  const AUTH_DOMAINS = {
    primaryDomain: 'faah.net',
    appDomain: 'staging.em.commercians.com',
    baseDomains: ['faah.net'],
    landingUrl: 'https://www.ecomate.bd',
    adminUrl: 'https://saas.staging.em.commercians.com',
    customDomainCname: 'cname.faah.net',
    allowExternalFallback: false,
    primaryHealthy: true,
    platformHosts: {
      landing: 'www.ecomate.bd',
      platformAdmin: 'saas.staging.em.commercians.com',
      platformApi: 'api.staging.em.commercians.com',
      webhooks: 'api.staging.em.commercians.com',
    },
  };

  function authMailController() {
    const ctx = makeController();
    ctx.domainConfig.getConfig.mockReturnValue(AUTH_DOMAINS);
    return ctx;
  }

  it('sends an OTP sign-in mail: templates + audit, no balance consume', async () => {
    const { controller, platformMail, rateLimit, audit, emailBalance } =
      authMailController();

    const result = await controller.authMailSend({
      to: 'owner@test.com',
      kind: 'otp-sign-in',
      otp: '123456',
    } as any);

    expect(result).toEqual({ delivered: true });
    expect(platformMail.sendAuthMail).toHaveBeenCalledWith({
      to: 'owner@test.com',
      kind: 'otp-sign-in',
      otp: '123456',
      url: undefined,
    });
    // Rate limits: per-recipient (lowercased) then global, 20 / 200 per minute.
    expect(rateLimit.assert).toHaveBeenNthCalledWith(
      1,
      'auth-mail:to:owner@test.com',
      20,
      60_000,
      expect.any(String),
    );
    expect(rateLimit.assert).toHaveBeenNthCalledWith(
      2,
      'auth-mail:global',
      200,
      60_000,
      expect.any(String),
    );
    // Audit carries only {to, kind, sent} — never the OTP or a URL.
    expect(audit.record).toHaveBeenCalledWith({
      action: 'platform.auth_mail.send',
      entity: 'AuthMail',
      after: { to: 'owner@test.com', kind: 'otp-sign-in', sent: true },
    });
    // Platform auth mail is platform cost: the tenant relay is untouched.
    expect(emailBalance.relaySend).not.toHaveBeenCalled();
  });

  it('accepts the other OTP kinds and lowercases the per-recipient key', async () => {
    const { controller, platformMail, rateLimit } = authMailController();

    await controller.authMailSend({
      to: 'Owner@Test.com',
      kind: 'otp-forget-password',
      otp: '654321',
    } as any);
    await controller.authMailSend({
      to: 'owner@test.com',
      kind: 'otp-email-verification',
      otp: '000001',
    } as any);

    expect(platformMail.sendAuthMail).toHaveBeenNthCalledWith(1, {
      to: 'Owner@Test.com',
      kind: 'otp-forget-password',
      otp: '654321',
      url: undefined,
    });
    expect(rateLimit.assert).toHaveBeenCalledWith(
      'auth-mail:to:owner@test.com',
      20,
      60_000,
      expect.any(String),
    );
  });

  it('accepts verification/reset links on the auth host and tenant hosts', async () => {
    const { controller, platformMail } = authMailController();

    await controller.authMailSend({
      to: 'owner@test.com',
      kind: 'verification',
      url: 'https://auth.staging.em.commercians.com/api/better-auth/verify-email?token=abc',
    } as any);
    await controller.authMailSend({
      to: 'owner@test.com',
      kind: 'reset',
      url: 'https://features-test-store.staging.faah.net/admin/reset-password?token=abc',
    } as any);

    expect(platformMail.sendAuthMail).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['OTP kind without an OTP', { to: 'a@b.co', kind: 'otp-sign-in' }],
    ['OTP too short', { to: 'a@b.co', kind: 'otp-sign-in', otp: '12345' }],
    ['OTP too long', { to: 'a@b.co', kind: 'otp-sign-in', otp: '1234567' }],
    ['OTP non-numeric', { to: 'a@b.co', kind: 'otp-sign-in', otp: 'abcdef' }],
    [
      'OTP kind with a URL',
      { to: 'a@b.co', kind: 'otp-sign-in', otp: '123456', url: 'https://auth.staging.em.commercians.com/x' },
    ],
    ['verification without a URL', { to: 'a@b.co', kind: 'verification' }],
    [
      'verification with an OTP',
      { to: 'a@b.co', kind: 'verification', otp: '123456', url: 'https://auth.staging.em.commercians.com/x' },
    ],
    ['reset without a URL', { to: 'a@b.co', kind: 'reset' }],
    [
      'http link (not https)',
      { to: 'a@b.co', kind: 'reset', url: 'http://auth.staging.em.commercians.com/x' },
    ],
    [
      'unrelated host',
      { to: 'a@b.co', kind: 'reset', url: 'https://evil.example.com/reset?token=abc' },
    ],
    [
      'bare tenant base domain is not a tenant host',
      { to: 'a@b.co', kind: 'reset', url: 'https://faah.net/reset?token=abc' },
    ],
    [
      'credentials in the URL',
      { to: 'a@b.co', kind: 'reset', url: 'https://user:pass@auth.staging.em.commercians.com/x' },
    ],
    ['not a URL at all', { to: 'a@b.co', kind: 'reset', url: 'not-a-url' }],
  ])('rejects %s with 400 and sends nothing', async (_label, body) => {
    const { controller, platformMail, rateLimit, audit } = authMailController();

    await expect(controller.authMailSend(body as any)).rejects.toThrow(
      BadRequestException,
    );
    expect(platformMail.sendAuthMail).not.toHaveBeenCalled();
    expect(rateLimit.assert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('maps SMTP-unconfigured to 503 and audits platform_smtp_unconfigured', async () => {
    const { controller, platformMail, audit } = authMailController();
    platformMail.sendAuthMail.mockRejectedValue(
      new ServiceUnavailableException(
        'Email delivery is not configured. Set SMTP settings first.',
      ),
    );

    await expect(
      controller.authMailSend({
        to: 'owner@test.com',
        kind: 'otp-sign-in',
        otp: '123456',
      } as any),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(audit.record).toHaveBeenCalledWith({
      action: 'platform.auth_mail.send',
      entity: 'AuthMail',
      after: {
        to: 'owner@test.com',
        kind: 'otp-sign-in',
        sent: false,
        reason: 'platform_smtp_unconfigured',
      },
    });
  });

  it('maps transport failures to 502 (not 503) and audits send_failed', async () => {
    const { controller, platformMail, audit } = authMailController();
    platformMail.sendAuthMail.mockRejectedValue(
      new Error('535 Incorrect authentication data'),
    );

    await expect(
      controller.authMailSend({
        to: 'owner@test.com',
        kind: 'otp-sign-in',
        otp: '123456',
      } as any),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(audit.record).toHaveBeenCalledWith({
      action: 'platform.auth_mail.send',
      entity: 'AuthMail',
      after: {
        to: 'owner@test.com',
        kind: 'otp-sign-in',
        sent: false,
        reason: 'send_failed',
      },
    });
  });

  it('propagates the 429 and never sends when rate-limited', async () => {
    const { controller, platformMail, rateLimit, audit } = authMailController();
    rateLimit.assert.mockRejectedValueOnce(
      new HttpException('Too many requests.', HttpStatus.TOO_MANY_REQUESTS),
    );

    await expect(
      controller.authMailSend({
        to: 'owner@test.com',
        kind: 'otp-sign-in',
        otp: '123456',
      } as any),
    ).rejects.toThrow('Too many requests.');

    expect(platformMail.sendAuthMail).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
