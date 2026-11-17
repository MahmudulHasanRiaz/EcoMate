import { ConflictException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TenantDataService } from './tenant-data.service';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';

const tables = [
  { table_name: 'Product' },
  { table_name: 'Order' },
  { table_name: 'OrderItem' },
];
const edges = [
  { parent: 'Product', child: 'OrderItem' },
  { parent: 'Order', child: 'OrderItem' },
];
const rowsByTable: Record<string, unknown[]> = {
  Product: [{ row: { id: 'p1', name: 'Product' } }],
  Order: [{ row: { id: 'o1', displayId: 'ORD-1' } }],
  OrderItem: [{ row: { id: 'i1', orderId: 'o1', productId: 'p1' } }],
};

function makeService() {
  const prisma: any = {
    $queryRawUnsafe: jest.fn(async (sql: string) => {
      if (sql.includes('pg_constraint')) return edges;
      if (sql.includes('pg_class')) return tables;
      if (sql.includes('COUNT(*)')) {
        const match = sql.match(/FROM "([^"]+)"/);
        const table = match ? match[1] : '';
        return [{ count: String((rowsByTable[table] ?? []).length) }];
      }
      const match = sql.match(/FROM "([^"]+)"/);
      return match ? (rowsByTable[match[1]] ?? []) : [];
    }),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  };
  const storage: any = {
    deleteTenantMedia: jest
      .fn()
      .mockResolvedValue({ deletedFiles: 0, failedFiles: [] }),
  };
  const discovery: any = { getProviders: jest.fn().mockReturnValue([]) };
  return {
    prisma,
    storage,
    discovery,
    service: new TenantDataService(prisma as any, storage as any, discovery),
  };
}

/** A Queue-shaped object that passes `instanceof Queue` without Redis. */
function fakeQueue(jobs: any[]) {
  const queue: any = Object.create(Queue.prototype);
  queue.name = 'media';
  queue.getJobs = jest.fn().mockResolvedValueOnce(jobs).mockResolvedValue([]);
  return queue;
}

describe('TenantDataService', () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('exports every tenant table parent-first', async () => {
    const { service } = makeService();
    const result = await service.exportTenant(TENANT_ID);

    expect(result.tableOrder.indexOf('OrderItem')).toBeGreaterThan(
      result.tableOrder.indexOf('Product'),
    );
    expect(result.tableOrder.indexOf('OrderItem')).toBeGreaterThan(
      result.tableOrder.indexOf('Order'),
    );
    expect(result.tables.Product).toEqual([
      { id: 'p1', name: 'Product' },
    ]);
    expect(result.tables.Order).toEqual([{ id: 'o1', displayId: 'ORD-1' }]);
    expect(result.tables.OrderItem).toEqual([
      { id: 'i1', orderId: 'o1', productId: 'p1' },
    ]);
    expect(result.tenantId).toBe(TENANT_ID);
  });

  it('fails the export when a table exceeds the row cap', async () => {
    process.env.TENANT_EXPORT_MAX_ROWS = '2';
    const { prisma, service } = makeService();
    prisma.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_constraint')) return edges;
      if (sql.includes('pg_class')) return tables;
      return [{}, {}, {}];
    });

    await expect(service.exportTenant(TENANT_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('purges child tables before their parents', async () => {
    const { prisma, service } = makeService();
    const order: string[] = [];
    prisma.$executeRawUnsafe.mockImplementation(async (sql: string) => {
      const match = sql.match(/DELETE FROM "([^"]+)"/);
      if (match) order.push(match[1]);
      return 1;
    });

    const result = await service.purgeTenant(TENANT_ID);

    expect(order.indexOf('OrderItem')).toBeLessThan(order.indexOf('Order'));
    expect(order.indexOf('OrderItem')).toBeLessThan(order.indexOf('Product'));
    expect(order).toHaveLength(3);
    expect(result.deletedRows).toBe(3);
    expect(result.deletedRows).toBe(order.length);
  });

  it('purges media before deleting rows and reports the counts', async () => {
    const { prisma, storage, service } = makeService();
    const calls: string[] = [];
    storage.deleteTenantMedia.mockImplementation(async () => {
      calls.push('media');
      return { deletedFiles: 4, failedFiles: ['stuck.png'] };
    });
    prisma.$executeRawUnsafe.mockImplementation(async () => {
      calls.push('rows');
      return 1;
    });

    const result = await service.purgeTenant(TENANT_ID);

    expect(calls[0]).toBe('media');
    expect(result.mediaDeletedFiles).toBe(4);
    expect(result.mediaFailedFiles).toEqual(['stuck.png']);
    expect(result.jobsRemoved).toBe(0);
  });

  it('removes queued jobs discovered via DiscoveryService on purge', async () => {
    const { discovery, service } = makeService();
    const tenantJob = {
      data: { tenantId: TENANT_ID },
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const otherJob = {
      data: { tenantId: '99999999-9999-4999-8999-999999999999' },
      remove: jest.fn().mockResolvedValue(undefined),
    };
    discovery.getProviders.mockReturnValue([
      { instance: fakeQueue([tenantJob, otherJob]) },
      { instance: { notAQueue: true } },
    ]);

    const result = await service.purgeTenant(TENANT_ID);

    expect(result.jobsRemoved).toBe(1);
    expect(tenantJob.remove).toHaveBeenCalledTimes(1);
    expect(otherJob.remove).not.toHaveBeenCalled();
  });

  it('aborts the purge when the media purge fails outright', async () => {
    const { prisma, storage, service } = makeService();
    storage.deleteTenantMedia.mockRejectedValue(new Error('storage down'));

    await expect(service.purgeTenant(TENANT_ID)).rejects.toThrow(
      'storage down',
    );
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('returns the manifest with per-table counts', async () => {
    const { service } = makeService();
    const manifest = await service.exportManifest(TENANT_ID);
    expect(manifest.tableOrder).toEqual(
      expect.arrayContaining(['Product', 'Order', 'OrderItem']),
    );
    expect(manifest.counts).toEqual({ Product: 1, Order: 1, OrderItem: 1 });
    expect(manifest.totalRows).toBe(3);
  });

  it('pages a table by ctid cursor', async () => {
    const { prisma, service } = makeService();
    prisma.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_constraint')) return edges;
      if (sql.includes('pg_class')) return tables;
      if (sql.includes('ctid')) {
        return [
          { row: { id: 'p1' }, ctid: '(0,1)' },
          { row: { id: 'p2' }, ctid: '(0,2)' },
        ];
      }
      return [];
    });

    const page = await service.exportTableChunk(TENANT_ID, 'Product', null, 2);
    expect(page.rows).toEqual([{ id: 'p1' }, { id: 'p2' }]);
    // A full page is not done: the cursor points at the last row.
    expect(page.done).toBe(false);
    expect(page.nextCursor).toBe('(0,2)');

    // The chunk query keys on ctid with the cursor param.
    const chunkCall = prisma.$queryRawUnsafe.mock.calls.find((call: any[]) =>
      call[0].includes('ctid'),
    );
    expect(chunkCall[0]).toContain('t.ctid > $2::tid');
    expect(chunkCall[1]).toBe(TENANT_ID);
    expect(chunkCall[2]).toBe('(0,0)');
    expect(chunkCall[3]).toBe(2);
  });

  it('rejects a chunk request for a table that is not tenant-scoped', async () => {
    const { service } = makeService();
    await expect(
      service.exportTableChunk(TENANT_ID, '_prisma_migrations'),
    ).rejects.toThrow('not tenant-scoped');
  });

  it('clamps the chunk limit to the maximum', async () => {
    const { prisma, service } = makeService();
    await service.exportTableChunk(TENANT_ID, 'Product', null, 99_999);
    const chunkCall = prisma.$queryRawUnsafe.mock.calls.find((call: any[]) =>
      call[0].includes('ctid'),
    );
    expect(chunkCall[3]).toBe(5000);
  });

  it('removes only the purged tenant jobs from every queue', async () => {
    const { service } = makeService();
    const removed: string[] = [];
    const fakeQueue: any = {
      name: 'media',
      getJobs: jest.fn(async () => [
        {
          data: { tenantId: TENANT_ID },
          remove: jest.fn(async () => removed.push('tenant-job')),
        },
        {
          data: { tenantId: 'other-tenant' },
          remove: jest.fn(async () => removed.push('other-job')),
        },
        {
          data: {},
          remove: jest.fn(async () => removed.push('no-tenant-job')),
        },
      ]),
    };
    const count = await service.removeTenantJobs(TENANT_ID, [fakeQueue]);
    expect(count).toBe(1);
    expect(removed).toEqual(['tenant-job']);
    expect(fakeQueue.getJobs).toHaveBeenCalledWith(
      ['waiting', 'delayed', 'paused', 'waiting-children'],
      0,
      999,
      true,
    );
  });

  it('keeps purging other queues when one queue errors', async () => {
    const { service } = makeService();
    const badQueue: any = {
      name: 'bad',
      getJobs: jest.fn(async () => {
        throw new Error('redis down');
      }),
    };
    const goodQueue: any = {
      name: 'good',
      getJobs: jest.fn(async () => [
        {
          data: { tenantId: TENANT_ID },
          remove: jest.fn(async () => {}),
        },
      ]),
    };
    const count = await service.removeTenantJobs(TENANT_ID, [
      badQueue,
      goodQueue,
    ]);
    expect(count).toBe(1);
  });
});
