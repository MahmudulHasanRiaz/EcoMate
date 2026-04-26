import prisma from '@/lib/prisma';
import { getAppTimezone } from '@/lib/timezone';
import { normalizeSalaryDetails } from '@server/utils/staff-compensation';
import { listWeekendWorkDays } from '@/server/modules/attendance';

type SalaryFrequency = 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';

type StaffSalaryInput = {
  id: string;
  paymentType?: string | null;
  salaryDetails?: any;
  createdAt: Date;
  jobStartDate?: Date | null;
  jobEndDate?: Date | null;
};

type Ymd = { year: number; month: number; day: number };

const SALARY_FREQUENCIES = new Set<SalaryFrequency>(['Daily', 'Weekly', 'Monthly', 'Yearly']);

const pad2 = (value: number) => String(value).padStart(2, '0');

const formatYmd = (ymd: Ymd) => `${ymd.year}-${pad2(ymd.month)}-${pad2(ymd.day)}`;

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const daysInYear = (year: number) =>
  ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365;

const addDays = (ymd: Ymd, days: number): Ymd => {
  const base = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
};

const addMonths = (ymd: Ymd, months: number): Ymd => {
  const totalMonths = ymd.year * 12 + (ymd.month - 1) + months;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  const maxDay = daysInMonth(nextYear, nextMonth);
  return {
    year: nextYear,
    month: nextMonth,
    day: Math.min(ymd.day, maxDay),
  };
};

const compareYmd = (a: Ymd, b: Ymd) => {
  const aValue = Date.UTC(a.year, a.month - 1, a.day);
  const bValue = Date.UTC(b.year, b.month - 1, b.day);
  return Math.sign(aValue - bValue);
};

const ymdToUtcDate = (ymd: Ymd, hours = 12, minutes = 0, seconds = 0) =>
  new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day, hours, minutes, seconds));

const ymdToMs = (ymd: Ymd) => Date.UTC(ymd.year, ymd.month - 1, ymd.day);

const getDatePartsInTimeZone = (date: Date, timeZone: string): Ymd => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') map[part.type] = part.value;
  });
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
};

/**
 * Compute the number of active (intersection) days between a period [periodStart, periodEnd]
 * and the staff active window [anchorStart, endCap]. All inclusive dates.
 */
function computeActiveDays(
  periodStart: Ymd,
  periodEnd: Ymd,
  anchorStart: Ymd,
  endCap: Ymd,
): number {
  // Intersection: max(periodStart, anchorStart) .. min(periodEnd, endCap)
  const effectiveStart = compareYmd(periodStart, anchorStart) >= 0 ? periodStart : anchorStart;
  const effectiveEnd = compareYmd(periodEnd, endCap) <= 0 ? periodEnd : endCap;

  if (compareYmd(effectiveStart, effectiveEnd) > 0) return 0;

  const msPerDay = 86400000;
  return Math.floor((ymdToMs(effectiveEnd) - ymdToMs(effectiveStart)) / msPerDay) + 1;
}

type SalaryPeriod = {
  periodEnd: Ymd;
  amount: number;
  notes: string;
};

/**
 * Generate salary periods with pro-rated amounts based on active days.
 */
function generateSalaryPeriods(
  anchorStart: Ymd,
  endCap: Ymd,
  today: Ymd,
  frequency: SalaryFrequency,
  amount: number,
): SalaryPeriod[] {
  const periods: SalaryPeriod[] = [];
  const MAX_PERIODS = 500;

  if (frequency === 'Monthly') {
    // Generate calendar months starting from anchorStart's month
    let cursor: Ymd = { year: anchorStart.year, month: anchorStart.month, day: 1 };
    while (periods.length < MAX_PERIODS) {
      const monthDays = daysInMonth(cursor.year, cursor.month);
      const periodStart = { ...cursor };
      const periodEnd: Ymd = { year: cursor.year, month: cursor.month, day: monthDays };

      // Period end must be <= today to accrue
      if (compareYmd(periodEnd, today) > 0) break;

      const activeDays = computeActiveDays(periodStart, periodEnd, anchorStart, endCap);
      if (activeDays > 0) {
        const dailyRate = amount / monthDays;
        const pay = Math.round(dailyRate * activeDays * 100) / 100;
        periods.push({
          periodEnd,
          amount: pay,
          notes: activeDays === monthDays
            ? `Monthly salary`
            : `Monthly salary (${activeDays}/${monthDays} days)`,
        });
      }

      cursor = addMonths(cursor, 1);
    }
  } else if (frequency === 'Weekly') {
    // 7-day blocks starting from anchorStart
    let blockStart = { ...anchorStart };
    while (periods.length < MAX_PERIODS) {
      const blockEnd = addDays(blockStart, 6);

      // Period end must be <= today
      if (compareYmd(blockEnd, today) > 0) break;

      const activeDays = computeActiveDays(blockStart, blockEnd, anchorStart, endCap);
      if (activeDays > 0) {
        const dailyRate = amount / 7;
        const pay = Math.round(dailyRate * activeDays * 100) / 100;
        periods.push({
          periodEnd: blockEnd,
          amount: pay,
          notes: activeDays === 7
            ? `Weekly salary`
            : `Weekly salary (${activeDays}/7 days)`,
        });
      }

      blockStart = addDays(blockEnd, 1);
    }
  } else if (frequency === 'Daily') {
    // One entry per active day
    let cursor = { ...anchorStart };
    while (periods.length < MAX_PERIODS) {
      if (compareYmd(cursor, today) > 0) break;
      if (compareYmd(cursor, endCap) > 0) break;

      periods.push({
        periodEnd: cursor,
        amount,
        notes: `Daily salary`,
      });

      cursor = addDays(cursor, 1);
    }
  } else if (frequency === 'Yearly') {
    // Calendar years starting from anchorStart's year
    let year = anchorStart.year;
    while (periods.length < MAX_PERIODS) {
      const periodStart: Ymd = { year, month: 1, day: 1 };
      const periodEnd: Ymd = { year, month: 12, day: 31 };

      if (compareYmd(periodEnd, today) > 0) break;

      const yearDays = daysInYear(year);
      const activeDays = computeActiveDays(periodStart, periodEnd, anchorStart, endCap);
      if (activeDays > 0) {
        const dailyRate = amount / yearDays;
        const pay = Math.round(dailyRate * activeDays * 100) / 100;
        periods.push({
          periodEnd,
          amount: pay,
          notes: activeDays === yearDays
            ? `Yearly salary`
            : `Yearly salary (${activeDays}/${yearDays} days)`,
        });
      }

      year++;
    }
  }

  if (periods.length >= MAX_PERIODS) {
    console.warn('[STAFF_SALARY_ACCRUAL] Reached max accrual cap.', { frequency });
  }

  return periods;
}

export async function ensureSalaryAccrualsForStaff(
  staff: StaffSalaryInput,
  options?: { timeZone?: string }
) {
  const normalized = normalizeSalaryDetails(staff.paymentType ?? undefined, staff.salaryDetails);
  const amount = Number((normalized as any)?.amount ?? 0);
  const frequency = (normalized as any)?.frequency as SalaryFrequency | undefined;

  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!frequency || !SALARY_FREQUENCIES.has(frequency)) return 0;

  const timeZone = options?.timeZone || await getAppTimezone();
  const today = getDatePartsInTimeZone(new Date(), timeZone);

  // Anchor start: jobStartDate ?? createdAt
  const anchorDate = staff.jobStartDate ?? staff.createdAt;
  const anchorStart = getDatePartsInTimeZone(anchorDate, timeZone);

  // End cap: jobEndDate ?? today
  const endCap = staff.jobEndDate
    ? getDatePartsInTimeZone(staff.jobEndDate, timeZone)
    : today;

  // If anchor is in the future, nothing to accrue
  if (compareYmd(anchorStart, today) > 0) return 0;

  const periods = generateSalaryPeriods(anchorStart, endCap, today, frequency, amount);
  if (periods.length === 0) return 0;

  // Build referenceDate keys for idempotency via unique [staffId, action, referenceDate]
  const rangeDateStart = ymdToUtcDate(periods[0].periodEnd, 0, 0, 0);
  const rangeDateEnd = ymdToUtcDate(periods[periods.length - 1].periodEnd, 23, 59, 59);

  const existing = await prisma.staffIncome.findMany({
    where: {
      staffId: staff.id,
      action: 'Salary',
      referenceDate: { gte: rangeDateStart, lte: rangeDateEnd },
    },
    select: { referenceDate: true },
  });
  const existingKeys = new Set(
    existing
      .filter((e) => e.referenceDate)
      .map((e) => e.referenceDate!.toISOString().slice(0, 10))
  );

  const payload = periods
    .map((period) => {
      const refDate = ymdToUtcDate(period.periodEnd, 12, 0, 0);
      const key = refDate.toISOString().slice(0, 10);
      if (existingKeys.has(key)) return null;
      return {
        staffId: staff.id,
        orderId: null,
        action: 'Salary' as const,
        amount: period.amount,
        notes: period.notes,
        referenceDate: refDate,
        createdAt: refDate,
      };
    })
    .filter(Boolean) as Array<{
      staffId: string;
      orderId: null;
      action: 'Salary';
      amount: number;
      notes: string;
      referenceDate: Date;
      createdAt: Date;
    }>;

  let createdCount = 0;

  if (payload.length > 0) {
    await prisma.staffIncome.createMany({ data: payload, skipDuplicates: true });
    createdCount += payload.length;
  }

  // --- Weekend Bonus (Monthly, Weekly, or Daily salary) ---
  if (['Monthly', 'Weekly', 'Daily'].includes(frequency) && (staff as any).paymentType !== 'Commission') {
    try {
      let dayRate: number;
      if (frequency === 'Monthly') {
        dayRate = amount / daysInMonth(today.year, today.month);
      } else if (frequency === 'Weekly') {
        dayRate = amount / 7;
      } else {
        dayRate = amount; // Daily
      }
      createdCount += await ensureWeekendBonuses(staff.id, dayRate, today, timeZone);
    } catch (err) {
      console.error('[WEEKEND_BONUS_ERROR]', { staffId: staff.id, err });
    }
  }

  return createdCount;
}

/**
 * Find weekend days staff worked and add bonus entries.
 * dayRate is pre-computed by caller based on salary frequency.
 * Idempotent: uses referenceDate unique constraint.
 */
async function ensureWeekendBonuses(
  staffId: string,
  dayRate: number,
  today: Ymd,
  _timeZone: string
): Promise<number> {
  // Process current month and previous month (catch late runs)
  const months = [
    { year: today.year, month: today.month },
  ];
  // Also process previous month if we're in first 5 days
  if (today.day <= 5) {
    const prev = addMonths({ year: today.year, month: today.month, day: 1 }, -1);
    months.push({ year: prev.year, month: prev.month });
  }

  let totalCreated = 0;

  for (const { year, month } of months) {
    const weekendWorkDays = await listWeekendWorkDays(staffId, year, month);
    if (weekendWorkDays.length === 0) continue;

    const roundedDayRate = Math.round(dayRate * 100) / 100;

    // Check existing bonuses for this month
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    const existingBonuses = await prisma.staffIncome.findMany({
      where: {
        staffId,
        action: 'WeekendBonus',
        referenceDate: { gte: monthStart, lte: monthEnd },
      },
      select: { referenceDate: true },
    });
    const existingDates = new Set(
      existingBonuses
        .filter((b) => b.referenceDate)
        .map((b) => b.referenceDate!.toISOString().slice(0, 10))
    );

    const bonusPayload = weekendWorkDays
      .map((rec) => {
        const dateStr = rec.date.toISOString().slice(0, 10);
        if (existingDates.has(dateStr)) return null;
        return {
          staffId,
          orderId: null,
          action: 'WeekendBonus' as const,
          amount: roundedDayRate,
          notes: `Weekend bonus ${dateStr}`,
          referenceDate: rec.date,
          createdAt: new Date(),
        };
      })
      .filter(Boolean) as any[];

    if (bonusPayload.length > 0) {
      await prisma.staffIncome.createMany({ data: bonusPayload, skipDuplicates: true });
      totalCreated += bonusPayload.length;
    }
  }

  return totalCreated;
}
