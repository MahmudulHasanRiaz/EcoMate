'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { GeneralSettings } from '@/server/utils/app-settings';

interface ExpensePrintClientProps {
    expenses: any[];
    settings: GeneralSettings;
}

export function ExpensesPrintClient({ expenses, settings }: ExpensePrintClientProps) {
    const currencySymbol = 'Tk';

    const totalAmount = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

    React.useEffect(() => {
        // Optional: Auto-print on load
        // window.print();
    }, []);

    return (
        <div className="bg-white min-h-screen p-8 print:p-0 font-sans text-sm">
            {/* Header / Actions */}
            <div className="no-print mb-8 flex justify-between items-center bg-gray-100 p-4 rounded-lg">
                <div>
                    <h1 className="text-xl font-bold">Print Preview</h1>
                    <p className="text-muted-foreground text-sm">
                        {expenses.length} expenses selected
                    </p>
                </div>
                <Button onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print Now
                </Button>
            </div>

            {/* Printable Area */}
            <div className="max-w-4xl mx-auto print:max-w-none space-y-6">

                {/* Branding Header */}
                <div className="text-center border-b pb-4 mb-4">
                    <h1 className="text-2xl font-bold uppercase tracking-wide">{settings.storeName}</h1>
                    {settings.storeAddress && (
                        <p className="text-gray-600 whitespace-pre-wrap">{settings.storeAddress}</p>
                    )}
                    <h2 className="text-lg font-semibold mt-4">Expense Report</h2>
                    <p className="text-sm text-gray-500">
                        Generated on {format(new Date(), 'MMM d, yyyy h:mm a')}
                    </p>
                </div>

                {/* Expenses Table */}
                <div className="overflow-hidden border rounded-lg border-gray-300">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-100 print:bg-gray-100 text-gray-700 font-semibold uppercase text-xs">
                            <tr>
                                <th className="p-3 border-b border-gray-300">Date</th>
                                <th className="p-3 border-b border-gray-300">Category</th>
                                <th className="p-3 border-b border-gray-300">Description / Notes</th>
                                <th className="p-3 border-b border-gray-300">Paid Via</th>
                                <th className="p-3 border-b border-gray-300">Status</th>
                                <th className="p-3 border-b border-gray-300 text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {expenses.map((expense) => (
                                <tr key={expense.id} className="break-inside-avoid">
                                    <td className="p-3 align-top whitespace-nowrap">
                                        {format(new Date(expense.date), 'MMM d, yyyy')}
                                    </td>
                                    <td className="p-3 align-top font-medium">
                                        {expense.category?.name ?? expense.ExpenseCategory?.name ?? 'Uncategorized'}
                                        {expense.isAdExpense && (
                                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-blue-100 text-blue-800 border border-blue-200">
                                                AD
                                            </span>
                                        )}
                                    </td>
                                    <td className="p-3 align-top">
                                        <div className="flex flex-col gap-1">
                                            {expense.notes && <span>{expense.notes}</span>}
                                            {(expense.staffPayment ?? expense.StaffPayment) && (
                                                <span className="text-xs text-gray-600">
                                                    Staff: {(expense.staffPayment ?? expense.StaffPayment)?.staff?.name}
                                                </span>
                                            )}
                                            {(expense.business ?? expense.Business) && (
                                                <span className="text-xs text-gray-600 border px-1 rounded w-fit">
                                                    {(expense.business ?? expense.Business)?.name}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-3 align-top text-xs text-gray-600">
                                        {expense.isPaid ? (
                                            <>
                                                {(expense.paidFromAccount ?? expense.Account_Expense_paidFromAccountIdToAccount)?.name ?? 'Cash'}
                                                {expense.paidAt && (
                                                    <div className="mt-0.5 opacity-75">
                                                        {format(new Date(expense.paidAt), 'MMM d')}
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <span className="text-amber-600 font-medium">Unpaid</span>
                                        )}
                                    </td>
                                    <td className="p-3 align-top">
                                        <div className="flex flex-col gap-1">
                                            <span className={cn(
                                                "text-[10px] font-bold uppercase",
                                                expense.approvalStatus === 'Approved' ? "text-green-600" :
                                                    expense.approvalStatus === 'Rejected' ? "text-red-600" :
                                                        "text-gray-500"
                                            )}>
                                                {expense.approvalStatus}
                                            </span>
                                            {expense.submittedByName && (
                                                <span className="text-[9px] text-gray-500">By: {expense.submittedByName}</span>
                                            )}
                                            {expense.approvalStatus === 'Approved' && expense.approvedByName && (
                                                <span className="text-[9px] text-green-600">Appr: {expense.approvedByName}</span>
                                            )}
                                            {expense.approvalStatus === 'Rejected' && expense.rejectedByName && (
                                                <span className="text-[9px] text-red-600">Rej: {expense.rejectedByName}</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-3 align-top text-right font-mono font-bold">
                                        {currencySymbol}{Number(expense.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        {/* Footer / Totals */}
                        <tfoot className="bg-gray-50 font-bold border-t-2 border-gray-300">
                            <tr>
                                <td colSpan={4} className="p-3 text-right uppercase text-gray-600 text-xs">Total Expenses</td>
                                <td className="p-3 text-right font-mono text-base">
                                    {currencySymbol}{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                {/* Signature Area (Optional) */}
                <div className="mt-16 pt-8 border-t border-dashed border-gray-300 grid grid-cols-3 gap-8 text-sm text-gray-500">
                    <div className="text-center">
                        <p className="font-semibold mb-1">Prepared By</p>
                        {expenses.length === 1 && expenses[0].submittedByName ? (
                            <div className="text-xs">
                                <p>{expenses[0].submittedByName}</p>
                                <p>{expenses[0].submittedAt ? format(new Date(expenses[0].submittedAt), 'MMM d, yyyy') : ''}</p>
                            </div>
                        ) : (
                            <div className="h-8"></div>
                        )}
                        <div className="h-0 w-3/4 mx-auto border-b border-gray-400 mt-2"></div>
                    </div>
                    <div className="text-center">
                        <p className="font-semibold mb-1">Manager Approval</p>
                        {expenses.length === 1 && expenses[0].approvedByName ? (
                            <div className="text-xs">
                                <p>{expenses[0].approvedByName}</p>
                                <p>{expenses[0].approvedAt ? format(new Date(expenses[0].approvedAt), 'MMM d, yyyy') : ''}</p>
                            </div>
                        ) : (
                            <div className="h-8"></div>
                        )}
                        <div className="h-0 w-3/4 mx-auto border-b border-gray-400 mt-2"></div>
                    </div>
                    <div className="text-center">
                        <p className="font-semibold mb-1">Finance Payment</p>
                        {expenses.length === 1 && expenses[0].paidByName ? (
                            <div className="text-xs">
                                <p>{expenses[0].paidByName}</p>
                                <p>{expenses[0].paidAt ? format(new Date(expenses[0].paidAt), 'MMM d, yyyy') : ''}</p>
                            </div>
                        ) : (
                            <div className="h-8"></div>
                        )}
                        <div className="h-0 w-3/4 mx-auto border-b border-gray-400 mt-2"></div>
                    </div>
                </div>

            </div>

            <style jsx global>{`
        @media print {
            @page {
                margin: 0.5in;
                size: auto; 
            }
            body { 
                background: white !important; 
                -webkit-print-color-adjust: exact !important; 
                print-color-adjust: exact !important; 
            }
            .no-print { display: none !important; }
        }
      `}</style>
        </div>
    );
}
