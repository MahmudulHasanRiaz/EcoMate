import { BadRequestException, HttpException } from '@nestjs/common';
import { validate } from 'class-validator';
import { RedisRateLimitService } from '../common/rate-limit/redis-rate-limit.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { LeadsService } from './leads.service';

function makeService(overrides: Record<string, any> = {}) {
  const prisma: any = {
    $transaction: jest
      .fn()
      .mockImplementation(async (ops: any[]) => Promise.all(ops)),
    lead: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'lead-1',
        status: 'NEW',
        source: 'landing_page_lead_form',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'lead-1',
        status: data.status,
      })),
    },
  };
  const captcha = {
    isConfigured: jest.fn().mockReturnValue(false),
    verify: jest.fn().mockResolvedValue({ ok: true }),
  };
  const rateLimit = { assert: jest.fn().mockResolvedValue(undefined) };
  const mail = {
    isConfigured: jest.fn().mockReturnValue(false),
    sendLeadNotification: jest
      .fn()
      .mockResolvedValue({ delivered: true }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const deps = {
    prisma,
    captcha,
    rateLimit,
    mail,
    audit,
    ...overrides,
  };
  return {
    ...deps,
    service: new LeadsService(
      deps.prisma,
      deps.captcha as any,
      deps.rateLimit as any,
      deps.mail as any,
      deps.audit as any,
    ),
  };
}

const validDto = {
  name: '  Ayesha Khan  ',
  contact: 'ayesha@example.com',
  message: 'We sell 500 orders a month.',
  monthlyOrders: '500',
};

describe('LeadsService.create — validation', () => {
  it('persists a trimmed lead with derived email contactType', async () => {
    const { service, prisma, mail } = makeService();
    const result = await service.create(validDto as any, {
      ip: '1.2.3.4',
      userAgent: 'test-agent',
    });
    expect(result).toEqual({ id: 'lead-1' });
    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: {
        name: 'Ayesha Khan',
        contact: 'ayesha@example.com',
        contactType: 'email',
        message: 'We sell 500 orders a month.',
        monthlyOrders: '500',
        ip: '1.2.3.4',
        userAgent: 'test-agent',
      },
    });
    expect(mail.sendLeadNotification).not.toHaveBeenCalled();
  });

  it('derives phone contactType for a Bangladeshi number', async () => {
    const { service, prisma } = makeService();
    await service.create(
      { ...validDto, contact: '+880 1894-828290', message: undefined } as any,
      { ip: '1.2.3.4' },
    );
    expect(prisma.lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contact: '+880 1894-828290',
          contactType: 'phone',
          message: null,
        }),
      }),
    );
  });

  it('rejects a bad contact and persists nothing', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.create({ ...validDto, contact: 'not-a-contact' } as any, {}),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('rejects a name that trims below 2 characters', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.create({ ...validDto, name: '  a ' } as any, {}),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });
});

describe('CreateLeadDto — class-validator', () => {
  async function errorsFor(input: Record<string, unknown>) {
    return validate(Object.assign(new CreateLeadDto(), input));
  }

  it('accepts a valid lead', async () => {
    expect(
      await errorsFor({
        name: 'Ayesha Khan',
        contact: '01700000000',
        monthlyOrders: '100-200',
      }),
    ).toEqual([]);
  });

  it('rejects a missing name', async () => {
    const errors = await errorsFor({ contact: 'a@b.com' });
    expect(errors.map((e) => e.property)).toContain('name');
  });

  it('rejects a bad contact', async () => {
    const errors = await errorsFor({
      name: 'Ayesha',
      contact: 'not-a-contact',
    });
    expect(errors.map((e) => e.property)).toContain('contact');
  });

  it('rejects an overlong message', async () => {
    const errors = await errorsFor({
      name: 'Ayesha',
      contact: 'a@b.com',
      message: 'x'.repeat(2001),
    });
    expect(errors.map((e) => e.property)).toContain('message');
  });

  it('rejects an overlong monthlyOrders', async () => {
    const errors = await errorsFor({
      name: 'Ayesha',
      contact: 'a@b.com',
      monthlyOrders: 'x'.repeat(51),
    });
    expect(errors.map((e) => e.property)).toContain('monthlyOrders');
  });
});

describe('LeadsService.create — rate limit', () => {
  it('returns 429 after the per-IP threshold (real in-memory limiter)', async () => {
    const limiter = new RedisRateLimitService('memory');
    const { service, prisma } = makeService({ rateLimit: limiter });
    for (let i = 0; i < 5; i += 1) {
      await service.create(validDto as any, { ip: '9.9.9.9' });
    }
    expect(prisma.lead.create).toHaveBeenCalledTimes(5);
    await expect(
      service.create(validDto as any, { ip: '9.9.9.9' }),
    ).rejects.toMatchObject({ status: 429 });
    expect(prisma.lead.create).toHaveBeenCalledTimes(5);
  });

  it('does not share the budget across IPs', async () => {
    const limiter = new RedisRateLimitService('memory');
    const { service } = makeService({ rateLimit: limiter });
    for (let i = 0; i < 5; i += 1) {
      await service.create(validDto as any, { ip: '9.9.9.9' });
    }
    await expect(
      service.create(validDto as any, { ip: '8.8.8.8' }),
    ).resolves.toEqual({ id: 'lead-1' });
  });

  it('propagates a 429 from the limiter without persisting', async () => {
    const { service, prisma } = makeService({
      rateLimit: {
        assert: jest
          .fn()
          .mockRejectedValue(new HttpException('Too many', 429)),
      },
    });
    await expect(service.create(validDto as any, {})).rejects.toMatchObject({
      status: 429,
    });
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });
});

describe('LeadsService.create — mail resilience', () => {
  it('still returns 201 and persists when the notification throws', async () => {
    const { service, prisma, mail } = makeService();
    mail.isConfigured.mockReturnValue(true);
    mail.sendLeadNotification.mockRejectedValue(
      new Error('SMTP connection refused'),
    );
    const result = await service.create(validDto as any, {});
    expect(result).toEqual({ id: 'lead-1' });
    expect(prisma.lead.create).toHaveBeenCalledTimes(1);
    expect(mail.sendLeadNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'sales@ecomate.bd',
        name: 'Ayesha Khan',
        contact: 'ayesha@example.com',
        contactType: 'email',
      }),
    );
  });

  it('does not attempt mail when SMTP is unconfigured', async () => {
    const { service, mail } = makeService();
    mail.isConfigured.mockReturnValue(false);
    await service.create(validDto as any, {});
    expect(mail.sendLeadNotification).not.toHaveBeenCalled();
  });

  it('notifies sales@ecomate.bd when SMTP is configured', async () => {
    const { service, mail } = makeService();
    mail.isConfigured.mockReturnValue(true);
    await service.create(validDto as any, {});
    expect(mail.sendLeadNotification).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'sales@ecomate.bd' }),
    );
  });
});

describe('LeadsService.create — Turnstile (verify-if-present)', () => {
  it('succeeds with no token even when a secret is configured', async () => {
    const { service, captcha } = makeService();
    captcha.isConfigured.mockReturnValue(true);
    const { turnstileToken, ...noToken } = validDto as any;
    void turnstileToken;
    await expect(service.create(noToken, {})).resolves.toEqual({
      id: 'lead-1',
    });
    expect(captcha.verify).not.toHaveBeenCalled();
  });

  it('succeeds with a token when no secret is configured (no verification)', async () => {
    const { service, captcha } = makeService();
    captcha.isConfigured.mockReturnValue(false);
    await expect(
      service.create({ ...validDto, turnstileToken: 'any-token' } as any, {}),
    ).resolves.toEqual({ id: 'lead-1' });
    expect(captcha.verify).not.toHaveBeenCalled();
  });

  it('rejects a bad token with 400 when a secret is configured', async () => {
    const { service, captcha, prisma } = makeService();
    captcha.isConfigured.mockReturnValue(true);
    captcha.verify.mockResolvedValue({ ok: false, reason: 'failed' });
    await expect(
      service.create({ ...validDto, turnstileToken: 'bad-token' } as any, {}),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('accepts a verified token when a secret is configured', async () => {
    const { service, captcha } = makeService();
    captcha.isConfigured.mockReturnValue(true);
    captcha.verify.mockResolvedValue({ ok: true });
    await expect(
      service.create({ ...validDto, turnstileToken: 'good-token' } as any, {
        ip: '1.2.3.4',
      }),
    ).resolves.toEqual({ id: 'lead-1' });
    expect(captcha.verify).toHaveBeenCalledWith('good-token', '1.2.3.4');
  });

  it('never surfaces the signup 503: any failed verification is a plain 400', async () => {
    // Leads are verify-if-present, not fail-closed — even a
    // not_configured result (which the isConfigured gate makes
    // unreachable in practice) must not leak signup's 503 code.
    const { service, captcha } = makeService();
    captcha.isConfigured.mockReturnValue(true);
    captcha.verify.mockResolvedValue({
      ok: false,
      reason: 'not_configured',
    });
    const error = await service
      .create({ ...validDto, turnstileToken: 'token' } as any, {})
      .catch((err) => err);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getStatus()).toBe(400);
  });
});

describe('LeadsService — admin reads and triage', () => {
  it('lists newest first with a status filter and pagination meta', async () => {
    const { service, prisma } = makeService();
    const rows = [{ id: 'lead-2' }, { id: 'lead-1' }];
    prisma.lead.findMany.mockResolvedValue(rows);
    prisma.lead.count.mockResolvedValue(2);
    const result = await service.list({
      page: '1',
      limit: '20',
      status: 'NEW',
    });
    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'NEW' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      }),
    );
    expect(result).toEqual({
      data: rows,
      meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
    });
  });

  it('ignores an unknown status filter', async () => {
    const { service, prisma } = makeService();
    await service.list({ status: 'BOGUS' });
    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('returns the detail row and 404s for an unknown id', async () => {
    const { service, prisma } = makeService();
    prisma.lead.findUnique.mockResolvedValue({ id: 'lead-1' });
    await expect(service.detail('lead-1')).resolves.toEqual({ id: 'lead-1' });
    prisma.lead.findUnique.mockResolvedValue(null);
    await expect(service.detail('missing')).rejects.toThrow(
      'Lead not found',
    );
  });

  it('updates status and audits before/after', async () => {
    const { service, prisma, audit } = makeService();
    prisma.lead.findUnique.mockResolvedValue({
      id: 'lead-1',
      status: 'NEW',
    });
    const result = await service.updateStatus(
      'lead-1',
      { status: 'CONTACTED' },
      'user-1',
    );
    expect(result.status).toBe('CONTACTED');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'lead.status.update',
        entity: 'Lead',
        entityId: 'lead-1',
        before: { status: 'NEW' },
        after: { status: 'CONTACTED' },
      }),
    );
  });

  it('404s on status update for an unknown lead', async () => {
    const { service, prisma, audit } = makeService();
    prisma.lead.findUnique.mockResolvedValue(null);
    await expect(
      service.updateStatus('missing', { status: 'CLOSED' }, 'user-1'),
    ).rejects.toThrow('Lead not found');
    expect(audit.record).not.toHaveBeenCalled();
  });
});
