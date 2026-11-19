import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { PLATFORM_ROLES_KEY } from '../auth/roles.decorator';
import { PlanChangeRequestsController } from './plan-change-requests.controller';

const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const ACTOR_ID = '66666666-6666-4666-8666-666666666666';

function makeController() {
  const requests = {
    listForConsole: jest.fn(),
    apply: jest.fn(),
    reject: jest.fn(),
  };
  return {
    requests,
    controller: new PlanChangeRequestsController(requests as any),
  };
}

describe('PlanChangeRequestsController', () => {
  it('lists with the status filter', async () => {
    const { controller, requests } = makeController();
    requests.listForConsole.mockResolvedValue([{ id: REQUEST_ID }]);

    const result = await controller.list('PENDING');

    expect(requests.listForConsole).toHaveBeenCalledWith({
      status: 'PENDING',
    });
    expect(result).toEqual([{ id: REQUEST_ID }]);
  });

  it('lists without a filter when no status is given', async () => {
    const { controller, requests } = makeController();
    requests.listForConsole.mockResolvedValue([]);

    await controller.list(undefined);

    expect(requests.listForConsole).toHaveBeenCalledWith({
      status: undefined,
    });
  });

  it('400s on an unknown status value', () => {
    const { controller, requests } = makeController();

    expect(() => controller.list('BOGUS')).toThrow(BadRequestException);
    expect(requests.listForConsole).not.toHaveBeenCalled();
  });

  it('apply passes the id, dto and operator id to the service', async () => {
    const { controller, requests } = makeController();
    requests.apply.mockResolvedValue({ id: REQUEST_ID, status: 'APPLIED' });

    await controller.apply(
      REQUEST_ID,
      { effectiveAt: 'next_period' },
      { id: ACTOR_ID },
    );

    expect(requests.apply).toHaveBeenCalledWith(
      REQUEST_ID,
      { effectiveAt: 'next_period' },
      ACTOR_ID,
    );
  });

  it('reject passes the id, dto and operator id to the service', async () => {
    const { controller, requests } = makeController();
    requests.reject.mockResolvedValue({ id: REQUEST_ID, status: 'REJECTED' });

    await controller.reject(REQUEST_ID, { reason: 'Too soon' }, { id: ACTOR_ID });

    expect(requests.reject).toHaveBeenCalledWith(
      REQUEST_ID,
      { reason: 'Too soon' },
      ACTOR_ID,
    );
  });

  it('carries the console role guards (list = read roles, decide = SUPERADMIN+BILLING)', () => {
    // The authorization-coverage spec enforces guards + @Roles() for every
    // controller; this pins the exact role split for this controller.
    const listRoles = Reflect.getMetadata(
      PLATFORM_ROLES_KEY,
      PlanChangeRequestsController.prototype.list,
    );
    expect([...listRoles].sort()).toEqual([
      'BILLING',
      'SUPERADMIN',
      'SUPPORT',
    ]);
    for (const method of ['apply', 'reject']) {
      const roles = Reflect.getMetadata(
        PLATFORM_ROLES_KEY,
        (PlanChangeRequestsController.prototype as any)[method],
      );
      expect([...roles].sort()).toEqual(['BILLING', 'SUPERADMIN']);
    }
  });
});
