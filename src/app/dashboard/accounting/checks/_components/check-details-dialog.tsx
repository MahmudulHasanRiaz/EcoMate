'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Eye, Printer } from "lucide-react";
import { format } from "date-fns";
import type { Payment, Vendor, PurchaseOrder, ProductionStep } from "@/types";

type EnrichedPayment = Payment & {
    vendor?: Vendor | null;
    purchaseOrder?: PurchaseOrder | null;
    productionStep?: ProductionStep | null;
    poId?: string | null;
};

interface CheckDetailsDialogProps {
    payment: EnrichedPayment;
    storeName?: string;
}

export function CheckDetailsDialog({ payment, storeName = 'EcoMate' }: CheckDetailsDialogProps) {
    const amount = (payment.cash || 0) + (payment.check || 0);
    const purpose = payment.productionStep?.stepType || payment.paymentFor || 'General';
    const date = payment.checkDate ? new Date(payment.checkDate) : new Date();

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Eye className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md bg-white text-slate-900 border-2 border-slate-200 shadow-xl sm:max-w-lg">
                <div className="flex flex-col gap-6 p-2">
                    {/* Header */}
                    <div className="flex flex-col items-center justify-center space-y-2 border-b-2 border-slate-100 pb-6 border-dashed">
                        <div className="text-xl font-bold tracking-tight uppercase text-slate-900">{storeName}</div>
                        <div className="text-sm font-medium text-slate-500 uppercase tracking-widest">Payment Voucher</div>
                    </div>

                    {/* Amount */}
                    <div className="flex flex-col items-center justify-center space-y-1 bg-slate-50 p-4 rounded-lg border border-slate-100">
                        <div className="text-sm text-slate-500 font-medium uppercase">Amount Payable</div>
                        <div className="text-3xl font-bold text-slate-900">
                            Tk {amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                    </div>

                    {/* Details Grid */}
                    <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-slate-400 uppercase font-semibold">Pay To</span>
                            <span className="font-medium text-slate-900">{payment.vendor?.name || 'General Supplier'}</span>
                        </div>
                        <div className="flex flex-col gap-1 text-right">
                            <span className="text-xs text-slate-400 uppercase font-semibold">Voucher #</span>
                            <span className="font-medium text-slate-900 font-mono truncate">{(payment.id || '').slice(0, 8)}</span>
                        </div>

                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-slate-400 uppercase font-semibold">Passing Date</span>
                            <span className="font-medium text-slate-900">{format(date, 'PP')}</span>
                        </div>
                        <div className="flex flex-col gap-1 text-right">
                            <span className="text-xs text-slate-400 uppercase font-semibold">Check No</span>
                            <span className="font-medium text-slate-900 font-mono text-lg">{payment.checkNo || 'N/A'}</span>
                        </div>

                        <div className="flex flex-col gap-1 col-span-2">
                            <span className="text-xs text-slate-400 uppercase font-semibold">Purpose / Ref</span>
                            <div className="flex items-center justify-between">
                                <span className="font-medium text-slate-900">{purpose}</span>
                                {payment.poId && <span className="text-slate-500">PO #{payment.poId}</span>}
                            </div>
                        </div>
                    </div>

                    {/* Footer / Signature Area */}
                    <div className="mt-8 grid grid-cols-2 gap-8 pt-8">
                        <div className="flex flex-col gap-2">
                            <div className="h-px w-full bg-slate-300" />
                            <span className="text-[10px] uppercase text-slate-400 font-semibold text-center">Authorized Signature</span>
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="h-px w-full bg-slate-300" />
                            <span className="text-[10px] uppercase text-slate-400 font-semibold text-center">Receiver Signature</span>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
