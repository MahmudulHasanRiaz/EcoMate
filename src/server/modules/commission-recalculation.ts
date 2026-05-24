import prisma from '@/lib/prisma';
import { awardCommissionOnDelivered } from './orders';
import { voidOrderCommissions } from './sr-performance';
import { ensureSalaryAccrualsForStaff } from '@/server/utils/staff-salary-accrual';

export interface RecalculateResult {
  ordersProcessed: number;
  staffIncomesCreated: number;
  staffSalaryProcessed: number;
  errors: string[];
}

export type RecalcOptions = {
  days: number;
  staffId?: string;
  onProgress?: (percent: number) => void;
};

const PARALLEL_BATCH = 10;
const PAGE_SIZE = 500;

async function processOrderBatch(
  orders: { id: string; orderNumber: string | null }[],
  result: RecalculateResult
) {
  await Promise.all(
    orders.map(async (order) => {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.staffIncome.deleteMany({ where: { orderId: order.id } });
          await voidOrderCommissions(tx, order.id, 'Recalculation: void before re-accrual');
          await awardCommissionOnDelivered(tx, order.id);
        });
        result.ordersProcessed++;
      } catch (err: any) {
        result.errors.push(`Order ${order.orderNumber || order.id}: ${err.message}`);
      }
    })
  );
}

export async function recalculateCommissions(
  optsOrDays: RecalcOptions | number = 60,
  staffId?: string
): Promise<RecalculateResult> {
  const opts: RecalcOptions = typeof optsOrDays === 'number'
    ? { days: optsOrDays, staffId }
    : optsOrDays;

  const { days = 60, staffId: sId, onProgress } = opts;

  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const result: RecalculateResult = {
    ordersProcessed: 0,
    staffIncomesCreated: 0,
    staffSalaryProcessed: 0,
    errors: [],
  };

  // ── Part 1: Commission Recalculation (cursor-paginated) ──
  const orderWhere: any = {
    status: 'Delivered',
    statusUpdatedAt: { gte: since },
  };
  if (sId) orderWhere.createdBy = sId;

  const totalOrders = await prisma.order.count({ where: orderWhere });
  const processedIds: string[] = [];
  let cursor: string | undefined;
  let fetched = 0;

  while (fetched < totalOrders) {
    const page = await prisma.order.findMany({
      where: orderWhere,
      select: { id: true, orderNumber: true },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (page.length === 0) break;

    for (let i = 0; i < page.length; i += PARALLEL_BATCH) {
      const batch = page.slice(i, i + PARALLEL_BATCH);
      await processOrderBatch(batch, result);
      processedIds.push(...batch.map((o) => o.id));
    }

    fetched += page.length;
    cursor = page[page.length - 1].id;

    if (onProgress && totalOrders > 0) {
      onProgress(Math.round((fetched / totalOrders) * 50));
    }
  }

  if (processedIds.length > 0) {
    const count = await prisma.staffIncome.count({
      where: { orderId: { in: processedIds } },
    });
    result.staffIncomesCreated = count;
  }

  if (onProgress) onProgress(50);

  // ── Part 2: Salary Accrual Recalculation ──
  const staffWhere: any = {};
  if (sId) staffWhere.id = sId;

  const staffMembers = await prisma.staffMember.findMany({
    where: staffWhere,
    select: {
      id: true,
      paymentType: true,
      salaryDetails: true,
      createdAt: true,
      jobStartDate: true,
      jobEndDate: true,
    },
  });

  const staffIds = staffMembers.map((s) => s.id);
  if (staffIds.length > 0) {
    await prisma.staffIncome.deleteMany({
      where: {
        staffId: { in: staffIds },
        action: { in: ['Salary', 'WeekendBonus', 'OvertimeBonus'] },
        createdAt: { gte: since },
      },
    });
  }

  const totalStaff = staffMembers.length;
  for (let i = 0; i < totalStaff; i++) {
    try {
      const count = await ensureSalaryAccrualsForStaff(staffMembers[i]);
      result.staffSalaryProcessed += count;
    } catch (err: any) {
      result.errors.push(`Staff ${staffMembers[i].id} salary: ${err.message}`);
    }

    if (onProgress && totalStaff > 0) {
      onProgress(50 + Math.round(((i + 1) / totalStaff) * 50));
    }
  }

  if (onProgress) onProgress(100);

  return result;
}
