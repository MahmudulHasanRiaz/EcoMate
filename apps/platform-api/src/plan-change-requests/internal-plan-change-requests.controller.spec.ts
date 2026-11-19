import { InternalPlanChangeRequestsController } from './internal-plan-change-requests.controller';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';

function makeController() {
  const requests = {
    create: jest.fn(),
    listMine: jest.fn(),
    getOne: jest.fn(),
  };
  return {
    requests,
    controller: new InternalPlanChangeRequestsController(requests as any),
  };
}

describe('InternalPlanChangeRequestsController', () => {
  it('lists with the tenant id from the path', async () => {
    const { controller, requests } = makeController();
    requests.listMine.mockResolvedValue([{ id: REQUEST_ID }]);

    const result = await controller.list(TENANT_ID);

    expect(requests.listMine).toHaveBeenCalledWith(TENANT_ID);
    expect(result).toEqual([{ id: REQUEST_ID }]);
  });

  it('creates with the path tenant id and the body (incl. requestedBy)', async () => {
    const { controller, requests } = makeController();
    requests.create.mockResolvedValue({ id: REQUEST_ID, status: 'PENDING' });

    await controller.create(TENANT_ID, {
      targetPlanId: PLAN_ID,
      note: 'Need more orders',
      requestedBy: 'tenant-user-1',
    });

    expect(requests.create).toHaveBeenCalledWith(TENANT_ID, {
      targetPlanId: PLAN_ID,
      note: 'Need more orders',
      requestedBy: 'tenant-user-1',
    });
  });

  it('getOne passes BOTH ids so the service can scope the row', async () => {
    const { controller, requests } = makeController();
    requests.getOne.mockResolvedValue({ id: REQUEST_ID });

    await controller.getOne(TENANT_ID, REQUEST_ID);

    expect(requests.getOne).toHaveBeenCalledWith(TENANT_ID, REQUEST_ID);
  });
});
