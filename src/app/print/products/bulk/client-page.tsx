'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import type { Product, ProductVariant } from '@/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import Barcode from 'react-barcode';
import { Printer } from 'lucide-react';

type LabelScope = 'parent' | 'variants' | 'all';
type PriceMode = 'both' | 'regular' | 'sale';

type LabelItem = {
    key: string;
    name: string;
    sku: string;
    price: number;
    salePrice?: number | null;
};

const formatPrice = (value: number | null | undefined) =>
    value != null ? `৳${value.toFixed(2)}` : '৳0.00';

const getBarcodeWidth = (value: string) => {
    const len = value.trim().length;
    if (len <= 10) return 0.95;
    if (len <= 14) return 0.82;
    if (len <= 18) return 0.72;
    return 0.62;
};
const getBarcodeMargin = (value: string) => {
    const len = value.trim().length;
    if (len <= 14) return 2;
    if (len <= 18) return 1.5;
    return 1;
};
function buildLabelEntries(products: Product[], scope: LabelScope, variantIds?: Set<string>): LabelItem[] {
    const entries: LabelItem[] = [];
    const seenSkus = new Set<string>();

    products.forEach((product) => {
        const baseSku = product.sku || '';
        const basePrice = product.price;
        const baseSale = product.salePrice ?? undefined;

        const includeParent = scope === 'parent' || scope === 'all';
        const includeVariants = (scope === 'variants' || scope === 'all') && product.variants?.length;

        if (includeParent && baseSku) {
            if (!seenSkus.has(baseSku)) {
                entries.push({
                    key: `${product.id}-p`,
                    name: product.name,
                    sku: baseSku,
                    price: basePrice,
                    salePrice: baseSale,
                });
                seenSkus.add(baseSku);
            }
        }

        if (includeVariants && product.variants?.length) {
            product.variants.forEach((variant: ProductVariant, idx: number) => {
                if (variantIds && !variantIds.has(variant.id)) return;
                const sku = variant.sku || '';
                if (!sku || seenSkus.has(sku)) return;
                const attrs = variant.attributes ? Object.values(variant.attributes).filter(Boolean).join(' / ') : '';
                entries.push({
                    key: `${product.id}-v-${variant.id || idx}`,
                    name: attrs ? `${product.name} (${attrs})` : product.name,
                    sku,
                    price: variant.price ?? basePrice,
                    salePrice: variant.salePrice ?? baseSale,
                });
                seenSkus.add(sku);
            });
        }
    });

    return entries;
}

function PriceBlock({ item, mode }: { item: LabelItem; mode: PriceMode }) {
    const regular = formatPrice(item.price);
    const sale = item.salePrice != null ? formatPrice(item.salePrice) : null;

    if (mode === 'regular') {
        return (
            <div className="flex items-center leading-tight">
                <span className="font-semibold text-black" style={{ fontSize: 'var(--price-size)' }}>
                    {regular}
                </span>
            </div>
        );
    }
    if (mode === 'sale') {
        return (
            <div className="flex items-center leading-tight">
                <span className="font-semibold text-black" style={{ fontSize: 'var(--price-size)' }}>
                    {sale || regular}
                </span>
            </div>
        );
    }

    // both
    if (sale) {
        return (
            <div className="flex items-baseline justify-center gap-1.5 leading-tight">
                <span className="font-semibold text-black" style={{ fontSize: 'var(--price-size)' }}>
                    {sale}
                </span>
                <span className="text-gray-500 line-through" style={{ fontSize: 'var(--regular-size)' }}>
                    {regular}
                </span>
            </div>
        );
    }
    return (
        <div className="flex items-center leading-tight">
            <span className="font-semibold text-black" style={{ fontSize: 'var(--price-size)' }}>
                {regular}
            </span>
        </div>
    );
}

function LabelCard({ item, mode }: { item: LabelItem; mode: PriceMode }) {
    const barcodeValue = item.sku?.trim() || item.key;
    return (
        <div
            className="label-card border rounded-none w-full h-full flex flex-col justify-between bg-white shadow-none print:shadow-none print:rounded-none print:border print:p-0"
            style={{ pageBreakInside: 'avoid', breakInside: 'avoid' }}
        >
            <div
                className="label-price flex items-start justify-center px-[2.5mm]"
                style={{ paddingTop: 'var(--price-top)' }}
            >
                <PriceBlock item={item} mode={mode} />
            </div>
            <div
                className="label-barcode flex flex-col items-center justify-center px-[2mm]"
                style={{
                    gap: 'var(--barcode-gap)',
                    paddingBottom: 'var(--barcode-bottom)',
                }}
            >
                <Barcode
                    value={barcodeValue}
                    format="CODE128"
                    displayValue={false}
                    height={20}
                    width={getBarcodeWidth(barcodeValue)}
                    fontSize={6}
                    margin={getBarcodeMargin(barcodeValue)}
                    renderer="svg"
                    lineColor="#000000"
                    background="#ffffff"
                />
                <span
                    className="text-gray-600"
                    style={{ fontSize: 'var(--sku-size)', letterSpacing: 'var(--sku-tracking)' }}
                >
                    {item.sku}
                </span>
            </div>
        </div>
    );
}

export default function ProductLabelsBulkClient() {
    const searchParams = useSearchParams();
    const idsParam = searchParams.get('ids') || '';
    const scope = (searchParams.get('scope') as LabelScope) || 'parent';
    const priceMode = (searchParams.get('price') as PriceMode) || 'both';
    const variantIdsParam = searchParams.get('variants');
    const variantIds = React.useMemo(() => {
        if (!variantIdsParam) return undefined;
        const ids = variantIdsParam.split(',').map((id) => id.trim()).filter(Boolean);
        return ids.length ? new Set(ids) : undefined;
    }, [variantIdsParam]);

    const [products, setProducts] = React.useState<Product[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);

    React.useEffect(() => {
        const ids = idsParam.split(',').map((id) => id.trim()).filter(Boolean);
        if (ids.length === 0) {
            setIsLoading(false);
            return;
        }

        const load = async () => {
            setIsLoading(true);
            try {
                const res = await fetch(`/api/products/labels?ids=${encodeURIComponent(ids.join(','))}`);
                if (!res.ok) throw new Error('Failed to load products');
                const data = await res.json();
                setProducts(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error('Failed to load products for labels', error);
                setProducts([]);
            } finally {
                setIsLoading(false);
            }
        };

        load();
    }, [idsParam]);

    const labels = React.useMemo(() => buildLabelEntries(products, scope, variantIds), [products, scope, variantIds]);

    if (isLoading) {
        return (
            <div className="p-8 space-y-4">
                <p>Loading labels...</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[...Array(6)].map((_, i) => <Skeleton key={i} className="w-[70mm] h-[38mm]" />)}
                </div>
            </div>
        );
    }

    if (labels.length === 0) {
        return <div className="p-8 text-center text-muted-foreground">No products to print.</div>;
    }

    return (
        <div
            className="print-root p-4 bg-slate-100 min-h-screen"
            style={
                {
                    '--page-pad': '1mm',
                    '--price-top': '3mm',
                    '--barcode-gap': '0.3mm',
                    '--barcode-bottom': '1.1mm',
                    '--price-size': '11px',
                    '--regular-size': '7px',
                    '--sku-size': '6px',
                    '--sku-tracking': '0.04em',
                } as React.CSSProperties
            }
        >
            <div className="no-print flex items-center justify-between bg-white border rounded-md px-3 py-2 mb-4 shadow-sm">
                <div>
                    <p className="font-semibold">Product Labels</p>
                    <p className="text-sm text-muted-foreground">
                        {labels.length} label{labels.length > 1 ? 's' : ''} · {scope === 'variants' ? 'Variants' : 'Parent'} · {priceMode}
                    </p>
                </div>
                <Button onClick={() => window.print()} size="sm">
                    <Printer className="h-4 w-4 mr-2" /> Print
                </Button>
            </div>

            <div className="print-container grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 print:block print:gap-0 print:grid-cols-1">
                {labels.map((item) => (
                    <div key={item.key} className="print-page">
                        <LabelCard item={item} mode={priceMode} />
                    </div>
                ))}
            </div>

            <style jsx global>{`
        @media print {
          @page {
            size: 48mm 25mm;
            margin: 0;
          }
          html, body { margin: 0 !important; padding: 0 !important; width: 48mm !important; background: white !important; }
          #__next, body > div { width: 48mm !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .print-root { padding: 0 !important; margin: 0 !important; background: white !important; min-height: auto !important; }
          .print-container { display: block !important; gap: 0 !important; width: 48mm !important; }
          .print-page {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 48mm !important;
            height: 25mm !important;
            margin: 0 !important;
            padding: var(--page-pad) !important;
            background: white !important;
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
            box-sizing: border-box !important;
          }
          .print-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .label-card {
            width: calc(48mm - var(--page-pad) - var(--page-pad)) !important;
            height: calc(25mm - var(--page-pad) - var(--page-pad)) !important;
            padding: 0 !important;
            border: 1px solid #000 !important;
            box-shadow: none !important;
            background: white !important;
            margin: 0 !important;
            box-sizing: border-box !important;
            overflow: visible !important;
          }
          .print-page, .print-container, .print-root { box-sizing: border-box !important; }
        }
      `}</style>
        </div>
    );
}


