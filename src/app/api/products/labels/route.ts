import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import type { Product, ProductImage, ProductVariant, ComboItem } from '@/types';
import { ProductType as ProductTypeEnum } from '@prisma/client';

const prismaToAppType: Record<string, Product['productType']> = {
  simple: 'simple',
  variable: 'variable',
  combo: 'combo',
  '3-piece': 'variable',
  three_piece: 'variable',
};

const DEFAULT_PLACEHOLDER = '/placeholder.svg';

function normalizeUrl(input?: string | null) {
  if (!input) return DEFAULT_PLACEHOLDER;
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_PLACEHOLDER;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`;
}

function mapProduct(raw: any): Product {
  const images: ProductImage[] =
    raw.image && typeof raw.image === 'string'
      ? JSON.parse(raw.image)
      : [];

  const variants: ProductVariant[] =
    raw.variants?.map((v: any) => ({
      ...v,
      attributes: v.attributes as Record<string, string>,
      // Fallback to parent thumbnail when variant image is missing
      image: normalizeUrl((v as any).image || images[0]?.url),
      salePrice: v.salePrice ?? undefined,
      inventory: 0,
    })) || [];

  const comboItems: ComboItem[] =
    raw.comboItems?.map((ci: any) => ({
      childId: ci.childId,
      childProduct: {
        id: ci.child.id,
        name: ci.child.name,
        sku: ci.child.sku,
      },
      variantId: ci.variantId ?? undefined,
      variantName: ci.variant?.name ?? undefined,
      variantSku: ci.variant?.sku ?? undefined,
      available: 0,
    })) || [];

  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    description: raw.description ?? '',
    shortDescription: raw.shortDescription ?? undefined,
    price: raw.price,
    salePrice: raw.salePrice ?? undefined,
    inventory: 0,
    reservedQuantity: 0,
    image: normalizeUrl(images[0]?.url),
    images: images.map((img) => ({ ...img, url: normalizeUrl(img.url) })),
    categoryId: raw.categoryId ?? undefined,
    tags: raw.tags ?? undefined,
    weight: raw.weight ?? undefined,
    length: raw.length ?? undefined,
    width: raw.width ?? undefined,
    height: raw.height ?? undefined,
    ornaFabric: raw.ornaFabric ?? undefined,
    jamaFabric: raw.jamaFabric ?? undefined,
    selowarFabric: raw.selowarFabric ?? undefined,
    sku: raw.sku,
    productType: prismaToAppType[raw.productType] as Product['productType'],
    variants,
    comboItems,
  };
}

export async function GET(req: NextRequest) {
  try {
    const idsParam = req.nextUrl.searchParams.get('ids');
    if (!idsParam) {
      return NextResponse.json({ error: 'Missing ids' }, { status: 400 });
    }
    const ids = idsParam.split(',').map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) {
      return NextResponse.json({ error: 'No valid ids provided' }, { status: 400 });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      include: {
        variants: true,
        comboItems: { include: { child: true, variant: true } },
      },
    });

    return NextResponse.json(products.map(mapProduct));
  } catch (error) {
    console.error('[API_PRODUCTS_LABELS]', error);
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 });
  }
}
