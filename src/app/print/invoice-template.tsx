import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import type { Order } from '@/types';
import { format } from 'date-fns';
import Barcode from 'react-barcode';
import { formatLabel } from '@/lib/utils';

export function InvoiceTemplate({ order, paperSize = 'a4' }: { order: Order, paperSize?: 'a4' | 'letter' }) {
    const [storeInfo, setStoreInfo] = useState<{ storeName?: string; storeAddress?: string; storePhone?: string }>({});

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await fetch('/api/settings/general');
                if (res.ok) {
                    const data = await res.json();
                    setStoreInfo({
                        storeName: data.storeName,
                        storeAddress: data.storeAddress,
                        storePhone: data.storePhone,
                    });
                }
            } catch (err) {
                console.error('Failed to fetch general settings:', err);
            }
        };
        fetchSettings();
    }, []);

    const subtotal = order.products.reduce((acc, p) => acc + (p.price || 0) * (p.quantity || 0), 0);
    const shipping = Number(order.shipping || 0);
    const siteDiscountTotal = order.products.reduce((sum, p) => sum + Number(p.siteDiscount || 0), 0);
    const fallbackTotal = subtotal + shipping - Number(order.discount || 0) - siteDiscountTotal;
    const total = Number.isFinite(Number(order.total)) ? Number(order.total) : fallbackTotal;
    const effectiveDiscount = Math.max(subtotal + shipping - total, 0);
    const paidAmount = Number(order.paidAmount || 0);
    const shippingPaidAmount = order.shippingPaid ? Number(order.shippingPaidAmount || 0) : 0;
    const totalPaid = paidAmount + shippingPaidAmount;
    const amountDue = Math.max(total - totalPaid, 0);
    const orderNumber = order.orderNumber || order.id;
    const showroomDefaultInvoiceNote = (order as any).Showroom?.defaultInvoiceNote || (order as any).showroomDefaultInvoiceNote || null;
    const addressParts = [
        order.shippingAddress?.address,
        order.shippingAddress?.city,
        order.shippingAddress?.district,
        order.shippingAddress?.postalCode,
    ].filter(part => part && part !== '.').join(', ');

    const printHeight = paperSize === 'a4' ? '297mm' : '11in';

    const businessName = order.businessName || storeInfo.storeName || 'Business';
    const businessLogo = order.businessLogo || '/logo-icon.svg';
    const displayAddress = order.businessAddress || storeInfo.storeAddress || 'Address not provided';

    return (
        <>
            <div
                className="invoice-page max-w-4xl mx-auto p-8 bg-white text-gray-800 print:shadow-none print:p-6"
                style={{ '--page-height': printHeight } as React.CSSProperties}
            >
                <div className="invoice-content">
                    <header className="flex justify-between items-start pb-6 border-b">
                        <div className="flex items-center gap-4">
                            {businessLogo && <Image src={businessLogo} alt={`${businessName} Logo`} width={40} height={40} className="rounded-md object-contain" />}
                            <div>
                                <h1 className="text-2xl font-bold font-headline text-primary">{businessName}</h1>
                                <p className="text-sm text-gray-500">{displayAddress}</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <h2 className="text-3xl font-bold text-gray-400 uppercase">Invoice</h2>
                            <div className="mt-2 flex justify-end">
                                <Barcode value={orderNumber} height={30} width={1.2} fontSize={10} margin={0} />
                            </div>
                        </div>
                    </header>

                    <section className="grid grid-cols-2 gap-8 mt-8">
                        <div>
                            <h3 className="font-semibold mb-2 text-gray-600">Billed To:</h3>
                            <p className="font-bold">{order.customerName}</p>
                            <p>{addressParts || 'Address not provided'}</p>
                            <p>{order.customerPhone}</p>
                            <p>{order.customerEmail}</p>
                        </div>
                        <div className="text-right">
                            <div className="grid grid-cols-2">
                                <span className="font-semibold text-gray-600">Invoice Date:</span>
                                <span>{(() => {
                                    try {
                                        const d = new Date(order.date);
                                        return isNaN(d.getTime()) ? 'N/A' : format(d, 'MMMM d, yyyy');
                                    } catch (e) {
                                        return 'N/A';
                                    }
                                })()}</span>
                            </div>
                            <div className="grid grid-cols-2 mt-1">
                                <span className="font-semibold text-gray-600">Payment Method:</span>
                                <span>{formatLabel(order.paymentMethod)}</span>
                            </div>
                        </div>
                    </section>

                    <section className="mt-8">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="p-3 text-left font-semibold text-gray-600 w-20">Image</th>
                                    <th className="p-3 text-left font-semibold text-gray-600">Item</th>
                                    <th className="p-3 text-center font-semibold text-gray-600">Qty</th>
                                    <th className="p-3 text-right font-semibold text-gray-600">Price</th>
                                    <th className="p-3 text-right font-semibold text-gray-600">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {order.products.map((p: any) => (
                                    <tr key={p.productId} className="border-b">
                                        <td className="p-3">
                                            <Image
                                                src={p?.image?.imageUrl || p?.product?.image || '/placeholder.svg'}
                                                alt={p?.name || p?.product?.name || 'Product'}
                                                width={48}
                                                height={48}
                                                className="rounded-md object-cover aspect-square"
                                            />
                                        </td>
                                        <td className="p-3 font-medium">{p?.name || p?.product?.name || p?.sku || 'Product'}</td>
                                        <td className="p-3 text-center">{p.quantity}</td>
                                        <td className="p-3 text-right font-mono">৳{p.price.toFixed(2)}</td>
                                        <td className="p-3 text-right font-mono">৳{(p.price * p.quantity).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>

                    <section className="mt-8 flex justify-end">
                        <div className="w-full max-w-sm space-y-2 rounded-lg border p-4">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Subtotal</span>
                                <span className="font-medium font-mono">৳{subtotal.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Shipping</span>
                                <span className="font-medium font-mono">৳{shipping.toFixed(2)}</span>
                            </div>
                            {effectiveDiscount > 0 && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Discount</span>
                                    <span className="font-medium font-mono">- ৳{effectiveDiscount.toFixed(2)}</span>
                                </div>
                            )}
                            <div className="border-t my-2"></div>
                            <div className="flex justify-between text-xl font-bold">
                                <span>Total</span>
                                <span className="font-mono">৳{total.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-base font-semibold pt-2 text-green-600">
                                <span>Paid</span>
                                <span className="font-mono">৳{paidAmount.toFixed(2)}</span>
                            </div>
                            {shippingPaidAmount > 0 && (
                                <div className="flex justify-between text-sm text-green-600">
                                    <span>Shipping Paid</span>
                                    <span className="font-mono">৳{shippingPaidAmount.toFixed(2)}</span>
                                </div>
                            )}
                            <div className="flex justify-between text-lg font-semibold">
                                <span className="text-red-500">Amount Due</span>
                                <span className="text-red-500 font-mono">৳{amountDue.toFixed(2)}</span>
                            </div>
                        </div>
                    </section>
                </div>

                <footer className="invoice-footer border-t pt-4">
                    {showroomDefaultInvoiceNote ? (
                        <div className="mb-2 text-center text-sm text-gray-600 whitespace-pre-line">
                            {showroomDefaultInvoiceNote}
                        </div>
                    ) : null}
                    <p className="text-center text-sm text-gray-500">Thank you for your purchase!</p>
                </footer>
            </div>
            <style jsx global>{`
                @media print {
                    .invoice-page {
                        height: var(--page-height); 
                        display: flex;
                        flex-direction: column;
                        justify-content: space-between;
                    }
                    .invoice-content {
                       flex-grow: 1;
                       padding-bottom: 10mm;
                    }
                }
            `}</style>
        </>
    );
}
