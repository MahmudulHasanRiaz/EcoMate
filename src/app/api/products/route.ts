import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import type { Product, ProductImage, ProductType as AppProductType } from '@/types';
import { ProductType as ProductTypeEnum } from '@prisma/client';
import { checkPermission } from '@/lib/security';
import { apiSuccess, apiServerError } from '@/lib/error';
import { createProduct } from '@/services/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const prismaToAppType: Record<string, AppProductType> = {
  // ...
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

function parseImageList(raw?: string | null) {
  if (!raw || typeof raw !== 'string') return [] as any[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const trimmed = raw.trim();
    return trimmed ? [{ url: trimmed, id: trimmed.split('/').pop() || trimmed }] : [];
  }
}

function mapProduct(p: any, inventoryMap: Record<string, number>, variantInventoryMap: Record<string, number>): Product {
  const images: ProductImage[] = parseImageList(p.image) as ProductImage[];

  const comboItems = p.comboItems.map((ci: any) => {
    const available = ci.variantId
      ? (variantInventoryMap[ci.variantId] || 0)
      : (inventoryMap[ci.childId] || 0);
    return {
      childId: ci.childId,
      childProduct: {
        id: ci.child.id,
        name: ci.child.name,
        sku: ci.child.sku,
      },
      variantId: ci.variantId ?? undefined,
      variantName: ci.variant?.name ?? undefined,
      variantSku: ci.variant?.sku ?? undefined,
      available,
    };
  });

  const comboStock = comboItems.length
    ? Math.min(...comboItems.map((item: any) => item.available))
    : 0;

  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    isPublished: p.isPublished ?? true,
    description: p.description ?? '',
    shortDescription: p.shortDescription ?? undefined,
    price: p.price,
    salePrice: p.salePrice ?? undefined,
    reservedQuantity: p.reservedQuantity ?? 0,
    inventory: p.productType === 'combo' ? comboStock : (inventoryMap[p.id] || 0),
    image: normalizeUrl(images[0]?.url),
    images: images.map((img) => ({ ...img, url: normalizeUrl(img.url) })),
    categoryId: p.categoryId ?? undefined,
    tags: p.tags ?? undefined,
    weight: p.weight ?? undefined,
    length: p.length ?? undefined,
    width: p.width ?? undefined,
    height: p.height ?? undefined,
    ornaFabric: p.ornaFabric ?? undefined,
    jamaFabric: p.jamaFabric ?? undefined,
    selowarFabric: p.selowarFabric ?? undefined,
    sku: p.sku,
    productType: prismaToAppType[p.productType] as AppProductType,
    wholesaleEnabled: p.wholesaleEnabled ?? false,
    wholesaleVisible: p.wholesaleVisible ?? false,
    wholesalePrice: p.wholesalePrice ?? undefined,
    wholesaleMinQuantity: p.wholesaleMinQuantity ?? undefined,
    wholesalePackQuantity: p.wholesalePackQuantity ?? undefined,
    wholesaleUnitLabel: p.wholesaleUnitLabel ?? undefined,
    wholesaleNote: p.wholesaleNote ?? undefined,
    variants:
      p.variants?.map((v: any) => ({
        ...v,
        attributes: v.attributes as Record<string, string>,
        image: normalizeUrl((v as any).image || images[0]?.url),
        salePrice: v.salePrice ?? undefined,
        inventory: variantInventoryMap[v.id] || 0,
      })) || [],
    comboItems,
  };
}

export async function GET(req: NextRequest) {
  try {
    // For the public shop, we allow read access to products without strict enforcement.
    const productsPerm = await checkPermission('products', 'read');
    const inventoryPerm = await checkPermission('inventory', 'read');

    // We proceed even if not authorized as staff

    const { searchParams } = req.nextUrl;
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const cursor = searchParams.get('cursor') || undefined;
    const search = searchParams.get('search') || undefined;
    const mode = searchParams.get('mode') || undefined;
    const categoryId = searchParams.get('categoryId') || undefined;

    const type = searchParams.get('type') || undefined;
    const locationId = searchParams.get('locationId') || undefined;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: search, mode: 'insensitive' } } } },
        { comboItems: { some: { child: { sku: { contains: search, mode: 'insensitive' } } } } },
        { comboItems: { some: { variant: { sku: { contains: search, mode: 'insensitive' } } } } },
      ];
    }
    if (categoryId && categoryId !== 'all') {
      where.categoryId = categoryId;
    }
    if (type) {
      if (type === 'combo') where.productType = 'combo';
      // Add other checks if needed, but P03e scope is combo
    }

    const items = await prisma.product.findMany({
      where,
      take: pageSize + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        variants: true,
        comboItems: { include: { child: true, variant: true } },
      },
    });

    let nextCursor: string | null = null;
    if (items.length > pageSize) {
      const nextItem = items.pop();
      nextCursor = nextItem!.id;
    }

    // Optimization: Skip inventory calc for 'lookup' mode used in dropdowns
    if (mode === 'lookup') {
      console.log('[API_PRODUCTS] Lookup mode active. Items count:', items.length);
      try {
        const mapped = items.map((p) => {
          const images = parseImageList(p.image) as any[];
          return {
            id: p.id,
            name: p.name,
            image: normalizeUrl(images[0]?.url),
            images: images.map((img: any) => ({ ...img, url: normalizeUrl(img.url) })),
            sku: p.sku,
            isPublished: p.isPublished ?? true,
            productType: prismaToAppType[p.productType] as AppProductType,
            variants: p.variants?.map((v: any) => ({
              ...v,
              attributes: v.attributes as Record<string, string>,
              image: normalizeUrl((v as any).image || images[0]?.url),
              inventory: 0,
              salePrice: v.salePrice ?? undefined,
            })) || [],
            // Default zero inventory for lookup speed
            reservedQuantity: 0,
            inventory: 0,
            comboItems: [],
            tags: p.tags ?? undefined,
            price: p.price,
            salePrice: p.salePrice ?? undefined,
            description: '',
            shortDescription: undefined,
            categoryId: p.categoryId ?? undefined,
            weight: p.weight ?? undefined,
            length: p.length ?? undefined,
            width: p.width ?? undefined,
            height: p.height ?? undefined,
            ornaFabric: p.ornaFabric ?? undefined,
            jamaFabric: p.jamaFabric ?? undefined,
            selowarFabric: p.selowarFabric ?? undefined,
            wholesaleEnabled: p.wholesaleEnabled ?? false,
            wholesaleVisible: p.wholesaleVisible ?? false,
            wholesalePrice: p.wholesalePrice ?? undefined,
            wholesaleMinQuantity: p.wholesaleMinQuantity ?? undefined,
            wholesalePackQuantity: p.wholesalePackQuantity ?? undefined,
            wholesaleUnitLabel: p.wholesaleUnitLabel ?? undefined,
            wholesaleNote: p.wholesaleNote ?? undefined,
          } as Product;
        });
        return apiSuccess({ items: mapped, nextCursor });
      } catch (err: any) {
        console.error('[API_PRODUCTS] Lookup optimization failed:', err);
        return apiSuccess({ items: [], nextCursor: null });
      }
    }

    // Fetch inventory for both products and variants
    const productIdsToFetch = new Set<string>();
    const variantIdsToFetch = new Set<string>();

    items.forEach(p => {
      productIdsToFetch.add(p.id);
      if (p.variants) {
        p.variants.forEach((v: any) => variantIdsToFetch.add(v.id));
      }
      if (p.productType === 'combo' && p.comboItems) {
        p.comboItems.forEach((ci: any) => {
          productIdsToFetch.add(ci.childId);
          if (ci.variantId) variantIdsToFetch.add(ci.variantId);
        });
      }
    });

    const invWhere: any = {
      OR: [
        { productId: { in: Array.from(productIdsToFetch) } },
        { variantId: { in: Array.from(variantIdsToFetch) } },
      ]
    };
    if (locationId && locationId !== 'all') {
      invWhere.locationId = locationId;
    }

    const inventoryItems = await prisma.inventoryItem.findMany({
      where: invWhere,
      select: { productId: true, variantId: true, quantity: true, reservedQuantity: true },
    });

    // Build inventory maps for products and variants
    const inventoryMap: Record<string, number> = {};
    const variantInventoryMap: Record<string, number> = {};

    inventoryItems.forEach(item => {
      const available = (item.quantity || 0) - (item.reservedQuantity || 0);

      if (item.productId) {
        inventoryMap[item.productId] = (inventoryMap[item.productId] || 0) + available;
      }

      if (item.variantId) {
        variantInventoryMap[item.variantId] = (variantInventoryMap[item.variantId] || 0) + available;
      }
    });

    const mapped = items.map((p) => mapProduct(p, inventoryMap, variantInventoryMap));

    return apiSuccess({ items: mapped, nextCursor });
  } catch (error: any) {
    return apiServerError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { allowed, error, staff } = await checkPermission('products', 'create');
    if (!allowed) return error;

    const formData = await req.formData();
    // Use email or name as actor
    const actor = staff?.email || staff?.name || 'System';
    const result = await createProduct(formData, actor);

    return apiSuccess(result);
  } catch (error) {
    console.error('[API_PRODUCTS_CREATE]', error);
    return apiServerError('Failed to create product');
  }
}
