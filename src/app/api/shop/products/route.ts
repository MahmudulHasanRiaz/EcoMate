import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { Product, ProductImage } from '@/types';

export const runtime = 'nodejs';
export const revalidate = 300;
export const dynamic = 'force-static';

const DEFAULT_PLACEHOLDER = '/placeholder.svg';
const normalizeUrl = (input?: string | null) => {
    if (!input) return DEFAULT_PLACEHOLDER;
    const trimmed = input.trim();
    if (!trimmed) return DEFAULT_PLACEHOLDER;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`;
};
const parseImageList = (raw?: string | null) => {
    if (!raw || typeof raw !== 'string') return [] as ProductImage[];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        const trimmed = raw.trim();
        return trimmed ? [{ url: trimmed, id: trimmed.split('/').pop() || trimmed }] : [];
    }
};

export async function GET() {
    try {
        const items = await prisma.product.findMany({
            where: { isPublished: true },
            select: {
                id: true,
                name: true,
                slug: true,
                price: true,
                salePrice: true,
                image: true,
                categoryId: true,
                productType: true,
                variants: { select: { id: true, name: true, sku: true, image: true, price: true, salePrice: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 500,
        });

        // inventory lookup for products + variants
        const productIds = items.map(p => p.id);
        const variantIds = items.flatMap(p => p.variants?.map(v => v.id) || []);
        const inventoryItems = await prisma.inventoryItem.findMany({
            where: {
                OR: [
                    { productId: { in: productIds } },
                    { variantId: { in: variantIds } },
                ],
            },
            select: { productId: true, variantId: true, quantity: true, reservedQuantity: true },
        });
        const productInv: Record<string, number> = {};
        const variantInv: Record<string, number> = {};
        inventoryItems.forEach((i) => {
            const available = Math.max((i.quantity || 0) - (i.reservedQuantity || 0), 0);
            if (i.productId) productInv[i.productId] = (productInv[i.productId] || 0) + available;
            if (i.variantId) variantInv[i.variantId] = (variantInv[i.variantId] || 0) + available;
        });

        const mapped: Product[] = items.map((p) => {
            const images = parseImageList(p.image);
            return {
                id: p.id,
                name: p.name,
                slug: p.slug,
                price: p.price,
                salePrice: p.salePrice ?? undefined,
                image: normalizeUrl(images[0]?.url),
                images: images.map((img) => ({ ...img, url: normalizeUrl(img.url) })),
                categoryId: p.categoryId ?? undefined,
                productType: (p.productType as any) || 'simple',
                inventory: p.productType === 'variable'
                    ? (p.variants || []).reduce((acc, v) => acc + (variantInv[v.id] || 0), 0)
                    : (productInv[p.id] || 0),
                reservedQuantity: 0,
                variants: (p.variants || []).map((v) => ({
                    ...v,
                    image: normalizeUrl((v as any).image || images[0]?.url),
                    inventory: variantInv[v.id] || 0,
                    attributes: {},
                })),
                comboItems: [],
            } as Product;
        });

        return NextResponse.json(
            { success: true, data: mapped },
            { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
        );
    } catch (error: any) {
        console.error('[API_SHOP_PRODUCTS_ERROR]', error);
        return NextResponse.json({ success: false, message: error?.message || 'Internal Server Error' }, { status: 500 });
    }
}
