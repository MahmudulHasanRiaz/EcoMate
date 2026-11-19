import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PLATFORM_ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { LeadsController } from './leads.controller';
import { PublicLeadsController } from './public-leads.controller';

function makeController() {
  const leads: any = {
    create: jest.fn().mockResolvedValue({ id: 'lead-1' }),
    list: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    detail: jest.fn().mockResolvedValue({ id: 'lead-1' }),
    updateStatus: jest
      .fn()
      .mockResolvedValue({ id: 'lead-1', status: 'CONTACTED' }),
    exportRows: jest.fn().mockResolvedValue({ rows: [], truncated: false }),
    toCsv: jest.fn().mockReturnValue('id,createdAt\n'),
    convert: jest
      .fn()
      .mockResolvedValue({ id: 'lead-1', status: 'WON' }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    leads,
    audit,
    controller: new LeadsController(leads, audit as any),
    publicController: new PublicLeadsController(leads),
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

describe('LeadsController', () => {
  it('lists with the query params and returns the detail row', async () => {
    const { controller, leads } = makeController();
    await controller.list('2', '10', 'NEW', 'ayesha', 'true');
    expect(leads.list).toHaveBeenCalledWith({
      page: '2',
      limit: '10',
      status: 'NEW',
      search: 'ayesha',
      overdue: 'true',
    });
    await expect(controller.detail('lead-1')).resolves.toEqual({
      id: 'lead-1',
    });
    expect(leads.detail).toHaveBeenCalledWith('lead-1');
  });

  it('exports CSV as a downloadable file and audits it', async () => {
    const { controller, leads, audit } = makeController();
    leads.exportRows.mockResolvedValue({
      rows: [{ id: 'lead-1' }],
      truncated: false,
    });
    const result: any = await controller.export(
      'WON',
      undefined,
      {
        id: 'user-1',
      },
      'true',
    );
    expect(leads.exportRows).toHaveBeenCalledWith({
      status: 'WON',
      search: undefined,
      overdue: 'true',
    });
    expect(leads.toCsv).toHaveBeenCalledWith([{ id: 'lead-1' }]);
    expect(result.options.type).toBe('text/csv; charset=utf-8');
    expect(result.options.disposition).toMatch(
      /attachment; filename="leads-export-\d{14}\.csv"/,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'lead.export',
        after: expect.objectContaining({ rows: 1, truncated: false }),
      }),
    );
  });

  it('converts a lead and declares the convert/export roles', async () => {
    const { controller, leads } = makeController();
    await controller.convert('lead-1', { tenantId: 'tenant-1' }, { id: 'user-1' });
    expect(leads.convert).toHaveBeenCalledWith(
      'lead-1',
      { tenantId: 'tenant-1' },
      'user-1',
    );
    const reflector = new Reflector();
    const rolesOf = (handler: any) =>
      reflector.getAllAndOverride<string[]>(PLATFORM_ROLES_KEY, [
        handler,
        LeadsController,
      ]);
    expect(rolesOf(LeadsController.prototype.convert)).toEqual([
      'SUPERADMIN',
      'BILLING',
      'SUPPORT',
    ]);
    expect(rolesOf(LeadsController.prototype.export)).toEqual([
      'SUPERADMIN',
      'BILLING',
    ]);
  });

  it('passes the actor id through on status updates', async () => {
    const { controller, leads } = makeController();
    await controller.updateStatus(
      'lead-1',
      { status: 'CLOSED' },
      { id: 'user-1' },
    );
    expect(leads.updateStatus).toHaveBeenCalledWith(
      'lead-1',
      { status: 'CLOSED' },
      'user-1',
    );
  });

  it('declares READ_ROLES on reads and triage roles on status updates', () => {
    const reflector = new Reflector();
    const rolesOf = (handler: any) =>
      reflector.getAllAndOverride<string[]>(PLATFORM_ROLES_KEY, [
        handler,
        LeadsController,
      ]);
    expect(rolesOf(LeadsController.prototype.list)).toEqual([
      'SUPERADMIN',
      'BILLING',
      'SUPPORT',
    ]);
    expect(rolesOf(LeadsController.prototype.detail)).toEqual([
      'SUPERADMIN',
      'BILLING',
      'SUPPORT',
    ]);
    expect(rolesOf(LeadsController.prototype.updateStatus)).toEqual([
      'SUPERADMIN',
      'BILLING',
      'SUPPORT',
    ]);
  });

  it('forbids READONLY from triaging but allows SUPPORT (RolesGuard)', () => {
    const guard = new RolesGuard(new Reflector());
    const handler = LeadsController.prototype.updateStatus;
    expect(() =>
      guard.canActivate(guardContext(handler, 'READONLY')),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(guardContext(handler, undefined)),
    ).toThrow(ForbiddenException);
    expect(guard.canActivate(guardContext(handler, 'SUPPORT'))).toBe(true);
    expect(guard.canActivate(guardContext(handler, 'SUPERADMIN'))).toBe(
      true,
    );
  });
});

describe('PublicLeadsController', () => {
  it('creates a lead with the request meta', async () => {
    const { publicController, leads } = makeController();
    const result = await publicController.create(
      { name: 'Ayesha', contact: 'a@b.com' } as any,
      { ip: '1.2.3.4', headers: { 'user-agent': 'ua' } },
    );
    expect(result).toEqual({ id: 'lead-1' });
    expect(leads.create).toHaveBeenCalledWith(
      { name: 'Ayesha', contact: 'a@b.com' },
      { ip: '1.2.3.4', userAgent: 'ua' },
    );
  });
});
