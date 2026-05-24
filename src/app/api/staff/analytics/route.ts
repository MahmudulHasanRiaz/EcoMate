import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { startOfDay, endOfDay, eachDayOfInterval, format } from 'date-fns';

interface CommissionDetails {
  onOrderCreate?: number;
  onOrderConfirm?: number;
  onOrderPacked?: number;
  onOrderConvert?: number;
  targetEnabled?: boolean;
  targetPeriod?: 'Daily' | 'Weekly' | 'Monthly';
  targetCount?: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const staffId = searchParams.get('staffId');
    const dateFromStr = searchParams.get('dateFrom');
    const dateToStr = searchParams.get('dateTo');

    if (!staffId || !dateFromStr || !dateToStr) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const dateFrom = new Date(dateFromStr);
    const dateTo = new Date(dateToStr);

    // Validate date range (max 31 days)
    const diffTime = Math.abs(dateTo.getTime() - dateFrom.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays > 31) {
      return NextResponse.json({ error: 'Date range cannot exceed 31 days' }, { status: 400 });
    }

    // 1. Fetch Staff and Commission Details
    const staff = await prisma.staffMember.findUnique({
      where: { id: staffId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        commissionDetails: true,
        role: true,
      }
    });

    if (!staff) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 });
    }

    const commission = staff.commissionDetails as unknown as CommissionDetails;

    // 2. Fetch Attendance Records
    const attendance = await prisma.attendanceRecord.findMany({
      where: {
        staffId,
        date: { gte: startOfDay(dateFrom), lte: endOfDay(dateTo) },
      },
      select: {
        date: true,
        status: true,
      }
    });

    // 3. Fetch Orders and Logs
    const orders = await prisma.order.findMany({
      where: {
        OR: [
          { createdBy: staffId },
          { confirmedBy: staffId },
          { salesRepresentativeId: staffId },
        ],
        date: { gte: startOfDay(dateFrom), lte: endOfDay(dateTo) },
        isDeleted: false,
      },
      select: {
        id: true,
        status: true,
        source: true,
        createdBy: true,
        confirmedBy: true,
        salesRepresentativeId: true,
        date: true,
      }
    });

    // 4. Calculate Analytics

    // A. Active vs Present Days
    const presentDays = new Set(
      attendance
        .filter(a => a.status === 'Present' || a.status === 'Late')
        .map(a => format(a.date, 'yyyy-MM-dd'))
    );

    const activeDays = new Set(
      orders.map(o => format(o.date, 'yyyy-MM-dd'))
    );

    // Process orders for commission logic
    const ordersByDay: Record<string, typeof orders> = {};
    eachDayOfInterval({ start: startOfDay(dateFrom), end: endOfDay(dateTo) }).forEach(day => ordersByDay[format(day, 'yyyy-MM-dd')] = []);
    
    for (const order of orders) {
      const dayKey = format(order.date, 'yyyy-MM-dd');
      if (ordersByDay[dayKey]) {
        ordersByDay[dayKey].push(order);
      }
    }

    // Sort each day's orders chronologically
    for (const dayKey in ordersByDay) {
        ordersByDay[dayKey].sort((a, b) => a.date.getTime() - b.date.getTime());
    }

    // B. Daily Stats and Commissionable Tasks
    const dailyStats: Record<string, { 
      created: number; confirmed: number; converted: number; delivered: number; 
      commissionable: number 
    }> = {};
    
    var totalEligibleTasksVar = 0;
    var finalCommissionableCountVar = 0;
    var finalBreakdownVar = { create: 0, confirm: 0, convert: 0, packed: 0 };
    var deliveredEligibleTasksVar = 0;

    eachDayOfInterval({ start: startOfDay(dateFrom), end: endOfDay(dateTo) }).forEach(day => {
      const key = format(day, 'yyyy-MM-dd');
      const dayOrders = ordersByDay[key];
      
      let created = 0, confirmed = 0, converted = 0, delivered = 0;
      let eligibleOrders: (typeof orders[0] & { type: string })[] = [];

      dayOrders.forEach(order => {
        if (order.createdBy === staffId) created++;
        if (order.confirmedBy === staffId) confirmed++;
        if (order.source === 'woo-incomplete' && order.createdBy === staffId) converted++;
        if (order.status === 'Delivered' && 
            (order.createdBy === staffId || order.confirmedBy === staffId || order.salesRepresentativeId === staffId)) {
          delivered++;
        }

        const isCreateEligible = commission?.onOrderCreate && order.createdBy === staffId;
        const isConfirmEligible = commission?.onOrderConfirm && order.confirmedBy === staffId;
        const isConvertEligible = commission?.onOrderConvert && order.source === 'woo-incomplete' && order.createdBy === staffId;
        const isPackedEligible = commission?.onOrderPacked && order.createdBy === staffId;

        if (isCreateEligible || isConfirmEligible || isConvertEligible || isPackedEligible) {
           eligibleOrders.push({ ...order, type: isCreateEligible ? 'create' : isConfirmEligible ? 'confirm' : isConvertEligible ? 'convert' : 'packed' });
        }
      });

      const targetCount = commission?.targetCount || 0;
      let dailyCommissionableVar = 0;

      eligibleOrders.forEach((order, index) => {
        if (index >= targetCount) {
          if (order.status === 'Delivered') {
            dailyCommissionableVar++;
            finalCommissionableCountVar++;
            deliveredEligibleTasksVar++;
            finalBreakdownVar[order.type as keyof typeof finalBreakdownVar]++;
          }
        }
      });

      dailyStats[key] = { created, confirmed, converted, delivered, commissionable: dailyCommissionableVar };
      totalEligibleTasksVar += eligibleOrders.length;
    });

    const excessTasks = Math.max(0, totalEligibleTasksVar - (commission?.targetCount || 0));

    return NextResponse.json({
      staff: {
        id: staff.id,
        name: staff.name,
        email: staff.email,
        phone: staff.phone,
        role: staff.role,
        commission: commission
      },
      summary: {
        activeDays: activeDays.size,
        presentDays: presentDays.size,
        commission: {
          enabled: !!commission?.targetEnabled,
          rates: {
            onOrderCreate: commission?.onOrderCreate || 0,
            onOrderConfirm: commission?.onOrderConfirm || 0,
            onOrderPacked: commission?.onOrderPacked || 0,
            onOrderConvert: commission?.onOrderConvert || 0,
          },
          targetPeriod: commission?.targetPeriod || 'Monthly',
          targetCount: commission?.targetCount || 0,
          totalTasksWorked: totalEligibleTasksVar,
          excessTasks: excessTasks,
          deliveredEligibleTasks: deliveredEligibleTasksVar,
          finalCommissionable: finalCommissionableCountVar,
          finalBreakdown: finalBreakdownVar
        }
      },
      dailyStats
    });

  } catch (error: any) {
    console.error('[STAFF_ANALYTICS_API_ERROR]', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
