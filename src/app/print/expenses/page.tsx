import { Suspense } from 'react';
import prisma from '@/lib/prisma';
import { getGeneralSettings } from '@/server/utils/app-settings';
import { ExpensesPrintClient } from './client-page';
import { notFound } from 'next/navigation';

export default async function ExpensesPrintPage({
    searchParams,
}: {
    searchParams: Promise<{ ids?: string }>;
}) {
    const sp = await searchParams;
    const ids = sp.ids?.split(',').filter(Boolean) || [];

    if (ids.length === 0) {
        return <div className="p-8 text-center">No expenses selected to print.</div>;
    }

    const [rawExpenses, settings] = await Promise.all([
        prisma.expense.findMany({
            where: { id: { in: ids } },
            include: {
                ExpenseCategory: true,
                Business: true,
                StaffPayment: {
                    include: {
                        staff: true
                    }
                },
                Account_Expense_paidFromAccountIdToAccount: true,
                Account_Expense_payableAccountIdToAccount: true,
            },
            orderBy: { date: 'asc' },
        }),
        getGeneralSettings(),
    ]);

    if (rawExpenses.length === 0) {
        return notFound();
    }

    // Normalize Prisma relation keys for print client compatibility.
    const expenses = rawExpenses.map((expense) => ({
        ...expense,
        category: expense.ExpenseCategory ?? null,
        business: expense.Business ?? null,
        staffPayment: expense.StaffPayment ?? null,
        paidFromAccount: expense.Account_Expense_paidFromAccountIdToAccount ?? null,
        payableAccount: expense.Account_Expense_payableAccountIdToAccount ?? null,
    }));

    return (
        <Suspense fallback={<div>Loading print view...</div>}>
            <ExpensesPrintClient expenses={expenses} settings={settings} />
        </Suspense>
    );
}
