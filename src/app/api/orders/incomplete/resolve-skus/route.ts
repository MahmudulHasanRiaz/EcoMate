import prisma from '@/lib/prisma';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';
import { enforcePermission } from '@/lib/security';
import { resolveImageSrc } from '@/lib/image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ResolvedItem {
    productId: string;
    variantId: string | null;
    sku: string;
    name: string;
    price: number;
    quantity: number;
    image: string;
}

function normalizeSkuList(input: any): string[] {
    if (!input) return [];
    if (Array.isArray(input)) {
        return input.map((x) => (typeof x === 'string' ? x : x?.sku || x?.SKU || '')).filter(Boolean);
    }
    if (typeof input === 'string') {
        return input.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
}

export async function POST(req: Request) {
    try {
        const { allowed, error } = await enforcePermission('orders', 'read');
        if (!allowed) return error;

        const body = await req.json().catch(() => ({}));
        const rawSkuList = normalizeSkuList(body?.skuList);
        if (!rawSkuList.length) return apiSuccess({ items: [], missing: [] });

        // Aggregate quantities
        const skuCounts = new Map<string, number>();
        for (const sku of rawSkuList) {
            skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
        }
        const uniqueSkus = Array.from(skuCounts.keys());

        const variants = await prisma.productVariant.findMany({
            where: { sku: { in: uniqueSkus } },
            select: {
                id: true,
                sku: true,
                productId: true,
                price: true,
                salePrice: true,
                name: true,
                image: true,
                product: { select: { name: true, image: true } }
            }
        } as any); // Type assertion to bypass temporary sync issues

        const variantSkuSet = new Set(variants.map((v: any) => v.sku));
        const productSkus = uniqueSkus.filter(sku => !variantSkuSet.has(sku));

        const products = productSkus.length
            ? await prisma.product.findMany({
                where: { sku: { in: productSkus } },
                select: { id: true, sku: true, name: true, price: true, salePrice: true, image: true }
            })
            : [];

        const productBySku = new Map(products.map(p => [p.sku, p]));

        const items: ResolvedItem[] = uniqueSkus.flatMap((sku): ResolvedItem[] => {
            const variant = variants.find((v: any) => v.sku === sku) as any;
            const quantity = skuCounts.get(sku) || 1;

            if (variant) {
                const productData = variant.product || variant.Product;
                const productName = productData?.name || variant.sku;
                const displayName = variant.name ? `${productName} - ${variant.name}` : productName;
                const price = Number(variant.salePrice ?? variant.price ?? 0);
                const rawImg = variant.image || productData?.image;
                const image = resolveImageSrc(rawImg);

                // Debug log for images
                if (rawImg) {
                    console.log(`[RESOLVE_SKUS] SKU: ${sku}, rawImg type: ${typeof rawImg}, resolved: ${image}`);
                }

                return [{
                    productId: variant.productId,
                    variantId: variant.id,
                    sku: variant.sku,
                    name: displayName,
                    price,
                    quantity,
                    image
                }];
            }
            const product = productBySku.get(sku);
            if (product) {
                const price = Number(product.salePrice ?? product.price ?? 0);
                const image = resolveImageSrc(product.image);
                return [{
                    productId: product.id,
                    variantId: null,
                    sku: product.sku,
                    name: product.name,
                    price,
                    quantity,
                    image
                }];
            }
            return [];
        });

        const foundSkuSet = new Set(items.map(i => i.sku));
        const missing = uniqueSkus.filter(sku => !foundSkuSet.has(sku));

        return apiSuccess({ items, missing });
    } catch (e: any) {
        console.error('[API:INCOMPLETE_RESOLVE_SKUS]', e);
        return apiServerError(e);
    }
}
