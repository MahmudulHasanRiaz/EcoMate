import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
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
  const captcha = { verify: jest.fn().mockResolvedValue(true) };
  const rateLimit = { assert: jest.fn() };
  const mail = {
    sendVerification: jest.fn().mockResolvedValue({ delivered: true }),
    sendWelcome: jest.fn().mockResolvedValue({ delivered: true }),
  };
  const provisioning = {
    startForSignup: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };
  return {
    prisma,
    captcha,
    rateLimit,
    mail,
    provisioning,
    service: new SignupService(
      prisma,
      captcha as any,
      rateLimit as any,
      mail as any,
      provisioning as any,
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
    captcha.verify.mockResolvedValue(false);
    await expect(service.create(dto as any)).rejects.toBeInstanceOf(
      BadRequestException,
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
