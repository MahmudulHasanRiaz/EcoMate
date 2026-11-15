import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WarehousesService } from '../warehouses.service';

/**
 * Bin warehouse moves + warehouse delete error mapping (2026-11-03).
 *
 * The bin-edit form's Warehouse select used to be silently inert — the
 * update DTO had no warehouseId at all. updateBinLocation now performs a
 * validated move, and remove() maps the FK-constraint failure to a clear
 * 400 instead of leaking the raw Prisma error.
 */
describe('WarehousesService — bin moves + warehouse delete', () => {
  let prisma: any;
  let svc: WarehousesService;

  const bin = {
    id: 'bin-1',
    code: 'A-01',
    warehouseId: 'wh-1',
    zoneId: 'zone-1',
    rackId: 'rack-1',
    shelfId: 'shelf-1',
    isActive: true,
  };

  /** binLocation.findFirst serves both the bin load (by id) and the dup check (by warehouseId + code). */
  const mockBinLoad = (dup: any = null) => {
    prisma.binLocation.findFirst.mockImplementation((args: any) => {
      if (args.where.id) return Promise.resolve(bin);
      if (args.where.warehouseId && args.where.code) return Promise.resolve(dup);
      return Promise.resolve(null);
    });
  };

  beforeEach(() => {
    prisma = {
      warehouse: { findFirst: jest.fn(), delete: jest.fn() },
      binLocation: {
        findFirst: jest.fn(),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ ...bin, ...data }),
          ),
      },
      zone: { findFirst: jest.fn() },
      rack: { findFirst: jest.fn() },
      shelf: { findFirst: jest.fn() },
    };
    svc = new WarehousesService(prisma);
  });

  it('moves a bin to another warehouse and clears the old hierarchy', async () => {
    mockBinLoad();
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-2', name: 'Overflow' });

    await svc.updateBinLocation('bin-1', { warehouseId: 'wh-2' });

    const data = prisma.binLocation.update.mock.calls[0][0].data;
    expect(data.warehouseId).toBe('wh-2');
    // Zone/rack/shelf belong to wh-1's hierarchy — none may survive.
    expect(data.zoneId).toBeNull();
    expect(data.rackId).toBeNull();
    expect(data.shelfId).toBeNull();
  });

  it('keeps DTO-supplied hierarchy that belongs to the target warehouse', async () => {
    mockBinLoad();
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-2' });
    prisma.zone.findFirst.mockResolvedValue({ warehouseId: 'wh-2' });

    await svc.updateBinLocation('bin-1', {
      warehouseId: 'wh-2',
      zoneId: 'zone-9',
    });

    const data = prisma.binLocation.update.mock.calls[0][0].data;
    expect(data.warehouseId).toBe('wh-2');
    expect(data.zoneId).toBe('zone-9');
    expect(data.rackId).toBeNull();
    expect(data.shelfId).toBeNull();
  });

  it('rejects hierarchy from a different warehouse on a move', async () => {
    mockBinLoad();
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-2' });
    prisma.zone.findFirst.mockResolvedValue({ warehouseId: 'wh-1' });

    await expect(
      svc.updateBinLocation('bin-1', { warehouseId: 'wh-2', zoneId: 'zone-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.binLocation.update).not.toHaveBeenCalled();
  });

  it('rejects a move to a warehouse that does not exist', async () => {
    mockBinLoad();
    prisma.warehouse.findFirst.mockResolvedValue(null);

    await expect(
      svc.updateBinLocation('bin-1', { warehouseId: 'wh-ghost' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.binLocation.update).not.toHaveBeenCalled();
  });

  it('rejects a move when the code already exists in the target warehouse', async () => {
    mockBinLoad({ id: 'bin-other', code: 'A-01', warehouseId: 'wh-2' });
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-2' });

    await expect(
      svc.updateBinLocation('bin-1', { warehouseId: 'wh-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.binLocation.update).not.toHaveBeenCalled();
  });

  it('treats a same-warehouse warehouseId as a no-op (no move, hierarchy untouched)', async () => {
    mockBinLoad();

    await svc.updateBinLocation('bin-1', {
      warehouseId: 'wh-1',
      isActive: false,
    });

    const data = prisma.binLocation.update.mock.calls[0][0].data;
    expect(data.warehouseId).toBeUndefined();
    expect(data.zoneId).toBe('zone-1');
    expect(data.rackId).toBe('rack-1');
    expect(data.isActive).toBe(false);
    expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
  });

  it('maps an FK-constrained warehouse delete to a clear BadRequest', async () => {
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', binLocations: [] });
    prisma.warehouse.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint violated',
        { code: 'P2003', clientVersion: 'test' } as any,
      ),
    );

    const err = await svc.remove('wh-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toContain('Warehouse is in use');
  });

  it('deletes an unreferenced warehouse normally', async () => {
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', binLocations: [] });
    prisma.warehouse.delete.mockResolvedValue({ id: 'wh-1' });

    await expect(svc.remove('wh-1')).resolves.toEqual({ id: 'wh-1' });
  });

  it('rethrows non-FK delete errors untouched', async () => {
    const boom = new Error('db down');
    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-1', binLocations: [] });
    prisma.warehouse.delete.mockRejectedValue(boom);

    await expect(svc.remove('wh-1')).rejects.toBe(boom);
  });
});
