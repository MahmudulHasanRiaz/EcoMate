import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import { PLATFORM_ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { UpdateLeadFollowUpDto } from './dto/update-lead-followup.dto';
import { UpdateLeadNotesDto } from './dto/update-lead-notes.dto';
import { LeadsController } from './leads.controller';
import { isLeadOverdue, LeadsService } from './leads.service';

function makeService(overrides: Record<string, any> = {}) {
  const prisma: any = {
    $transaction: jest
      .fn()
      .mockImplementation(async (ops: any[]) => Promise.all(ops)),
    lead: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: 'lead-1',
        status: 'NEW',
        assignedToId: data.assignedToId ?? null,
        followUpAt: data.followUpAt ?? null,
        internalNotes: data.internalNotes ?? null,
        assignedTo: data.assignedToId
          ? { id: data.assignedToId, name: 'Ops One', email: 'ops@ecomate.bd' }
          : null,
      })),
    },
    platformUser: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    tenant: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const captcha = {
    isConfigured: jest.fn().mockReturnValue(false),
    verify: jest.fn().mockResolvedValue({ ok: true }),
  };
  const rateLimit = { assert: jest.fn().mockResolvedValue(undefined) };
  const mail = {
    isConfigured: jest.fn().mockReturnValue(false),
    sendLeadNotification: jest.fn().mockResolvedValue({ delivered: true }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const deps = { prisma, captcha, rateLimit, mail, audit, ...overrides };
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

const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';

function leadWith(overrides: Record<string, any> = {}) {
  return {
    id: 'lead-1',
    status: 'NEW',
    assignedToId: null,
    followUpAt: null,
    internalNotes: null,
    ...overrides,
  };
}

describe('isLeadOverdue — the overdue rule', () => {
  const now = new Date('2026-11-19T12:00:00.000Z');
  const past = new Date('2026-11-18T12:00:00.000Z');
  const future = new Date('2026-11-20T12:00:00.000Z');

  it('is overdue when the follow-up is past on a live lead', () => {
    for (const status of ['NEW', 'CONTACTED', 'QUALIFIED', 'DEMO_SCHEDULED']) {
      expect(isLeadOverdue({ status, followUpAt: past }, now)).toBe(true);
    }
  });

  it('is never overdue in a terminal status, however old the date', () => {
    for (const status of ['WON', 'CLOSED', 'LOST']) {
      expect(isLeadOverdue({ status, followUpAt: past }, now)).toBe(false);
    }
  });

  it('is not overdue with a future date, no date, or an ISO string date', () => {
    expect(isLeadOverdue({ status: 'NEW', followUpAt: future }, now)).toBe(
      false,
    );
    expect(isLeadOverdue({ status: 'NEW', followUpAt: null }, now)).toBe(
      false,
    );
    expect(isLeadOverdue({ status: 'NEW' }, now)).toBe(false);
    expect(
      isLeadOverdue(
        { status: 'CONTACTED', followUpAt: '2026-11-18T12:00:00.000Z' },
        now,
      ),
    ).toBe(true);
  });
});

describe('LeadsService — assign', () => {
  it('assigns to an active operator and audits before/after', async () => {
    const { service, prisma, audit } = makeService();
    prisma.lead.findUnique.mockResolvedValue(leadWith());
    prisma.platformUser.findUnique.mockResolvedValue({
      id: OPERATOR_ID,
      role: 'SUPPORT',
      status: 'ACTIVE',
    });
    const result = await service.assign(
      'lead-1',
      { assignedToId: OPERATOR_ID },
      'user-1',
    );
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1' },
        data: { assignedToId: OPERATOR_ID },
        include: expect.objectContaining({
          assignedTo: { select: { id: true, name: true, email: true } },
        }),
      }),
    );
    expect(result.assignedToId).toBe(OPERATOR_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'lead.assigned',
        entity: 'Lead',
        entityId: 'lead-1',
        before: { assignedToId: null },
        after: { assignedToId: OPERATOR_ID },
      }),
    );
  });

  it('unassigns with a null assignee and audits the clear', async () => {
    const { service, prisma, audit } = makeService();
    prisma.lead.findUnique.mockResolvedValue(
      leadWith({ assignedToId: OPERATOR_ID }),
    );
    await service.assign('lead-1', { assignedToId: null }, 'user-1');
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { assignedToId: null } }),
    );
    expect(prisma.platformUser.findUnique).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead.assigned',
        before: { assignedToId: OPERATOR_ID },
        after: { assignedToId: null },
      }),
    );
  });

  it('404s for an unknown lead and audits nothing', async () => {
    const { service, prisma, audit } = makeService();
    prisma.lead.findUnique.mockResolvedValue(null);
    await expect(
      service.assign('missing', { assignedToId: OPERATOR_ID }, 'user-1'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('404s for an unknown operator and updates nothing', async () => {
    const { service, prisma, audit } = makeService();
    prisma.lead.findUnique.mockResolvedValue(leadWith());
    prisma.platformUser.findUnique.mockResolvedValue(null);
    await expect(
      service.assign('lead-1', { assignedToId: OPERATOR_ID }, 'user-1'),
    ).rejects.toThrow('Operator not found');
    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('400s for a DISABLED operator or a READONLY user', async () => {
    const { service, prisma, audit } = makeService();
    prisma.lead.findUnique.mockResolvedValue(leadWith());
    prisma.platformUser.findUnique.mockResolvedValue({
      id: OPERATOR_ID,
      role: 'SUPPORT',
      status: 'DISABLED',
    });
    await expect(
      service.assign('lead-1', { assignedToId: OPERATOR_ID }, 'user-1'),
    ).rejects.toThrow(BadRequestException);
    prisma.platformUser.findUnique.mockResolvedValue({
      id: OPERATOR_ID,
      role: 'READONLY',
      status: 'ACTIVE',
    });
    await expect(
      service.assign('lead-1', { assignedToId: OPERATOR_ID }, 'user-1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('LeadsService — follow-up', () => {
  it('sets the follow-up date and audits ISO before/after', async () => {
    const { service, prisma, audit } = makeService();
    prisma.lead.findUnique.mockResolvedValue(leadWith());
    const result = await service.updateFollowUp(
      'lead-1',
      { followUpAt: '2026-11-25T10:00:00.000Z' },
      'user-1',
    );
    expect(result.followUpAt).toEqual(new Date('2026-11-25T10:00:00.000Z'));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'lead.followup.update',
        before: { followUpAt: null },
        after: { followUpAt: '2026-11-25T10:00:00.000Z' },
      }),
    );
  });

  it('clears the follow-up with null', async () => {
    const { service, prisma, audit } = makeService();
    prisma.lead.findUnique.mockResolvedValue(
      leadWith({ followUpAt: new Date('2026-11-20T10:00:00.000Z') }),
    );
    await service.updateFollowUp('lead-1', { followUpAt: null }, 'user-1');
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { followUpAt: null } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'lead.followup.update',
        before: { followUpAt: '2026-11-20T10:00:00.000Z' },
        after: { followUpAt: null },
      }),
    );
  });

  it('400s on an invalid date and 404s on an unknown lead', async () => {
    const { service, prisma, audit } = makeService();
    prisma.lead.findUnique.mockResolvedValue(leadWith());
    await expect(
      service.updateFollowUp('lead-1', { followUpAt: 'not-a-date' }, 'user-1'),
    ).rejects.toThrow(BadRequestException);
    prisma.lead.findUnique.mockResolvedValue(null);
    await expect(
      service.updateFollowUp(
        'missing',
        { followUpAt: '2026-11-25T10:00:00.000Z' },
        'user-1',
      ),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('LeadsService — notes', () => {
  it('trims and saves notes, audited', async () => {
    const { service, prisma, audit } = makeService();
    prisma.lead.findUnique.mockResolvedValue(leadWith());
    const result = await service.updateNotes(
      'lead-1',
      { internalNotes: '  Called twice, no answer.  ' },
      'user-1',
    );
    expect(result.internalNotes).toBe('Called twice, no answer.');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'lead.notes.update',
        before: { internalNotes: null },
        after: { internalNotes: 'Called twice, no answer.' },
      }),
    );
  });

  it('clears notes on blank input', async () => {
    const { service, prisma } = makeService();
    prisma.lead.findUnique.mockResolvedValue(
      leadWith({ internalNotes: 'old note' }),
    );
    await service.updateNotes('lead-1', { internalNotes: '   ' }, 'user-1');
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { internalNotes: null } }),
    );
  });

  it('404s on an unknown lead', async () => {
    const { service, prisma, audit } = makeService();
    prisma.lead.findUnique.mockResolvedValue(null);
    await expect(
      service.updateNotes('missing', { internalNotes: 'x' }, 'user-1'),
    ).rejects.toThrow(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('LeadsService — overdue list filter + assignees', () => {
  it('filters overdue: past follow-up AND non-terminal status', async () => {
    const { service, prisma } = makeService();
    await service.list({ overdue: 'true' });
    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          followUpAt: { lt: expect.any(Date) },
          status: { notIn: ['WON', 'CLOSED', 'LOST'] },
        },
      }),
    );
  });

  it('keeps an explicit status filter over the terminal exclusion', async () => {
    const { service, prisma } = makeService();
    await service.list({ status: 'WON', overdue: 'true' });
    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'WON',
          followUpAt: { lt: expect.any(Date) },
        },
      }),
    );
  });

  it('does not filter when overdue is absent or false', async () => {
    const { service, prisma } = makeService();
    await service.list({});
    await service.list({ overdue: 'false' });
    for (const call of prisma.lead.findMany.mock.calls) {
      expect(call[0].where).not.toHaveProperty('followUpAt');
    }
  });

  it('includes the assigned operator in list rows', async () => {
    const { service, prisma } = makeService();
    await service.list({});
    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          assignedTo: { select: { id: true, name: true, email: true } },
          convertedTenant: {
            select: { id: true, name: true, slug: true },
          },
        }),
      }),
    );
  });

  it('lists ACTIVE triage-role operators by name for the roster', async () => {
    const { service, prisma } = makeService();
    prisma.platformUser.findMany.mockResolvedValue([
      { id: 'u1', name: 'A', email: 'a@x', role: 'SUPPORT' },
    ]);
    const result = await service.assignees();
    expect(prisma.platformUser.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        role: { in: ['SUPERADMIN', 'BILLING', 'SUPPORT'] },
      },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    expect(result).toHaveLength(1);
  });
});

describe('Lead triage DTOs — class-validator', () => {
  it('accepts a UUID assignee or null, rejects a bad id', async () => {
    expect(
      await validate(
        Object.assign(new AssignLeadDto(), { assignedToId: OPERATOR_ID }),
      ),
    ).toEqual([]);
    expect(
      await validate(
        Object.assign(new AssignLeadDto(), { assignedToId: null }),
      ),
    ).toEqual([]);
    const errors = await validate(
      Object.assign(new AssignLeadDto(), { assignedToId: 'not-a-uuid' }),
    );
    expect(errors.map((e) => e.property)).toContain('assignedToId');
  });

  it('accepts an ISO follow-up date or null, rejects garbage', async () => {
    expect(
      await validate(
        Object.assign(new UpdateLeadFollowUpDto(), {
          followUpAt: '2026-11-25T10:00:00.000Z',
        }),
      ),
    ).toEqual([]);
    expect(
      await validate(
        Object.assign(new UpdateLeadFollowUpDto(), { followUpAt: null }),
      ),
    ).toEqual([]);
    const errors = await validate(
      Object.assign(new UpdateLeadFollowUpDto(), {
        followUpAt: 'tomorrow-ish',
      }),
    );
    expect(errors.map((e) => e.property)).toContain('followUpAt');
  });

  it('accepts notes and rejects overlong ones', async () => {
    expect(
      await validate(
        Object.assign(new UpdateLeadNotesDto(), {
          internalNotes: 'Call back Monday.',
        }),
      ),
    ).toEqual([]);
    const errors = await validate(
      Object.assign(new UpdateLeadNotesDto(), {
        internalNotes: 'x'.repeat(5001),
      }),
    );
    expect(errors.map((e) => e.property)).toContain('internalNotes');
  });
});

describe('LeadsController — assignment endpoints', () => {
  function makeController() {
    const leads: any = {
      assignees: jest
        .fn()
        .mockResolvedValue([
          { id: 'u1', name: 'A', email: 'a@x', role: 'SUPPORT' },
        ]),
      assign: jest.fn().mockResolvedValue({ id: 'lead-1' }),
      updateFollowUp: jest.fn().mockResolvedValue({ id: 'lead-1' }),
      updateNotes: jest.fn().mockResolvedValue({ id: 'lead-1' }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    return {
      leads,
      controller: new LeadsController(leads, audit as any),
    };
  }

  function guardContext(handler: any, role?: string): any {
    return {
      getHandler: () => handler,
      getClass: () => LeadsController,
      switchToHttp: () => ({
        getRequest: () => ({
          platformUser: role ? { id: 'user-1', role } : undefined,
        }),
      }),
    };
  }

  it('passes the actor id through on assign / follow-up / notes', async () => {
    const { controller, leads } = makeController();
    await controller.assign(
      'lead-1',
      { assignedToId: OPERATOR_ID },
      { id: 'user-1' },
    );
    expect(leads.assign).toHaveBeenCalledWith(
      'lead-1',
      { assignedToId: OPERATOR_ID },
      'user-1',
    );
    await controller.updateFollowUp(
      'lead-1',
      { followUpAt: '2026-11-25T10:00:00.000Z' },
      { id: 'user-1' },
    );
    expect(leads.updateFollowUp).toHaveBeenCalledWith(
      'lead-1',
      { followUpAt: '2026-11-25T10:00:00.000Z' },
      'user-1',
    );
    await controller.updateNotes(
      'lead-1',
      { internalNotes: 'note' },
      { id: 'user-1' },
    );
    expect(leads.updateNotes).toHaveBeenCalledWith(
      'lead-1',
      { internalNotes: 'note' },
      'user-1',
    );
    await expect(controller.assignees()).resolves.toHaveLength(1);
  });

  it('declares triage roles on the mutations and READ_ROLES on the roster', () => {
    const reflector = new Reflector();
    const rolesOf = (handler: any) =>
      reflector.getAllAndOverride<string[]>(PLATFORM_ROLES_KEY, [
        handler,
        LeadsController,
      ]);
    expect(rolesOf(LeadsController.prototype.assign)).toEqual([
      'SUPERADMIN',
      'BILLING',
      'SUPPORT',
    ]);
    expect(rolesOf(LeadsController.prototype.updateFollowUp)).toEqual([
      'SUPERADMIN',
      'BILLING',
      'SUPPORT',
    ]);
    expect(rolesOf(LeadsController.prototype.updateNotes)).toEqual([
      'SUPERADMIN',
      'BILLING',
      'SUPPORT',
    ]);
    expect(rolesOf(LeadsController.prototype.assignees)).toEqual([
      'SUPERADMIN',
      'BILLING',
      'SUPPORT',
    ]);
  });

  it('forbids READONLY from the mutations but allows SUPPORT (RolesGuard)', () => {
    const guard = new RolesGuard(new Reflector());
    for (const handler of [
      LeadsController.prototype.assign,
      LeadsController.prototype.updateFollowUp,
      LeadsController.prototype.updateNotes,
    ]) {
      expect(() =>
        guard.canActivate(guardContext(handler, 'READONLY')),
      ).toThrow(ForbiddenException);
      expect(guard.canActivate(guardContext(handler, 'SUPPORT'))).toBe(true);
    }
  });
});
