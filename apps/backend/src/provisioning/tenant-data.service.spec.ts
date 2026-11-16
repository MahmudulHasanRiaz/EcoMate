import { ConflictException } from '@nestjs/common';
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
      const match = sql.match(/FROM "([^"]+)"/);
      return match ? (rowsByTable[match[1]] ?? []) : [];
    }),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  };
  return { prisma, service: new TenantDataService(prisma as any) };
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
});
