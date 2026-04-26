

'use client';

import type { Order } from '@/types';
import { format } from 'date-fns';
import Barcode from 'react-barcode';
import React from 'react';
import { User, Phone, MapPin } from 'lucide-react';

export function StickerTemplate({ order }: { order: Order }) {
    const subtotal = order.products.reduce((acc, p) => acc + p.price * p.quantity, 0);
    const siteDiscountTotal = order.products.reduce((sum, p) => sum + (p.siteDiscount || 0), 0);
    const fallbackTotal = subtotal + Number(order.shipping || 0) - Number(order.discount || 0) - siteDiscountTotal;
    const total = Number.isFinite(Number(order.total)) ? Number(order.total) : fallbackTotal;
    const paidAmount = Number(order.paidAmount || 0);
    const shippingPaidAmount = order.shippingPaid ? Number(order.shippingPaidAmount || 0) : 0;
    const codAmount = Math.max(total - paidAmount - shippingPaidAmount, 0);
    const orderNumber = order.orderNumber || order.id;
    const showroomDefaultInvoiceNote = (order as any).Showroom?.defaultInvoiceNote || (order as any).showroomDefaultInvoiceNote || null;
    const addressParts = [
        order.shippingAddress?.address,
        order.shippingAddress?.city,
        order.shippingAddress?.district,
        order.shippingAddress?.postalCode,
    ].filter(part => part && part !== '.').join(', ');

    const businessName = order.businessName || 'Business';
    const businessPhone = (order as any).businessPhone || (order as any).storePhone || '';
    const barcodeValue = String(orderNumber || '').trim() || order.id;

    return (
        <>
            <div className="sticker-container bg-white p-2 border border-black/70" style={{ width: '75mm', height: '100mm' }}>
                <div className="h-full w-full flex flex-col text-[10px] leading-tight font-sans text-black">
                    {/* Header */}
                    <header className="text-center border-b border-black/70 pb-1">
                        <h1 className="text-[15px] font-bold tracking-wide leading-none">{businessName}</h1>
                        {businessPhone ? (
                            <p className="text-[9px] mt-0.5">Phone: {businessPhone}</p>
                        ) : null}
                    </header>

                    {/* Recipient Info */}
                    <section className="py-2 space-y-1.5">
                        <div className="flex items-center gap-2">
                            <User className="w-4 h-4 shrink-0" />
                            <p className="font-bold text-[12px] leading-none truncate">{order.customerName}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 shrink-0" />
                            <p className="text-[10px] font-semibold">{order.customerPhone}</p>
                        </div>
                        <div className="flex items-start gap-2 pt-1">
                            <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                            <p className="text-[9px] leading-snug">{addressParts || 'Address not provided'}</p>
                        </div>
                    </section>
                    
                    {/* Barcode */}
                    <section className="text-center my-2 flex justify-center">
                        <Barcode
                            value={barcodeValue}
                            format="CODE128"
                            renderer="svg"
                            height={32}
                            width={1.2}
                            fontSize={11}
                            margin={4}
                            lineColor="#000000"
                            background="#ffffff"
                        />
                    </section>
                    
                    {/* Pricing Info */}
                    <section className="grid grid-cols-3 divide-x border border-black/70 text-center my-1">
                        <div className="py-1">
                            <p className="font-bold uppercase text-[8px] tracking-wide">COD Amount</p>
                            <p className="text-[12px] font-bold tabular-nums">৳{codAmount > 0 ? codAmount.toFixed(0) : "0"}</p>
                        </div>
                        <div className="py-1">
                            <p className="font-bold uppercase text-[8px] tracking-wide">Delivery</p>
                            <p className="text-[12px] font-bold tabular-nums">৳{order.shipping > 0 ? order.shipping.toFixed(0) : "0"}</p>
                        </div>
                        <div className="py-1">
                            <p className="font-bold uppercase text-[8px] tracking-wide">Total</p>
                            <p className="text-[12px] font-bold tabular-nums">৳{total > 0 ? total.toFixed(0) : "0"}</p>
                        </div>
                    </section>

                    {/* Products List */}
                    <section className="product-list-container border-t border-black/70 pt-1 flex-grow overflow-y-auto">
                        <div className="grid grid-cols-[1fr,auto,auto] gap-x-2 text-[9px] font-medium">
                            <div className="font-bold">Product</div>
                            <div className="font-bold text-center">Qty</div>
                            <div className="font-bold text-right">Price</div>
                        </div>
                        <div className="product-list-items text-[9px] space-y-0.5">
                             {order.products.map((p: any) => (
                                 <div key={p.productId} className="grid grid-cols-[1fr,auto,auto] gap-x-2">
                                    <div className="truncate pr-1">{p.name || p?.product?.name || p?.sku || 'Product'}</div>
                                    <div className="text-center">{p.quantity}</div>
                                    <div className="text-right font-mono">৳{p.price.toFixed(0)}</div>
                                 </div>
                            ))}
                        </div>
                    </section>

                    {/* Footer */}
                    <footer className="pt-1 border-t border-black/70 mt-auto">
                        {showroomDefaultInvoiceNote ? (
                            <div className="text-[9px] leading-snug whitespace-pre-line border border-black/40 rounded p-1 mb-1">
                                {showroomDefaultInvoiceNote}
                            </div>
                        ) : null}
                        <p className="text-center text-[9px]">Order Date: {format(new Date(order.date), 'dd MMM, yyyy')}</p>
                    </footer>
                </div>
            </div>
            <style jsx global>{`
                @media print {
                    @page {
                        size: 75mm 100mm;
                        margin: 0;
                    }
                    html, body {
                        margin: 0;
                        padding: 0;
                    }
                    .sticker-container {
                        box-shadow: none !important;
                    }
                }
                .sticker-container {
                    font-family: 'Poppins', sans-serif;
                }
                .product-list-container {
                    max-height: 40px;
                }
            `}</style>
        </>
    );
}
