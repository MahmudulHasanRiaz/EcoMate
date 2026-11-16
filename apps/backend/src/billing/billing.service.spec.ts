import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { TenantBillingService } from './billing.service';

describe('TenantBillingService', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();
  const service = new TenantBillingService();

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.PLATFORM_API_URL = 'http://127.0.0.1:4100/api';
    process.env.INTERNAL_SERVICE_SECRET = 'e2e-internal-secret';
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

  it('throws 503 when the platform billing config is missing', async () => {
    delete process.env.PLATFORM_API_URL;
    await expect(service.methods()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches payment methods with the service token', async () => {
    fetchMock.mockResolvedValue(okJson([{ id: 'm1', name: 'bKash' }]));
    const methods = await service.methods();

    expect(methods).toEqual([{ id: 'm1', name: 'bKash' }]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/internal/payment-methods',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-platform-service-token': 'e2e-internal-secret',
        }),
      }),
    );
  });

  it('scopes invoices to the tenant id from context, never the body', async () => {
    fetchMock.mockResolvedValue(okJson([{ id: 'inv-1' }, { id: 'inv-2' }]));
    const invoices = await service.invoices('tenant-1');

    expect(invoices).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/internal/tenants/tenant-1/invoices',
      expect.anything(),
    );
  });

  it('finds one invoice from the tenant list and 404s on a foreign id', async () => {
    fetchMock.mockResolvedValue(okJson([{ id: 'inv-1', number: 'INV-1' }]));
    await expect(service.invoice('tenant-1', 'inv-1')).resolves.toMatchObject({
      number: 'INV-1',
    });
    await expect(service.invoice('tenant-1', 'inv-2')).rejects.toThrow(
      'Invoice not found',
    );
  });

  it('submits a proof with the invoice id attached', async () => {
    fetchMock.mockResolvedValue(okJson({ id: 'proof-1', status: 'PENDING' }));
    await service.submitProof('tenant-1', 'inv-1', {
      methodId: 'm1',
      amount: 1150,
      transactionId: 'TX-1',
    } as any);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/api/internal/tenants/tenant-1/proofs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          methodId: 'm1',
          amount: 1150,
          transactionId: 'TX-1',
          invoiceId: 'inv-1',
        }),
      }),
    );
  });

  it('forwards the platform error status and message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        message: 'A proof with this transaction id is already pending',
      }),
      headers: new Headers(),
      body: null,
    });

    const error = await service
      .submitProof('tenant-1', 'inv-1', {
        methodId: 'm1',
        amount: 1150,
        transactionId: 'TX-1',
      } as any)
      .catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.message).toContain('already pending');
  });
});
