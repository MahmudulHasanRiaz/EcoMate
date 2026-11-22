import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { TenantSubscriptionService } from './tenant-subscription.service';

describe('TenantSubscriptionService', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();
  const service = new TenantSubscriptionService();

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PLATFORM_API_URL = 'http://127.0.0.1:4100/api';
    process.env.INTERNAL_SERVICE_SECRET = 'test-service-token';
    jest.clearAllMocks();
    global.fetch = fetchMock as any;
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  function okJson(body: unknown) {
    return {
      ok: true,
      status: 200,
      json: async () => body,
      headers: new Headers(),
      body: null,
    };
  }

  function errJson(status: number, body: unknown) {
    return {
      ok: false,
      status,
      json: async () => body,
      headers: new Headers(),
      body: null,
    };
  }

  it('throws 503 when the platform config is missing', async () => {
    delete process.env.PLATFORM_API_URL;
    await expect(service.listPublicPlans()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws 503 when the service secret is missing', async () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    await expect(service.listRequests('tenant-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists public plans from the platform catalogue', async () => {
    fetchMock.mockResolvedValue(
      okJson([{ id: 'p1', slug: 'growth', name: 'Growth' }]),
    );
    const result = await service.listPublicPlans();

    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/public/plans',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-platform-service-token': 'test-service-token',
        }),
      }),
    );
  });

  it('lists requests for the tenant id with the service token', async () => {
    fetchMock.mockResolvedValue(okJson([{ id: 'r1', status: 'PENDING' }]));
    const result = await service.listRequests('tenant-1');

    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/internal/tenants/tenant-1/plan-change-requests',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-platform-service-token': 'test-service-token',
        }),
      }),
    );
  });

  it('creates a request with a JSON body incl. the requesting user', async () => {
    fetchMock.mockResolvedValue(okJson({ id: 'r1', status: 'PENDING' }));
    await service.createRequest(
      'tenant-1',
      { targetPlanId: 'plan-9', note: 'Need more orders' },
      'user-7',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/internal/tenants/tenant-1/plan-change-requests',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          targetPlanId: 'plan-9',
          note: 'Need more orders',
          requestedBy: 'user-7',
        }),
      }),
    );
  });

  it('sends requestedBy null when no user id is available', async () => {
    fetchMock.mockResolvedValue(okJson({ id: 'r1' }));
    await service.createRequest('tenant-1', { targetPlanId: 'plan-9' }, null);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          targetPlanId: 'plan-9',
          requestedBy: null,
        }),
      }),
    );
  });

  it('fetches the trial review for the tenant id', async () => {
    fetchMock.mockResolvedValue(
      okJson({ tenantId: 'tenant-1', isTrialPlan: true, trialAddOns: [] }),
    );

    const result = await service.getTrialReview('tenant-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/internal/tenants/tenant-1/trial-review',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-platform-service-token': 'test-service-token',
        }),
      }),
    );
    expect(result).toEqual({
      tenantId: 'tenant-1',
      isTrialPlan: true,
      trialAddOns: [],
    });
  });

  it('forwards the add-on selection when creating a request', async () => {
    fetchMock.mockResolvedValue(okJson({ id: 'r1', status: 'PENDING' }));
    await service.createRequest(
      'tenant-1',
      {
        targetPlanId: 'plan-9',
        addOnIds: ['77777777-7777-4777-8777-777777777777'],
      },
      'user-7',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          targetPlanId: 'plan-9',
          addOnIds: ['77777777-7777-4777-8777-777777777777'],
          requestedBy: 'user-7',
        }),
      }),
    );
  });

  it('gets one request by id, tenant-scoped', async () => {
    fetchMock.mockResolvedValue(okJson({ id: 'r1', status: 'APPLIED' }));
    await service.getRequest('tenant-1', 'r1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/internal/tenants/tenant-1/plan-change-requests/r1',
      expect.objectContaining({}),
    );
  });

  it('passes a platform 409 through with status + message', async () => {
    fetchMock.mockResolvedValue(
      errJson(409, {
        message: 'This tenant already has a pending plan change request',
      }),
    );

    const error = await service
      .createRequest('tenant-1', { targetPlanId: 'plan-9' }, 'user-7')
      .catch((err) => err);

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.message).toBe(
      'This tenant already has a pending plan change request',
    );
  });

  it('passes a platform 400 through with status + message', async () => {
    fetchMock.mockResolvedValue(
      errJson(400, { message: 'This plan is not available' }),
    );

    const error = await service
      .createRequest('tenant-1', { targetPlanId: 'plan-9' }, 'user-7')
      .catch((err) => err);

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(400);
    expect(error.message).toBe('This plan is not available');
  });
});
