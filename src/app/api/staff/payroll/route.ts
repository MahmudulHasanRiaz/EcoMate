import { NextResponse, type NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { enforcePermission } from '@/lib/security';
import { StaffIncomeAction } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission('staff', 'read');
    if (!allowed) return error;

    const searchParams = request.nextUrl.searchParams;
    const month = parseInt(searchParams.get('month') || (new Date().getMonth() + 1).toString());
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());

    // Simple UTC boundary for the API
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const staffMembers = await prisma.staffMember.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        role: true,
        paymentType: true,
        salaryDetails: true,
        accessibleBusinesses: { select: { name: true } }
      }
    });

    const incomes = await prisma.staffIncome.findMany({
      where: {
        createdAt: { gte: start, lte: end }
      }
    });

    const payments = await prisma.staffPayment.findMany({
      where: {
        date: { gte: start, lte: end }
      }
    });

    const fines = await prisma.staffFine.findMany({
      where: {
        date: { gte: start, lte: end },
        status: 'Active'
      }
    });

    const unpaidLeaves = await prisma.leaveRequest.findMany({
      where: {
        status: 'AdminApproved',
        leaveType: { isPaid: false },
        fromDate: { lte: end },
        toDate: { gte: start },
      },
      include: { leaveType: true }
    });

    const result = staffMembers.map(staff => {
      const staffIncomes = incomes.filter(i => i.staffId === staff.id);
      const staffPayments = payments.filter(p => p.staffId === staff.id);
      const staffFines = fines.filter(f => f.staffId === staff.id);
      const sd = staff.salaryDetails as { amount?: number; frequency?: string } | null;

      const baseSalary = staffIncomes
        .filter(i => i.action === 'Salary' || (i.action === 'Manual' && i.notes?.toLowerCase().includes('salary')))
        .reduce((sum, item) => sum + Number(item.amount), 0);

      const commission = staffIncomes
        .filter(i => Object.values(StaffIncomeAction).includes(i.action as any) && !['Salary', 'WeekendBonus', 'OvertimeBonus', 'Manual'].includes(i.action as any))
        .reduce((sum, item) => sum + Number(item.amount), 0);

      const weekendBonus = staffIncomes
        .filter(i => i.action === 'WeekendBonus')
        .reduce((sum, item) => sum + Number(item.amount), 0);

      const overtimeBonus = staffIncomes
        .filter(i => i.action === 'OvertimeBonus')
        .reduce((sum, item) => sum + Number(item.amount), 0);

      const otherIncome = staffIncomes
        .filter(i => i.action === 'Manual' && !i.notes?.toLowerCase().includes('salary'))
        .reduce((sum, item) => sum + Number(item.amount), 0);

      const staffUnpaidLeaves = unpaidLeaves.filter(l => l.staffId === staff.id);
      let unpaidLeaveDeduction = 0;
      for (const leave of staffUnpaidLeaves) {
        const lstart = leave.fromDate < start ? start : leave.fromDate;
        const lend = leave.toDate > end ? end : leave.toDate;
        const msPerDay = 1000 * 60 * 60 * 24;
        const daysInMonth = Math.max(0, Math.floor((lend.getTime() - lstart.getTime()) / msPerDay) + 1);
        
        let dayRate = 0;
        const actualDaysInMonth = new Date(year, month, 0).getDate();
        if (!sd?.amount) continue;
        const freq = sd.frequency ?? ((staff.paymentType === 'Salary' || staff.paymentType === 'Both') ? 'Monthly' : undefined);
        if (!freq) continue;

        if (freq === 'Monthly') {
            dayRate = sd.amount / actualDaysInMonth;
        } else if (freq === 'Weekly') {
            dayRate = sd.amount / 7;
        } else if (freq === 'Daily') {
            dayRate = sd.amount;
        }
        unpaidLeaveDeduction += daysInMonth * dayRate;
      }

      const totalFines = staffFines.reduce((sum, f) => sum + Number(f.amount), 0) + unpaidLeaveDeduction;
      const totalPaid = staffPayments.reduce((sum, p) => sum + Number(p.amount), 0);

      const totalGross = baseSalary + commission + weekendBonus + overtimeBonus + otherIncome;
      const netPayable = totalGross - totalFines;
      const due = netPayable - totalPaid;

      return {
        id: staff.id,
        name: staff.name,
        role: staff.role,
        paymentType: staff.paymentType,
        baseSalary,
        commission,
        weekendBonus,
        overtimeBonus,
        otherIncome,
        totalGross,
        totalFines,
        netPayable,
        totalPaid,
        due,
      };
    });

    return NextResponse.json({ period: { month, year }, payroll: result });
  } catch (err: any) {
    console.error('[API_ERROR:GET_PAYROLL]', err);
    return NextResponse.json({ error: 'Failed to fetch payroll' }, { status: 500 });
  }
}
