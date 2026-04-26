
'use client';

import type { Order } from '@/types';
import { format } from 'date-fns';
import Barcode from 'react-barcode';
import React from 'react';
import Image from 'next/image';

export function StickerTemplate({ order }: { order: Order }) {
    const subtotal = order.products.reduce((acc, p) => acc + p.price * p.quantity, 0);
    const siteDiscountTotal = order.products.reduce((sum, p) => sum + (p.siteDiscount || 0), 0);
    const fallbackTotal = subtotal + Number(order.shipping || 0) - Number(order.discount || 0) - siteDiscountTotal;
    const total = Number.isFinite(Number(order.total)) ? Number(order.total) : fallbackTotal;
    const paidAmount = Number(order.paidAmount || 0);
    const shippingPaidAmount = order.shippingPaid ? Number(order.shippingPaidAmount || 0) : 0;
    const codAmount = Math.max(total - paidAmount - shippingPaidAmount, 0);
    const orderNumber = order.orderNumber || order.id;
    const businessName = order.businessName || 'Business';
    const businessLogo = order.businessLogo || '';
    const businessPhone = order.businessPhone || '';
    const barcodeValue = String(orderNumber || '').trim() || order.id;
    const addressParts = [
        order.shippingAddress?.address,
        order.shippingAddress?.city,
        order.shippingAddress?.district,
        order.shippingAddress?.postalCode,
    ].filter(part => part && part !== '.').join(', ');

    return (
        <div className="bg-white p-2 border" style={{ width: '75mm', height: '100mm' }}>
            <div className="h-full flex flex-col justify-between text-[10px] leading-tight">
                {/* Header */}
                <header className="flex justify-between items-start pb-1 border-b">
                    <div>
                        <p className="font-bold text-sm">FROM: {businessName}</p>
                        {businessPhone ? <p>Phone: {businessPhone}</p> : null}
                    </div>
                    <div className="w-12 h-12 flex items-center justify-center">
                        {businessLogo ? (
                            <Image
                                src={businessLogo}
                                alt={`${businessName} Logo`}
                                width={40}
                                height={40}
                                className="rounded-md object-contain"
                            />
                        ) : (
                            <span className="font-bold text-lg">{businessName.slice(0, 1)}</span>
                        )}
                    </div>
                </header>

                {/* To Section */}
                <section className="my-1">
                    <p className="font-bold text-sm">TO: {order.customerName}</p>
                    <p className="text-xs">{addressParts || 'Address not provided'}</p>
                    <p className="font-bold text-lg">{order.customerPhone}</p>
                </section>

                {/* Barcode and Details */}
                <section className="flex-grow flex flex-col justify-center items-center my-1">
                    <div className="w-full text-center">
                        <Barcode
                            value={barcodeValue}
                            format="CODE128"
                            renderer="svg"
                            height={35}
                            width={1.25}
                            fontSize={12}
                            margin={4}
                            lineColor="#000000"
                            background="#ffffff"
                        />
                    </div>
                    <div className="w-full grid grid-cols-2 gap-x-2 mt-2 text-center">
                        <div>
                            <p className="font-bold">COD Amount:</p>
                            <p className="text-2xl font-bold">Tk {codAmount > 0 ? codAmount.toFixed(0) : "0"}</p>
                        </div>
                        <div>
                            <p className="font-bold">Invoice #:</p>
                            <p className="text-lg font-bold">{orderNumber}</p>
                        </div>
                    </div>
                    <div className='w-full text-center mt-1'>
                        <p>Delivery Charge: Tk {order.shipping.toFixed(2)}</p>
                    </div>
                </section>

                {/* Products List */}
                <section className="border-t pt-1">
                    <div className="grid grid-cols-6 gap-x-1 text-[8px]">
                        <div className="font-bold col-span-3">Product (SKU)</div>
                        <div className="font-bold text-center">Qty</div>
                        <div className="font-bold col-span-2 text-right">Price</div>
                        {order.products.map(p => (
                            <React.Fragment key={p.productId}>
                                <div className="col-span-3 truncate">{p.name.substring(0, 25)}{p.name.length > 25 ? '...' : ''} (SKU-XXX)</div>
                                <div className="text-center">{p.quantity}</div>
                                <div className="col-span-2 text-right font-mono">Tk {p.price.toFixed(2)}</div>
                            </React.Fragment>
                        ))}
                    </div>
                </section>

                {/* Footer */}
                <footer className="text-center pt-1 border-t mt-1">
                    <p>Order Date: {format(new Date(order.date), 'dd MMM, yyyy')}</p>
                </footer>
            </div>
        </div>
    );
}
