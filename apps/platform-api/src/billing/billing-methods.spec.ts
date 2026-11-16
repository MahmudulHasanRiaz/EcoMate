import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { BillingService } from './billing.service';

const METHOD_ID = '44444444-4444-4444-8444-444444444444';

function makeService() {
  const method = {
    id: METHOD_ID,
    type: 'BKASH',
    name: 'bKash Personal',
    accountName: 'EcoMate',
    accountNumber: '01700000000',
    instructions: 'Send money, then submit the TrxID.',
    qrMediaUrl: null,
    isActive: true,
    sortOrder: 0,
  };
  const prisma: any = {
    paymentMethod: {
      findMany: jest.fn().mockResolvedValue([method]),
      findUnique: jest.fn().mockResolvedValue(method),
      create: jest
        .fn()
        .mockImplementation(async ({ data }: any) => ({ id: METHOD_ID, ...data })),
      update: jest
        .fn()
        .mockImplementation(async ({ data }: any) => ({ ...method, ...data })),
      delete: jest.fn().mockResolvedValue(method),
    },
    paymentProof: { count: jest.fn().mockResolvedValue(0) },
    payment: { count: jest.fn().mockResolvedValue(0) },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    prisma,
    audit,
    method,
    service: new BillingService(prisma as any, audit as any),
  };
}

describe('BillingService payment methods', () => {
  it('lists methods ordered by sortOrder then name', async () => {
    const { service, prisma } = makeService();

    const result = await service.methods();

    expect(prisma.paymentMethod.findMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    expect(result).toHaveLength(1);
  });

  it('creates a method, trims fields and audits it', async () => {
    const { service, prisma, audit } = makeService();

    const result = await service.createMethod(
      {
        type: 'NAGAD',
        name: '  Nagad Personal  ',
        accountNumber: '01800000000',
        sortOrder: 2,
      } as any,
      'user-1',
    );

    expect(prisma.paymentMethod.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'NAGAD',
          name: 'Nagad Personal',
          accountNumber: '01800000000',
          sortOrder: 2,
        }),
      }),
    );
    expect(result.id).toBe(METHOD_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'billing.method.create',
        entity: 'PaymentMethod',
        entityId: METHOD_ID,
      }),
    );
  });

  it('updates only the provided fields and audits before/after', async () => {
    const { service, prisma, audit, method } = makeService();

    await service.updateMethod(
      METHOD_ID,
      { isActive: false, sortOrder: 5 } as any,
      'user-1',
    );

    expect(prisma.paymentMethod.update).toHaveBeenCalledWith({
      where: { id: METHOD_ID },
      data: { isActive: false, sortOrder: 5 },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'billing.method.update',
        before: expect.objectContaining({ id: METHOD_ID }),
        after: expect.objectContaining({ isActive: false, sortOrder: 5 }),
      }),
    );
    expect(method.isActive).toBe(true); // the fixture itself is untouched
  });

  it('rejects updating an unknown method', async () => {
    const { service, prisma } = makeService();
    prisma.paymentMethod.findUnique.mockResolvedValue(null);

    await expect(
      service.updateMethod(METHOD_ID, { name: 'X' } as any, 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes an unreferenced method and audits it', async () => {
    const { service, prisma, audit } = makeService();

    const result = await service.deleteMethod(METHOD_ID, 'user-1');

    expect(prisma.paymentMethod.delete).toHaveBeenCalledWith({
      where: { id: METHOD_ID },
    });
    expect(result).toEqual({ id: METHOD_ID, deleted: true });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.method.delete' }),
    );
  });

  it('refuses to delete a method referenced by proofs or payments', async () => {
    const { service, prisma } = makeService();
    prisma.paymentProof.count.mockResolvedValue(2);

    await expect(service.deleteMethod(METHOD_ID, 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.paymentMethod.delete).not.toHaveBeenCalled();

    prisma.paymentProof.count.mockResolvedValue(0);
    prisma.payment.count.mockResolvedValue(1);
    await expect(service.deleteMethod(METHOD_ID, 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.paymentMethod.delete).not.toHaveBeenCalled();
  });

  it('rejects deleting an unknown method', async () => {
    const { service, prisma } = makeService();
    prisma.paymentMethod.findUnique.mockResolvedValue(null);

    await expect(service.deleteMethod(METHOD_ID, 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
