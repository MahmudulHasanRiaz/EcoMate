import 'reflect-metadata';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { runWithTenant } from '../tenancy/tenant-context';
import { CreatePlanChangeRequestDto } from './dto/create-plan-change-request.dto';
import { TenantSubscriptionController } from './tenant-subscription.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';

function makeController() {
  const service = {
    listPublicPlans: jest.fn().mockResolvedValue([]),
    getTrialReview: jest.fn().mockResolvedValue({ isTrialPlan: true }),
    listRequests: jest.fn().mockResolvedValue([]),
    createRequest: jest.fn().mockResolvedValue({ id: 'r1' }),
    getRequest: jest.fn().mockResolvedValue({ id: 'r1' }),
  };
  return {
    service,
    controller: new TenantSubscriptionController(service as any),
  };
}

/** Run a controller call inside the tenant context, as the middleware does. */
function asTenant<T>(fn: () => T): T {
  return runWithTenant({ tenantId: TENANT_ID, slug: 'mystore' }, fn);
}

describe('TenantSubscriptionController', () => {
  it('lists public plans without needing a tenant id', async () => {
    const { controller, service } = makeController();
    await controller.listPlans();
    expect(service.listPublicPlans).toHaveBeenCalledWith();
  });

  it('gets the trial review with the tenant id from context', async () => {
    const { controller, service } = makeController();
    await asTenant(() => controller.getTrialReview());
    expect(service.getTrialReview).toHaveBeenCalledWith(TENANT_ID);
  });

  it('lists requests with the tenant id from context, never the request', async () => {
    const { controller, service } = makeController();
    await asTenant(() => controller.listRequests());
    expect(service.listRequests).toHaveBeenCalledWith(TENANT_ID);
  });

  it('creates with the tenant id from context, the dto and the caller user id', async () => {
    const { controller, service } = makeController();
    await asTenant(() =>
      controller.createRequest(
        { targetPlanId: PLAN_ID, note: 'Need more orders' },
        { userId: 'user-7' },
      ),
    );
    expect(service.createRequest).toHaveBeenCalledWith(
      TENANT_ID,
      { targetPlanId: PLAN_ID, note: 'Need more orders' },
      'user-7',
    );
  });

  it('creates with an undefined requestedBy when no user is attached', async () => {
    const { controller, service } = makeController();
    await asTenant(() =>
      controller.createRequest({ targetPlanId: PLAN_ID }, undefined),
    );
    expect(service.createRequest).toHaveBeenCalledWith(
      TENANT_ID,
      { targetPlanId: PLAN_ID },
      undefined,
    );
  });

  it('gets one request with the tenant id from context', async () => {
    const { controller, service } = makeController();
    await asTenant(() => controller.getRequest('r1'));
    expect(service.getRequest).toHaveBeenCalledWith(TENANT_ID, 'r1');
  });

  it('fails closed without a tenant context', () => {
    const { controller, service } = makeController();
    // requireTenantId() throws synchronously, before the service is touched.
    expect(() => controller.listRequests()).toThrow(
      'Tenant context is required',
    );
    expect(service.listRequests).not.toHaveBeenCalled();
  });

  it('pins the role matrix: reads for staff, create for superadmin+admin', () => {
    // The authorization-coverage spec enforces that every handler carries
    // @Roles(); this pins the exact split for this controller.
    const rolesOf = (method: string) =>
      Reflect.getMetadata(
        ROLES_KEY,
        (TenantSubscriptionController.prototype as any)[method],
      ) as string[];
    expect([...rolesOf('listPlans')].sort()).toEqual([
      'admin',
      'employee',
      'superadmin',
    ]);
    expect([...rolesOf('getTrialReview')].sort()).toEqual([
      'admin',
      'employee',
      'superadmin',
    ]);
    expect([...rolesOf('listRequests')].sort()).toEqual([
      'admin',
      'employee',
      'superadmin',
    ]);
    expect([...rolesOf('getRequest')].sort()).toEqual([
      'admin',
      'employee',
      'superadmin',
    ]);
    expect([...rolesOf('createRequest')].sort()).toEqual([
      'admin',
      'superadmin',
    ]);
  });

  describe('CreatePlanChangeRequestDto validation', () => {
    it('accepts a valid body', async () => {
      const dto = Object.assign(new CreatePlanChangeRequestDto(), {
        targetPlanId: PLAN_ID,
        note: 'hello',
      });
      expect(await validate(dto)).toEqual([]);
    });

    it('rejects a non-UUID plan id and a note over 500 chars', async () => {
      const dto = Object.assign(new CreatePlanChangeRequestDto(), {
        targetPlanId: 'not-a-uuid',
        note: 'x'.repeat(501),
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property).sort()).toEqual([
        'note',
        'targetPlanId',
      ]);
    });

    it('accepts a valid add-on selection and rejects non-UUID add-on ids', async () => {
      const valid = Object.assign(new CreatePlanChangeRequestDto(), {
        targetPlanId: PLAN_ID,
        addOnIds: ['77777777-7777-4777-8777-777777777777'],
      });
      expect(await validate(valid)).toEqual([]);

      const invalid = Object.assign(new CreatePlanChangeRequestDto(), {
        targetPlanId: PLAN_ID,
        addOnIds: ['not-a-uuid'],
      });
      const errors = await validate(invalid);
      expect(errors.map((e) => e.property)).toEqual(['addOnIds']);
    });
  });
});
