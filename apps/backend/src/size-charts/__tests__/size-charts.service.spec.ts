import { Test, TestingModule } from '@nestjs/testing';
import { SizeChartsService } from '../size-charts.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('SizeChartsService.findByProductSlug (Fix 2)', () => {
  let svc: SizeChartsService;
  let prisma: {
    product: { findFirst: jest.Mock };
    sizeChart: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      product: { findFirst: jest.fn() },
      sizeChart: { findFirst: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [SizeChartsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    svc = module.get<SizeChartsService>(SizeChartsService);
  });

  const activeChart = { id: 'c1', name: 'Guide', isActive: true, tableData: [] };
  const inactiveChart = { id: 'c2', name: 'Old', isActive: false, tableData: [] };

  it('returns the chart for direct product assignment', async () => {
    prisma.product.findFirst.mockResolvedValue({ sizeChartId: 'c1', category: null, productCategories: [] });
    prisma.sizeChart.findFirst.mockResolvedValue(activeChart);
    await expect(svc.findByProductSlug('p')).resolves.toEqual(activeChart);
  });

  it('hides inactive charts (product assignment)', async () => {
    prisma.product.findFirst.mockResolvedValue({ sizeChartId: 'c2', category: null, productCategories: [] });
    prisma.sizeChart.findFirst.mockResolvedValue(inactiveChart);
    await expect(svc.findByProductSlug('p')).resolves.toBeNull();
  });

  it('falls back to category assignment, still honoring isActive', async () => {
    prisma.product.findFirst.mockResolvedValue({
      sizeChartId: null,
      category: { sizeChartId: 'c1' },
      productCategories: [],
    });
    prisma.sizeChart.findFirst.mockResolvedValue(activeChart);
    await expect(svc.findByProductSlug('p')).resolves.toEqual(activeChart);

    prisma.sizeChart.findFirst.mockResolvedValue(inactiveChart);
    await expect(svc.findByProductSlug('p')).resolves.toBeNull();
  });

  it('returns null when nothing is assigned', async () => {
    prisma.product.findFirst.mockResolvedValue({ sizeChartId: null, category: null, productCategories: [] });
    await expect(svc.findByProductSlug('p')).resolves.toBeNull();
    expect(prisma.sizeChart.findFirst).not.toHaveBeenCalled();
  });

  it('throws NotFound for unknown slug', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(svc.findByProductSlug('ghost')).rejects.toThrow('Product not found');
  });
});
