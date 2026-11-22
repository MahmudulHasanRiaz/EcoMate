import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { SignupService } from './signup.service';

const sha256 = (v: string) =>
  createHash('sha256').update(v).digest('hex');

function makeService() {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    provisioningJob: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    signupRequest: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'signup-1',
        ...data,
      })),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'signup-1',
        ...data,
      })),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
  const captcha = { verify: jest.fn().mockResolvedValue({ ok: true }) };
  const rateLimit = {
    assert: jest.fn(),
    consume: jest.fn().mockResolvedValue(true),
  };
  const mail = {
    sendVerification: jest.fn().mockResolvedValue({ delivered: true }),
    sendWelcome: jest.fn().mockResolvedValue({ delivered: true }),
  };
  const provisioning = {
    startForSignup: jest.fn().mockResolvedValue({ id: 'job-1' }),
    retry: jest.fn().mockResolvedValue({ id: 'job-1', status: 'FAILED' }),
  };
  const domainConfig = {
    absoluteUrl: (slug: string, path: string) =>
      `https://${slug}.ecomate.bd${path}`,
    landingUrl: () => 'http://localhost:3002',
  };
  return {
    prisma,
    captcha,
    rateLimit,
    mail,
    provisioning,
    domainConfig,
    service: new SignupService(
      prisma,
      captcha as any,
      rateLimit as any,
      mail as any,
      provisioning as any,
      domainConfig as any,
    ),
  };
}

const dto = {
  tenantName: 'Acme Store',
  slug: 'acme',
  ownerEmail: 'Owner@Example.com',
  password: 'correct-horse-battery',
  acceptTerms: true,
  captchaToken: 'captcha-token',
};

describe('SignupService — abuse controls', () => {
  it('rejects disposable email providers', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.create(
        { ...dto, ownerEmail: 'owner@mailinator.com' } as any,
        { ip: '1.2.3.4' },
      ),
    ).rejects.toThrow('Disposable email');
    expect(prisma.signupRequest.create).not.toHaveBeenCalled();
  });

  it('rejects a phone already used by a tenant', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findFirst.mockImplementation(async ({ where }: any) =>
      where?.ownerPhone ? { id: 'tenant-1' } : null,
    );

    await expect(
      service.create(
        { ...dto, ownerPhone: '01700000000' } as any,
        { ip: '1.2.3.4' },
      ),
    ).rejects.toThrow('phone number');
    expect(prisma.signupRequest.create).not.toHaveBeenCalled();
  });

  it('rejects a phone already pending verification', async () => {
    const { service, prisma } = makeService();
    prisma.signupRequest.findFirst.mockImplementation(async ({ where }: any) =>
      where?.ownerPhone ? { id: 'signup-pending' } : null,
    );

    await expect(
      service.create(
        { ...dto, ownerPhone: '+880 1700-000000' } as any,
        { ip: '1.2.3.4' },
      ),
    ).rejects.toThrow('phone number');
  });

  it('queries every common form of the phone number', async () => {
    const { service, prisma } = makeService();
    await service.create(
      { ...dto, ownerPhone: '+880 1700-000000' } as any,
      { ip: '1.2.3.4' },
    );

    const phoneQuery = (
      prisma.tenant.findFirst as jest.Mock
    ).mock.calls.find(([args]) => args?.where?.ownerPhone);
    expect(phoneQuery?.[0].where.ownerPhone.in).toEqual(
      expect.arrayContaining(['+8801700000000', '01700000000', '8801700000000']),
    );
  });
});

describe('SignupService — create', () => {
  it('creates a pending signup with a hashed password/token and emails the link', async () => {
    const { service, prisma, mail, captcha, rateLimit } = makeService();

    const result = await service.create(dto as any, {
      ip: '1.2.3.4',
      userAgent: 'test-agent',
    });

    expect(captcha.verify).toHaveBeenCalledWith('captcha-token', '1.2.3.4');
    expect(rateLimit.assert).toHaveBeenCalledWith(
      'signup:ip:1.2.3.4',
      5,
      600_000,
    );
    const created = prisma.signupRequest.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      tenantName: 'Acme Store',
      slug: 'acme',
      ownerEmail: 'owner@example.com',
      status: 'PENDING_EMAIL',
      ipAddress: '1.2.3.4',
      userAgent: 'test-agent',
    });
    expect(created.passwordHash).not.toBe(dto.password);
    expect(created.verificationTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.verificationExpiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(mail.sendVerification).toHaveBeenCalledTimes(1);
    const mailArg = mail.sendVerification.mock.calls[0][0];
    expect(mailArg.to).toBe('owner@example.com');
    expect(mailArg.verificationUrl).toContain('/verify-email?token=');
    expect(JSON.stringify(result)).not.toContain('token=');
  });

  it('rejects a filled honeypot before doing any work', async () => {
    const { service, prisma, mail } = makeService();
    await expect(
      service.create({ ...dto, website: 'spam' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.signupRequest.create).not.toHaveBeenCalled();
    expect(mail.sendVerification).not.toHaveBeenCalled();
  });

  it('rejects a failed CAPTCHA', async () => {
    const { service, captcha, prisma } = makeService();
    captcha.verify.mockResolvedValue({ ok: false, reason: 'failed' });
    await expect(service.create(dto as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.signupRequest.create).not.toHaveBeenCalled();
  });

  it('returns 503 with captcha_not_configured when the secret is unset in production', async () => {
    const { service, captcha, prisma } = makeService();
    captcha.verify.mockResolvedValue({
      ok: false,
      reason: 'not_configured',
    });
    const error = await service
      .create(dto as any)
      .catch((err) => err);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({ code: 'captcha_not_configured' }),
    );
    expect(prisma.signupRequest.create).not.toHaveBeenCalled();
  });

  it('rejects reserved and malformed slugs', async () => {
    const { service } = makeService();
    for (const slug of ['www', 'ab', 'Acme Store']) {
      await expect(
        service.create({ ...dto, slug } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('rejects an existing tenant slug', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    await expect(service.create(dto as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects an already-registered owner email', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findFirst.mockResolvedValue({ id: 'tenant-1' });
    await expect(service.create(dto as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects a pending signup for the same email', async () => {
    const { service, prisma } = makeService();
    prisma.signupRequest.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'signup-existing' });
    await expect(service.create(dto as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deletes the signup when the verification email cannot be sent', async () => {
    const { service, prisma, mail } = makeService();
    mail.sendVerification.mockRejectedValue(new Error('smtp down'));
    await expect(service.create(dto as any)).rejects.toThrow('smtp down');
    expect(prisma.signupRequest.delete).toHaveBeenCalledWith({
      where: { id: 'signup-1' },
    });
  });

  it('maps a concurrent-submit P2002 to the same 409 as assertAvailable', async () => {
    const { service, prisma } = makeService();
    const error: any = new Error('Unique constraint failed');
    error.code = 'P2002';
    prisma.signupRequest.create.mockRejectedValue(error);
    const caught = await service
      .create(dto as any, { ip: '1.2.3.4' })
      .catch((err) => err);
    expect(caught).toBeInstanceOf(ConflictException);
    expect(caught.getStatus()).toBe(409);
    expect(caught.message).toBe('This store address is already taken');
  });

  it('propagates non-P2002 insert errors unchanged', async () => {
    const { service, prisma } = makeService();
    prisma.signupRequest.create.mockRejectedValue(new Error('db down'));
    await expect(service.create(dto as any, { ip: '1.2.3.4' })).rejects.toThrow(
      'db down',
    );
  });
});

describe('SignupService — checkSubdomainAvailability', () => {
  it('returns available when no tenant or signup holds the slug', async () => {
    const { service, prisma } = makeService();
    const result = await service.checkSubdomainAvailability('acme', '1.2.3.4');
    expect(result).toEqual({
      slug: 'acme',
      available: true,
      reason: 'available',
    });
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { slug: 'acme' },
    });
    const pendingCall = prisma.signupRequest.findFirst.mock.calls[0][0];
    expect(pendingCall.where.slug).toBe('acme');
    expect(pendingCall.where.OR).toEqual(
      expect.arrayContaining([
        { status: 'VERIFIED' },
        {
          status: 'PENDING_EMAIL',
          verificationExpiresAt: { gt: expect.any(Date) },
        },
      ]),
    );
  });

  it('returns taken when a tenant holds the slug', async () => {
    const { service, prisma } = makeService();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    const result = await service.checkSubdomainAvailability('acme', '1.2.3.4');
    expect(result).toEqual({
      slug: 'acme',
      available: false,
      reason: 'taken',
    });
  });

  it('returns taken when an unexpired pending signup holds the slug', async () => {
    const { service, prisma } = makeService();
    prisma.signupRequest.findFirst.mockResolvedValue({ id: 'signup-1' });
    const result = await service.checkSubdomainAvailability('acme', '1.2.3.4');
    expect(result).toEqual({
      slug: 'acme',
      available: false,
      reason: 'taken',
    });
  });

  it('queries only VERIFIED or unexpired PENDING_EMAIL rows (the §3.3 agreement case)', async () => {
    // An expired PENDING_EMAIL row must NOT block: create() calls
    // expireStale() before assertAvailable, so submit would succeed.
    // The check proves agreement by filtering on verificationExpiresAt
    // instead of calling expireStale() (the check is read-only). The
    // live probe proves the end-to-end behaviour against real rows.
    const { service, prisma } = makeService();
    const before = Date.now();
    await service.checkSubdomainAvailability('acme', '1.2.3.4');
    const pendingCall = prisma.signupRequest.findFirst.mock.calls[0][0];
    const pendingBranch = pendingCall.where.OR.find(
      (branch: any) => branch.status === 'PENDING_EMAIL',
    );
    expect(pendingBranch).toBeDefined();
    expect(
      pendingBranch.verificationExpiresAt.gt.getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(prisma.signupRequest.updateMany).not.toHaveBeenCalled();
  });

  it('returns invalid-format without touching the DB', async () => {
    const { service, prisma } = makeService();
    for (const slug of ['ab', 'a'.repeat(31), '-acme', 'acme-', 'acme_store']) {
      const result = await service.checkSubdomainAvailability(slug, '1.2.3.4');
      expect(result).toEqual({
        slug: slug.trim().toLowerCase(),
        available: false,
        reason: 'invalid-format',
      });
    }
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(prisma.signupRequest.findFirst).not.toHaveBeenCalled();
  });

  it('returns reserved without touching the DB', async () => {
    const { service, prisma } = makeService();
    const result = await service.checkSubdomainAvailability('www', '1.2.3.4');
    expect(result).toEqual({
      slug: 'www',
      available: false,
      reason: 'reserved',
    });
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(prisma.signupRequest.findFirst).not.toHaveBeenCalled();
  });

  it('returns invalid-format for a missing or empty slug', async () => {
    const { service, prisma } = makeService();
    for (const slug of ['', '   ', undefined as any]) {
      const result = await service.checkSubdomainAvailability(slug, '1.2.3.4');
      expect(result).toEqual({
        slug: '',
        available: false,
        reason: 'invalid-format',
      });
    }
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(prisma.signupRequest.findFirst).not.toHaveBeenCalled();
  });

  it('returns invalid-format for over-long input without touching the DB', async () => {
    const { service, prisma } = makeService();
    const result = await service.checkSubdomainAvailability(
      'a'.repeat(101),
      '1.2.3.4',
    );
    expect(result).toEqual({
      slug: 'a'.repeat(101),
      available: false,
      reason: 'invalid-format',
    });
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(prisma.signupRequest.findFirst).not.toHaveBeenCalled();
  });

  it('normalises case and whitespace before judging', async () => {
    const { service, prisma } = makeService();
    const result = await service.checkSubdomainAvailability(
      '  Acme-Store  ',
      '1.2.3.4',
    );
    expect(result).toEqual({
      slug: 'acme-store',
      available: true,
      reason: 'available',
    });
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { slug: 'acme-store' },
    });
  });

  it('rate-limits at 30/min/IP with a check-specific 429 message', async () => {
    const { service, rateLimit, prisma } = makeService();
    rateLimit.consume.mockResolvedValue(false);
    const error = await service
      .checkSubdomainAvailability('acme', '1.2.3.4')
      .catch((err) => err);
    expect(error.getStatus()).toBe(429);
    expect(error.message).toBe(
      'Too many availability checks. Please try again in a moment.',
    );
    expect(error.message).not.toContain('signup attempts');
    expect(rateLimit.consume).toHaveBeenCalledWith(
      'subdomain-check:ip:1.2.3.4',
      30,
      60_000,
    );
    // No work happens once the limit trips.
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('consumes the limit even for cheap local answers, keyed per IP', async () => {
    const { service, rateLimit } = makeService();
    await service.checkSubdomainAvailability('ab', '1.2.3.4');
    await service.checkSubdomainAvailability('www', '5.6.7.8');
    expect(rateLimit.consume).toHaveBeenCalledWith(
      'subdomain-check:ip:1.2.3.4',
      30,
      60_000,
    );
    expect(rateLimit.consume).toHaveBeenCalledWith(
      'subdomain-check:ip:5.6.7.8',
      30,
      60_000,
    );
  });
});

describe('SignupService — verify', () => {
  const token = 'a'.repeat(64);
  const baseRequest = {
    id: 'signup-1',
    slug: 'acme',
    tenantName: 'Acme Store',
    status: 'PENDING_EMAIL',
    verificationExpiresAt: new Date(Date.now() + 60_000),
    verificationTokenHash: sha256(token),
  };

  it('marks a valid token verified', async () => {
    const { service, prisma, provisioning } = makeService();
    prisma.signupRequest.findUnique.mockResolvedValue(baseRequest);

    const result = await service.verify(token);

    expect(result).toMatchObject({
      verified: true,
      alreadyVerified: false,
      slug: 'acme',
    });
    expect(prisma.signupRequest.update).toHaveBeenCalledWith({
      where: { id: 'signup-1' },
      data: expect.objectContaining({ status: 'VERIFIED' }),
    });
    expect(provisioning.startForSignup).toHaveBeenCalledWith('signup-1');
  });

  it('is idempotent for an already verified request', async () => {
    const { service, prisma } = makeService();
    prisma.signupRequest.findUnique.mockResolvedValue({
      ...baseRequest,
      status: 'VERIFIED',
    });
    const result = await service.verify(token);
    expect(result.alreadyVerified).toBe(true);
    expect(prisma.signupRequest.update).not.toHaveBeenCalled();
  });

  it('rejects an expired request and marks it expired', async () => {
    const { service, prisma } = makeService();
    prisma.signupRequest.findUnique.mockResolvedValue({
      ...baseRequest,
      verificationExpiresAt: new Date(Date.now() - 1_000),
    });
    await expect(service.verify(token)).rejects.toBeInstanceOf(GoneException);
    expect(prisma.signupRequest.update).toHaveBeenCalledWith({
      where: { id: 'signup-1' },
      data: { status: 'EXPIRED' },
    });
  });

  it('rejects an unknown token', async () => {
    const { service } = makeService();
    await expect(service.verify(token)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a malformed token', async () => {
    const { service } = makeService();
    await expect(service.verify('nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SignupService — provisioning progress and retry', () => {
  const token = 'b'.repeat(64);
  const verified = {
    id: 'signup-1',
    slug: 'acme',
    tenantName: 'Acme Store',
    status: 'VERIFIED',
    verificationExpiresAt: new Date(Date.now() + 60_000),
    verificationTokenHash: sha256(token),
  };

  it('returns job progress and the workspace URLs', async () => {
    const { service, prisma } = makeService();
    prisma.signupRequest.findUnique.mockResolvedValue(verified);
    prisma.provisioningJob.findUnique.mockResolvedValue({
      id: 'job-1',
      status: 'RUNNING',
      step: 'seeding',
      attempts: 1,
    });
    prisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-1',
      status: 'PROVISIONING',
    });

    const result = await service.status(token);

    expect(result).toMatchObject({
      status: 'VERIFIED',
      tenantStatus: 'PROVISIONING',
      urls: {
        admin: 'https://acme.ecomate.bd/admin/',
        storefront: 'https://acme.ecomate.bd/',
      },
      provisioning: { status: 'RUNNING', step: 'seeding', attempts: 1 },
    });
  });

  it('retries a failed job in the background', async () => {
    const { service, prisma, provisioning } = makeService();
    prisma.signupRequest.findUnique.mockResolvedValue(verified);
    prisma.provisioningJob.findUnique.mockResolvedValue({
      id: 'job-1',
      status: 'FAILED',
      step: 'failed',
      attempts: 2,
    });

    const result = await service.retryProvisioning(token);

    expect(result.started).toBe(true);
    expect(provisioning.retry).toHaveBeenCalledWith('job-1');
  });

  it('does not retry a job that is still running', async () => {
    const { service, prisma, provisioning } = makeService();
    prisma.signupRequest.findUnique.mockResolvedValue(verified);
    prisma.provisioningJob.findUnique.mockResolvedValue({
      id: 'job-1',
      status: 'RUNNING',
      step: 'seeding',
      attempts: 1,
    });

    const result = await service.retryProvisioning(token);

    expect(result.started).toBe(false);
    expect(provisioning.retry).not.toHaveBeenCalled();
  });

  it('starts provisioning when verification never created a job', async () => {
    const { service, prisma, provisioning } = makeService();
    prisma.signupRequest.findUnique.mockResolvedValue(verified);

    const result = await service.retryProvisioning(token);

    expect(result).toEqual({ started: true, provisioning: null });
    expect(provisioning.startForSignup).toHaveBeenCalledWith('signup-1');
  });
});

describe('SignupService — resend', () => {
  it('replaces the token and emails a fresh link', async () => {
    const { service, prisma, mail } = makeService();
    prisma.signupRequest.findFirst.mockResolvedValue({
      id: 'signup-1',
      tenantName: 'Acme Store',
      ownerEmail: 'owner@example.com',
      status: 'PENDING_EMAIL',
      verificationTokenHash: 'old-hash',
      verificationExpiresAt: new Date(),
    });

    const result = await service.resend({
      email: 'Owner@Example.com',
      captchaToken: 'captcha-token',
    } as any);

    expect(result.message).toContain('If a pending signup exists');
    expect(prisma.signupRequest.update).toHaveBeenCalledWith({
      where: { id: 'signup-1' },
      data: expect.objectContaining({
        status: 'PENDING_EMAIL',
        verificationTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
    expect(mail.sendVerification).toHaveBeenCalledTimes(1);
  });

  it('returns the same generic message when nothing is pending', async () => {
    const { service, prisma, mail } = makeService();
    const result = await service.resend({ email: 'nobody@example.com' } as any);
    expect(result.message).toContain('If a pending signup exists');
    expect(prisma.signupRequest.update).not.toHaveBeenCalled();
    expect(mail.sendVerification).not.toHaveBeenCalled();
  });

  it('returns 503 with captcha_not_configured when the secret is unset in production', async () => {
    const { service, captcha, mail } = makeService();
    captcha.verify.mockResolvedValue({
      ok: false,
      reason: 'not_configured',
    });
    const error = await service
      .resend({ email: 'owner@example.com' } as any)
      .catch((err) => err);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toEqual(
      expect.objectContaining({ code: 'captcha_not_configured' }),
    );
    expect(mail.sendVerification).not.toHaveBeenCalled();
  });

  it('restores the previous link when the resend email fails', async () => {
    const { service, prisma, mail } = makeService();
    prisma.signupRequest.findFirst.mockResolvedValue({
      id: 'signup-1',
      tenantName: 'Acme Store',
      ownerEmail: 'owner@example.com',
      status: 'PENDING_EMAIL',
      verificationTokenHash: 'old-hash',
      verificationExpiresAt: new Date(1_000),
    });
    mail.sendVerification.mockRejectedValue(new Error('smtp down'));

    await expect(
      service.resend({ email: 'owner@example.com' } as any),
    ).rejects.toThrow('smtp down');
    expect(prisma.signupRequest.update).toHaveBeenLastCalledWith({
      where: { id: 'signup-1' },
      data: {
        verificationTokenHash: 'old-hash',
        verificationExpiresAt: new Date(1_000),
      },
    });
  });
});
