
import { getPurchasePaymentById } from '@/services/purchases';
import { getPartnerFinancials } from '@/services/partners';
import { getGeneralSettings, getBrandingSettings } from '@/server/utils/app-settings';
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Separator } from '@/components/ui/separator';


import { InvoicePrintButton } from './invoice-print-button';

export default async function PaymentInvoicePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const payment = await getPurchasePaymentById(id);
    const generalSettings = await getGeneralSettings();
    const brandingSettings = await getBrandingSettings();

    if (!payment) return notFound();

    const partnerName = payment.Vendor?.name || payment.PurchaseOrder?.Supplier?.name || 'Unknown Partner';
    const partnerAddress = payment.PurchaseOrder?.Supplier?.address || '';
    const partnerPhone = payment.Vendor?.phone || payment.PurchaseOrder?.Supplier?.phone || '';
    const partnerEmail = payment.Vendor?.email || payment.PurchaseOrder?.Supplier?.email || '';

    const { totalDue } = await getPartnerFinancials(partnerName);

    const appName = generalSettings.storeName || 'EcoMate';
    const businessAddress = generalSettings.storeAddress || '';
    // We don't have business phone in general settings, defaulting or omitting

    // Generate a human-readable voucher number
    // Format: PAY-YYYYMMDD-XXXX (where XXXX is the last 4 chars of the ID)
    const datePart = format(new Date(payment.createdAt), 'yyyyMMdd');
    const idPart = payment.id.slice(-4).toUpperCase();
    const voucherNo = `PAY-${datePart}-${idPart}`;

    return (
        <div className="min-h-screen bg-slate-50 p-8 print:fixed print:inset-0 print:z-[50] print:bg-white print:m-0 print:p-0 print:w-screen print:h-screen print:overflow-visible">
            <div className="max-w-4xl mx-auto bg-white shadow-lg rounded-lg overflow-hidden print:shadow-none print:rounded-none print:w-full print:max-w-none">
                {/* Toolbar - Hidden in Print */}
                <div className="bg-slate-100 p-4 flex justify-between items-center print:hidden border-b">
                    <Button variant="outline" asChild>
                        <Link href={`/dashboard/partners`}>
                            <ArrowLeft className="mr-2 h-4 w-4" /> Back
                        </Link>
                    </Button>
                    <InvoicePrintButton />
                </div>

                {/* Invoice Content */}
                <div className="p-8 md:p-12 print:p-8">
                    {/* Header */}
                    <div className="flex justify-between items-start mb-12">
                        <div className="flex gap-4 items-start">
                            {brandingSettings.standardLogoUrl && (
                                <div className="relative mb-4 print:shadow-none print:border-none print:bg-transparent">
                                    {/* Using standard img for reliable print rendering without shadows/artifacts from next/image wrapper */}
                                    <img
                                        src={brandingSettings.standardLogoUrl}
                                        alt={appName}
                                        className="h-16 w-auto object-contain object-left border-none shadow-none outline-none ring-0 block print:shadow-none print:border-none print:filter-none print:outline-none"
                                        style={{
                                            boxShadow: 'none !important',
                                            border: 'none !important',
                                            filter: 'none !important',
                                            outline: 'none !important',
                                            background: 'transparent !important',
                                            mask: 'none !important'
                                        }}
                                    />
                                </div>
                            )}
                            <div>
                                <h1 className="text-3xl font-bold text-slate-900 mb-2 uppercase tracking-wide">{appName}</h1>
                                <div className="text-slate-500 text-sm leading-relaxed">
                                    <p>{businessAddress}</p>
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            <h2 className="text-4xl font-light text-slate-300 mb-4">PAYMENT VOUCHER</h2>
                            <div className="space-y-1">
                                <div className="flex justify-end gap-4 text-sm">
                                    <span className="text-slate-500 w-24">Voucher No:</span>
                                    <span className="font-mono font-medium text-slate-900">
                                        #{voucherNo}
                                    </span>
                                </div>
                                <div className="flex justify-end gap-4 text-sm">
                                    <span className="text-slate-500 w-24">Date:</span>
                                    <span className="font-medium text-slate-900">
                                        {format(new Date(payment.createdAt), 'MMM dd, yyyy')}
                                    </span>
                                </div>
                                {payment.checkNo && (
                                    <div className="flex justify-end gap-4 text-sm">
                                        <span className="text-slate-500 w-24">Check/Ref:</span>
                                        <span className="font-medium text-slate-900">{payment.checkNo}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <Separator className="my-8" />

                    {/* Paid To */}
                    <div className="mb-12">
                        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Paid To</h3>
                        <div className="text-lg font-semibold text-slate-900">{partnerName}</div>
                        <div className="text-slate-500 text-sm mt-1">
                            {partnerAddress && <p>{partnerAddress}</p>}
                            {partnerPhone && <p>{partnerPhone}</p>}
                            {partnerEmail && <p>{partnerEmail}</p>}
                        </div>
                    </div>

                    {/* Payment Details Table */}
                    <div className="mb-8">
                        <table className="w-full text-left bg-slate-50 rounded-lg overflow-hidden print:bg-white print:border">
                            <thead className="bg-slate-100 text-slate-500 text-xs uppercase font-semibold print:bg-slate-50">
                                <tr>
                                    <th className="p-4">Description</th>
                                    <th className="p-4 w-32 text-center">Reference</th>
                                    <th className="p-4 w-40 text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                <tr>
                                    <td className="p-4">
                                        <div className="font-medium text-slate-900">
                                            {payment.paymentFor || 'Payment'}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-1">
                                            Method: <span className="capitalize">{payment.paymentMethod || 'Cash'}</span>
                                            {payment.checkDate && ` • Check Date: ${format(new Date(payment.checkDate), 'MMM dd, yyyy')}`}
                                            {payment.Account && ` • Paid From: ${payment.Account.name}`}
                                        </div>
                                    </td>
                                    <td className="p-4 text-center font-mono text-sm text-slate-600">
                                        {payment.poId ?
                                            (payment.PurchaseOrder?.supplierId ? 'PO-' + payment.PurchaseOrder.date.toISOString().slice(0, 10) : 'PO')
                                            : '-'
                                        }
                                    </td>
                                    <td className="p-4 text-right font-bold text-slate-900">
                                        ৳{(payment.cash + payment.check).toLocaleString()}
                                    </td>
                                </tr>
                            </tbody>
                            <tfoot className="bg-slate-100 print:bg-slate-50 border-t border-slate-200">
                                <tr>
                                    <td colSpan={2} className="p-4 text-right font-semibold text-slate-700">Total Paid</td>
                                    <td className="p-4 text-right font-bold text-xl text-slate-900">
                                        ৳{(payment.cash + payment.check).toLocaleString()}
                                    </td>
                                </tr>
                                <tr className="border-t border-slate-200 print:border-slate-300">
                                    <td colSpan={2} className="p-4 text-right font-semibold text-slate-700">Total Due</td>
                                    <td className="p-4 text-right font-bold text-xl text-red-600">
                                        Tk {totalDue.toLocaleString()}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Signatures */}
                    <div className="mt-24 grid grid-cols-2 gap-12 print:mt-32">
                        <div className="text-center">
                            <div className="border-t border-slate-300 w-48 mx-auto pt-2">
                                <p className="text-xs font-semibold text-slate-500 uppercase">Received By</p>
                            </div>
                        </div>
                        <div className="text-center">
                            <div className="border-t border-slate-300 w-48 mx-auto pt-2">
                                <p className="text-xs font-semibold text-slate-500 uppercase">Authorized Signature</p>
                            </div>
                        </div>
                    </div>

                    {/* Print Footer */}
                    <div className="mt-12 text-center text-xs text-slate-400 print:block hidden">
                        <p>Generated on {format(new Date(), 'PPpp')} • {appName}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
