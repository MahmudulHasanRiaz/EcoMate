'use server';

import prisma from '@/lib/prisma';
import type {
  Product,
  Category,
  ProductType as AppProductType,
  ProductVariant,
  ProductLog,
  ProductImage,
} from '@/types';
import { writeFile, mkdir, unlink, readdir, rmdir } from 'fs/promises';
import { join, dirname } from 'path';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { Prisma, ProductType as ProductTypeEnum } from '@prisma/client';
import { revalidateTags } from '@server/utils/revalidate';
import { triggerStockStatusSync } from '@server/modules/stock-sync';
import { getGeneralSettings } from '@server/utils/app-settings';
import { cookies } from 'next/headers';

import { getBaseUrl, handleApiResponse } from '@/lib/api-helper';

const API_BASE_URL = `${getBaseUrl()}/api`;
const API_PRODUCTS_URL = `${API_BASE_URL}/products`;

const DEFAULT_PLACEHOLDER =
  PlaceHolderImages.find((p) => p.id === '1')?.imageUrl || '/placeholder.svg';

const appTypeToPrismaType: Record<AppProductType, ProductTypeEnum> = {
  simple: ProductTypeEnum.simple,
  variable: ProductTypeEnum.variable,
  combo: ProductTypeEnum.combo,
  three_piece: ProductTypeEnum.piece,
};

const prismaTypeToAppType: Record<ProductTypeEnum, AppProductType> = {
  simple: 'simple',
  variable: 'variable',
  combo: 'combo',
  piece: 'three_piece',
};

// Normalize URLs to always have a leading slash unless absolute
function normalizeUrl(input?: string | null) {
  if (!input) return DEFAULT_PLACEHOLDER;
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_PLACEHOLDER;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`;
}

/* -------------------------------------------------------
   Helpers: slug/SKU smart unique generator
------------------------------------------------------- */

// lightweight slugify (UI’র generateSlug এরই server twin)
function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '');
}

// Normalize SKU: uppercase + keep [A-Z0-9-]
function normalizeSku(input: string) {
  return input
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9-]/g, '');
}

// If sku missing: make one from name + time
function autoSkuFromName(name: string) {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const head =
    (words[0]?.slice(0, 3) || 'PRD') + (words[1]?.slice(0, 2) || '');
  const tail = Date.now().toString(36).toUpperCase(); // short unique
  return normalizeSku(`${head}-${tail}`);
}

// ensure product.slug unique: base, base-2, base-3, ...
async function ensureUniqueSlug(base: string) {
  const b = slugify(base) || 'product';
  let candidate = b;

  // quick check first
  const exists = await prisma.product.findFirst({ where: { slug: candidate }, select: { id: true } });
  if (!exists) return candidate;

  // try with incremental numeric suffixes
  for (let i = 2; i <= 9999; i++) {
    candidate = `${b}-${i}`;
    const hit = await prisma.product.findFirst({ where: { slug: candidate }, select: { id: true } });
    if (!hit) return candidate;
  }
  // ultra fallback
  return `${b}-${Date.now()}`;
}

// ensure product.sku unique: BASE, BASE-001, BASE-002, ...
async function ensureUniqueSku(base: string) {
  const b = normalizeSku(base) || 'PRD';
  let candidate = b;

  const exists = await prisma.product.findFirst({ where: { sku: candidate }, select: { id: true } });
  if (!exists) return candidate;

  for (let i = 1; i <= 9999; i++) {
    candidate = `${b}-${String(i).padStart(3, '0')}`;
    const hit = await prisma.product.findFirst({ where: { sku: candidate }, select: { id: true } });
    if (!hit) return candidate;
  }
  return `${b}-${Date.now().toString(36).toUpperCase()}`;
}

// ensure variant.sku unique globally (ProductVariant.sku is unique)
async function ensureUniqueVariantSku(base: string) {
  const b = normalizeSku(base) || 'VAR';
  let candidate = b;

  const exists = await prisma.productVariant.findFirst({ where: { sku: candidate }, select: { id: true } });
  if (!exists) return candidate;

  for (let i = 1; i <= 9999; i++) {
    candidate = `${b}-${String(i).padStart(2, '0')}`;
    const hit = await prisma.productVariant.findFirst({ where: { sku: candidate }, select: { id: true } });
    if (!hit) return candidate;
  }
  return `${b}-${Date.now().toString(36).toUpperCase()}`;
}

// attribute values → slug: "Red / XL" → "red-xl"
function attrSlug(attrs: Record<string, string>) {
  return Object.values(attrs)
    .map((v) => slugify(v))
    .join('-');
}

// filename slugify helper: keep extension, slugify basename, add short unique suffix
function slugifyFilename(filename: string) {
  const dotIndex = filename.lastIndexOf('.');
  const ext = dotIndex > -1 ? filename.slice(dotIndex) : '';
  const base = (dotIndex > -1 ? filename.slice(0, dotIndex) : filename)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  const suffix = Date.now().toString(36);
  return `${base || 'file'}-${suffix}${ext}`;
}

/* -------------------------------------------------------
   Image upload helper
------------------------------------------------------- */

async function uploadImages(
  imageFiles: File[],
): Promise<{ url: string; id: string }[]> {
  if (!imageFiles || imageFiles.length === 0) {
    return [];
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const uploadsDir = join(process.cwd(), 'public/uploads');

  try {
    await mkdir(uploadsDir, { recursive: true });
  } catch (error) {
    console.error('Error creating upload directory:', error);
    throw new Error('Could not create upload directory.');
  }

  const uploadPromises = imageFiles.map(async (file) => {
    if (!allowedTypes.includes(file.type)) {
      console.warn(`Skipping invalid file type: ${file.type}`);
      return null;
    }

    try {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const filename = slugifyFilename(file.name);
      const path = join(uploadsDir, filename);
      await writeFile(path, buffer);
      return { url: `/uploads/${filename}`, id: filename };
    } catch (error) {
      console.error(`Error writing file ${file.name}:`, error);
      return null;
    }
  });

  const results = await Promise.all(uploadPromises);
  return results.filter(
    (result): result is { url: string; id: string } => result !== null,
  );
}

/* -------------------------------------------------------
   Queries
------------------------------------------------------- */

export async function getProducts(options?: RequestInit): Promise<Product[]> {
  try {
    const headers = new Headers(options?.headers || {});
    try {
      const cookieHeader = (await cookies())
        .getAll()
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      if (cookieHeader) headers.set('cookie', cookieHeader);
    } catch { /* ignore cookie forwarding when unavailable */ }
    const res = await fetch(API_PRODUCTS_URL, {
      ...options,
      headers,
      cache: 'no-store',
    });
    return await handleApiResponse<Product[]>(res).then(data => {
      if (Array.isArray(data)) return data;
      if ((data as any)?.items) return (data as any).items;
      return [];
    });
  } catch (error: any) {
    console.error('[SERVICE_ERROR:getProducts]', error);
    return [];
  }
}

export async function getProductsPaged(
  params?: {
    page?: number;
    pageSize?: number;
    cursor?: string;
    search?: string;
    categoryId?: string;
    mode?: string;
    type?: string;
  },
  options?: RequestInit
): Promise<{ items: Product[]; nextCursor: string | null }> {
  try {
    const url = new URL(API_PRODUCTS_URL);
    if (params?.page) url.searchParams.set('page', String(params.page));
    if (params?.pageSize) url.searchParams.set('pageSize', String(params.pageSize));
    if (params?.cursor) url.searchParams.set('cursor', params.cursor);
    if (params?.search) url.searchParams.set('search', params.search);
    if (params?.categoryId) url.searchParams.set('categoryId', params.categoryId);
    if (params?.mode) url.searchParams.set('mode', params.mode);
    if (params?.type) url.searchParams.set('type', params.type);

    const headers = new Headers(options?.headers || {});
    try {
      const cookieHeader = (await cookies())
        .getAll()
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      if (cookieHeader) headers.set('cookie', cookieHeader);
    } catch { /* ignore cookie forwarding when unavailable */ }
    const res = await fetch(url.toString(), {
      ...options,
      headers,
      cache: 'no-store',
    });
    return await handleApiResponse<{ items: Product[]; nextCursor: string | null }>(res);
  } catch (error) {
    console.error('[SERVICE_ERROR:getProductsPaged]', error);
    return { items: [], nextCursor: null };
  }
}

export async function getAllProductsLookup(
  params?: {
    search?: string;
    categoryId?: string;
    pageSize?: number;
  },
  options?: RequestInit
): Promise<Product[]> {
  const pageSize = Math.min(Math.max(params?.pageSize ?? 200, 1), 500);
  const collected: Product[] = [];
  const seenProductIds = new Set<string>();
  const seenCursors = new Set<string>();

  let cursor: string | undefined;

  for (let i = 0; i < 2000; i += 1) {
    const { items, nextCursor } = await getProductsPaged(
      {
        pageSize,
        cursor,
        search: params?.search,
        categoryId: params?.categoryId,
        mode: 'lookup',
      },
      options
    );

    if (!Array.isArray(items) || items.length === 0) break;

    for (const item of items) {
      if (!seenProductIds.has(item.id)) {
        seenProductIds.add(item.id);
        collected.push(item);
      }
    }

    if (!nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return collected;
}

export async function getComboProductsPaginated(
  params?: {
    page?: number;
    pageSize?: number;
    cursor?: string;
    search?: string;
    locationId?: string;
  },
  options?: RequestInit
): Promise<{ items: Product[]; nextCursor: string | null }> {
  try {
    const url = new URL(API_PRODUCTS_URL);
    if (params?.page) url.searchParams.set('page', String(params.page));
    if (params?.pageSize) url.searchParams.set('pageSize', String(params.pageSize));
    if (params?.cursor) url.searchParams.set('cursor', params.cursor);
    if (params?.search) url.searchParams.set('search', params.search);
    if (params?.locationId && params.locationId !== 'all') url.searchParams.set('locationId', params.locationId);
    url.searchParams.set('type', 'combo');

    const headers = new Headers(options?.headers || {});
    try {
      const cookieHeader = (await cookies())
        .getAll()
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      if (cookieHeader) headers.set('cookie', cookieHeader);
    } catch { /* ignore */ }
    const res = await fetch(url.toString(), {
      ...options,
      headers,
      cache: 'no-store',
    });
    return await handleApiResponse<{ items: Product[]; nextCursor: string | null }>(res);
  } catch (error) {
    console.error('[SERVICE_ERROR:getComboProductsPaginated]', error);
    return { items: [], nextCursor: null };
  }
}

export async function getProductById(id: string): Promise<Product | undefined> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: true,
      Attribute: true,
      ProductLog: { orderBy: { timestamp: 'desc' }, take: 5 },
      comboItems: { include: { child: true, variant: true } },
      ProductCategory: { select: { categoryId: true } },
    },
  });

  if (!product) return undefined;

  const { ProductLog: productLogs, ...rest } = product;
  const comboChildIds = product.comboItems?.map((ci) => ci.childId) || [];
  const inventoryItems = await prisma.inventoryItem.findMany({
    where: {
      OR: [
        { productId: product.id },
        ...(comboChildIds.length ? [{ productId: { in: comboChildIds } }] : []),
      ],
    },
    select: { productId: true, variantId: true, quantity: true, reservedQuantity: true },
  });

  const inventoryMap: Record<string, number> = {};
  const variantInventoryMap: Record<string, number> = {};
  const reservedMap: Record<string, number> = {};
  const variantReservedMap: Record<string, number> = {};

  inventoryItems.forEach((item) => {
    const available = Math.max((item.quantity || 0) - (item.reservedQuantity || 0), 0);
    const reserved = item.reservedQuantity || 0;
    inventoryMap[item.productId] = (inventoryMap[item.productId] || 0) + available;
    reservedMap[item.productId] = (reservedMap[item.productId] || 0) + reserved;
    if (item.variantId) {
      variantInventoryMap[item.variantId] = (variantInventoryMap[item.variantId] || 0) + available;
      variantReservedMap[item.variantId] = (variantReservedMap[item.variantId] || 0) + reserved;
    }
  });

  const images: ProductImage[] =
    product.image && typeof product.image === 'string'
      ? JSON.parse(product.image)
      : [];
  const appType = prismaTypeToAppType[product.productType] || 'simple';

  const comboItems = product.comboItems.map((ci) => {
    const available = ci.variantId
      ? (variantInventoryMap[ci.variantId] || 0)
      : (inventoryMap[ci.childId] || 0);
    return {
      childId: ci.childId,
      childProduct: { id: ci.child.id, name: ci.child.name, sku: ci.child.sku, productType: ci.child.productType },
      variantId: ci.variantId ?? undefined,
      variantName: ci.variant?.name ?? undefined,
      variantSku: ci.variant?.sku ?? undefined,
      variantImage: ci.variant?.image ? normalizeUrl(ci.variant.image as string) : (ci.child.image ? normalizeUrl(typeof ci.child.image === 'string' && ci.child.image.startsWith('[') ? JSON.parse(ci.child.image)[0]?.url : ci.child.image as string) : undefined),
      available,
    };
  });

  const comboStock = comboItems.length
    ? Math.min(...comboItems.map((item) => item.available || 0))
    : 0;

  return {
    ...rest,
    description: product.description ?? '',
    salePrice: product.salePrice ?? undefined,
    reservedQuantity: reservedMap[product.id] || 0,
    inventory: product.productType === ProductTypeEnum.combo ? comboStock : (inventoryMap[product.id] || 0),
    image: normalizeUrl(images[0]?.url),
    images: images.map((img) => ({ ...img, url: normalizeUrl(img.url) })),
    categoryId: product.categoryId ?? undefined,
    categoryIds: (() => {
      const fromJoin = (product as any).ProductCategory?.map((pc: any) => pc.categoryId) || [];
      // Fallback: if join table empty but legacy categoryId exists, use it
      if (fromJoin.length === 0 && product.categoryId) return [product.categoryId];
      return fromJoin;
    })(),
    attributes:
      (product as any).Attribute?.map((attr: any) => ({
        id: attr.id,
        name: attr.name,
        options: Array.isArray(attr.options) ? attr.options : [],
      })) || [],
    variants:
      product.variants?.map((v) => ({
        ...v,
        attributes: v.attributes as Record<string, string>,
        // Fallback to parent thumbnail when variant image is missing
        image: normalizeUrl((v as any).image || images[0]?.url),
        salePrice: v.salePrice ?? undefined,
        inventory: variantInventoryMap[v.id] || 0,
        reservedQuantity: variantReservedMap[v.id] || 0,
      })) || [],
    logs: (productLogs || []).map((log: any) => ({
      ...log,
      timestamp: log.timestamp.toISOString(),
      details: log.details || undefined,
    })),
    productType: appType,
    comboItems,
  };
}

export async function getProductBySlug(
  slug: string,
): Promise<Product | undefined> {
  const product = await prisma.product.findFirst({
    where: { slug: { equals: slug }, isPublished: { not: false } },
    include: { variants: true },
  });

  if (!product) return undefined;

  const { ...rest } = product;

  // Real inventory lookup
  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { productId: product.id },
    select: { variantId: true, quantity: true, reservedQuantity: true },
  });

  const productInvMap: Record<string, number> = {};
  const variantInvMap: Record<string, number> = {};
  inventoryItems.forEach(item => {
    const available = Math.max((item.quantity || 0) - (item.reservedQuantity || 0), 0);
    if (!item.variantId) {
      productInvMap[product.id] = (productInvMap[product.id] || 0) + available;
    } else {
      variantInvMap[item.variantId] = (variantInvMap[item.variantId] || 0) + available;
    }
  });

  const images: ProductImage[] =
    product.image && typeof product.image === 'string'
      ? JSON.parse(product.image)
      : [];
  const appType = prismaTypeToAppType[product.productType] || 'simple';

  return {
    ...rest,
    description: product.description ?? '',
    price: product.price,
    salePrice: product.salePrice ?? undefined,
    inventory: appType === 'variable'
      ? Object.values(variantInvMap).reduce((acc, q) => acc + q, 0)
      : (productInvMap[product.id] || 0),
    reservedQuantity: 0,
    image: normalizeUrl(images[0]?.url),
    images: images.map((img) => ({ ...img, url: normalizeUrl(img.url) })),
    categoryId: product.categoryId ?? undefined,
    variants:
      product.variants?.map((v) => ({
        ...v,
        attributes: v.attributes as Record<string, string>,
        image: normalizeUrl((v as any).image),
        salePrice: v.salePrice ?? undefined,
        inventory: variantInvMap[v.id] || 0,
      })) || [],
    slug: product.slug,
    shortDescription: product.shortDescription,
    sku: product.sku,
    productType: appType,
    tags: product.tags,
    weight: product.weight,
    length: product.length,
    width: product.width,
    height: product.height,
    ornaFabric: product.ornaFabric,
    jamaFabric: product.jamaFabric,
    selowarFabric: product.selowarFabric,
    comboItems: [],
  } as Product;
}

export async function getCategories(): Promise<Category[]> {
  try {
    const url = `${getBaseUrl()}/api/products/categories`;
    const headers = new Headers();
    try {
      const cookieHeader = (await cookies())
        .getAll()
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');
      if (cookieHeader) headers.set('cookie', cookieHeader);
    } catch { }

    const res = await fetch(url, { headers, cache: 'no-store' });
    return await handleApiResponse<Category[]>(res).catch(() => []);
  } catch (error) {
    console.error('Failed to fetch categories:', error);
    return [];
  }
}

/* -------------------------------------------------------
   Create
------------------------------------------------------- */

export async function createProduct(
  formData: FormData,
  actor: string = 'System',
): Promise<{ success: boolean; message?: string; redirect?: string }> {
  let newProduct: any;

  const getString = (key: string, def = '') =>
    formData.get(key)?.toString() || def;
  const getOptionalString = (key: string) => getString(key) || undefined;
  const getFloat = (key: string) => parseFloat(getString(key, '0'));
  const getOptionalFloat = (key: string) => {
    const value = getString(key);
    return value ? parseFloat(value) : undefined;
  };

  try {
    const name = getString('name');
    let incomingSlug = getString('slug');
    let incomingSku = getString('sku');

    if (!name) {
      return { success: false, message: 'Product name is required.' };
    }

    // Smart slug
    if (!incomingSlug) incomingSlug = slugify(name);
    const slug = await ensureUniqueSlug(incomingSlug);

    // Smart parent SKU
    if (!incomingSku) incomingSku = autoSkuFromName(name);
    const sku = await ensureUniqueSku(incomingSku);

    const rawProductType = getString('productType') as AppProductType;
    const productType = rawProductType === 'three_piece' ? 'variable' : rawProductType;
    const prismaProductType: ProductTypeEnum =
      appTypeToPrismaType[productType] || ProductTypeEnum.simple;

    const wholesaleEnabled = getString('wholesaleEnabled') === 'true';
    let wholesaleVisible = getString('wholesaleVisible') === 'true';
    const wholesalePriceRaw = getString('wholesalePrice');
    const wholesaleMinRaw = getString('wholesaleMinQuantity');
    const wholesalePackRaw = getString('wholesalePackQuantity');
    const wholesalePrice = wholesalePriceRaw ? parseFloat(wholesalePriceRaw) : undefined;
    const wholesaleMinQuantity = wholesaleMinRaw ? parseInt(wholesaleMinRaw, 10) : undefined;
    const wholesalePackQuantity = wholesalePackRaw ? parseInt(wholesalePackRaw, 10) : undefined;

    if (!wholesaleEnabled) {
      wholesaleVisible = false;
    }

    if (wholesaleVisible && productType !== 'variable') {
      if (wholesalePrice === undefined || isNaN(wholesalePrice) || wholesalePrice <= 0) {
        return { success: false, message: 'Wholesale price must be greater than 0 when visible.' };
      }
    }

    if (wholesaleMinQuantity !== undefined && (isNaN(wholesaleMinQuantity) || wholesaleMinQuantity <= 0)) {
        return { success: false, message: 'Minimum wholesale quantity must be a positive integer.' };
    }
    if (wholesalePackQuantity !== undefined && (isNaN(wholesalePackQuantity) || wholesalePackQuantity <= 0)) {
        return { success: false, message: 'Wholesale pack quantity must be a positive integer.' };
    }

    const dataForPrisma: Prisma.ProductCreateInput = {
      name,
      slug,
      sku,
      productType: prismaProductType,
      description: getOptionalString('description'),
      shortDescription: getOptionalString('shortDescription'),
      price: getFloat('price'),
      salePrice: getOptionalFloat('salePrice'),
      inventory: 0,
      tags: getOptionalString('tags'),
      weight: getOptionalFloat('weight'),
      length: getOptionalFloat('length'),
      width: getOptionalFloat('width'),
      height: getOptionalFloat('height'),
      isPublished: getString('isPublished', 'true') === 'true',
      wholesaleEnabled,
      wholesaleVisible,
      wholesalePrice,
      wholesaleMinQuantity,
      wholesalePackQuantity,
      wholesaleUnitLabel: getOptionalString('wholesaleUnitLabel'),
      wholesaleNote: getOptionalString('wholesaleNote'),
    };

    const categoryId = getOptionalString('categoryId');
    // Parse categoryIds JSON for multi-category support
    let categoryIds: string[] = [];
    const categoryIdsRaw = formData.get('categoryIds') as string | null;
    if (categoryIdsRaw) {
      try { categoryIds = JSON.parse(categoryIdsRaw); } catch { /* ignore */ }
    }
    // Fallback: if categoryIds empty but categoryId present, sync from it
    const effectiveCategoryId = (categoryId && categoryId !== 'none') ? categoryId : null;
    if (categoryIds.length === 0 && effectiveCategoryId) {
      categoryIds = [effectiveCategoryId];
    }
    // Set primary categoryId: from explicit field or first from categoryIds
    const primaryCategoryId = effectiveCategoryId || categoryIds[0] || null;
    if (primaryCategoryId) {
      (dataForPrisma as any).Category = { connect: { id: primaryCategoryId } };
    }

    if (productType === 'variable') {
      dataForPrisma.ornaFabric = getOptionalFloat('ornaFabric');
      dataForPrisma.jamaFabric = getOptionalFloat('jamaFabric');
      dataForPrisma.selowarFabric = getOptionalFloat('selowarFabric');
    }

    const attributesRaw = formData.getAll('attributes');
    const variationsRaw = formData.getAll('variations');

    if (
      productType === 'variable' &&
      attributesRaw.length > 0
    ) {
      const attributes = attributesRaw.map((attr) => JSON.parse(attr as string));

      // Sanitize: trim names, remove blank/duplicate options, prevent duplicate names
      const attrMap = new Map<string, string[]>();
      for (const attr of attributes) {
        const name = String(attr?.name || '').trim();
        if (!name) continue;

        const lowerName = name.toLowerCase();
        const options = Array.from(
          new Set(
            String(attr?.options || '')
              .split(',')
              .map((o) => o.trim())
              .filter((o) => Boolean(o) && o.toLowerCase() !== lowerName),
          ),
        );

        if (options.length === 0) continue;

        // last write wins for duplicate names; avoids DB unique violation
        attrMap.set(name, options);
      }

      if (attrMap.size > 0) {
        (dataForPrisma as any).Attribute = {
          create: Array.from(attrMap.entries()).map(([name, options]) => ({ name, options })),
        };
      }
    }

    // -------- Variant image uploads (per-variant) --------
    const variantImageEntries = Array.from(formData.entries()).filter(
      ([key, value]) => key.startsWith('variantImage:') && value instanceof File,
    ) as [string, File][];

    const uploadedVariantImageMap = new Map<string, string>();

    if (variantImageEntries.length > 0) {
      for (const [key, file] of variantImageEntries) {
        try {
          const variationId = key.split(':')[1];
          const uploaded = await uploadImages([file]);
          const url = normalizeUrl(uploaded[0]?.url);
          if (variationId && url) uploadedVariantImageMap.set(variationId, url);
        } catch (err) {
          console.warn('[VARIANT_IMAGE_UPLOAD_FAILED:create]', key, err);
        }
      }
    }

    if (
      productType === 'variable' &&
      variationsRaw.length > 0
    ) {
      const raw = variationsRaw.map((v) => JSON.parse(v as string));
      const toCreate: Prisma.ProductVariantCreateWithoutProductInput[] = [];
      const seenVariantKeys = new Set<string>();

      let index = 0;
      for (const variant of raw) {
        const cleanedAttrs = Object.fromEntries(
          Object.entries(variant.attributes || {})
            .map(([k, v]) => [String(k).trim(), String(v).trim()])
            .filter(([, v]) => Boolean(v)),
        );

        // Skip variants that have no usable attributes
        if (Object.keys(cleanedAttrs).length === 0) continue;

        // Dedupe by attribute signature
        const variantKey = attrSlug(cleanedAttrs);
        if (seenVariantKeys.has(variantKey)) continue;
        seenVariantKeys.add(variantKey);

        const title = Object.values(cleanedAttrs).join(' / ');
        const baseSku =
          variant.sku && variant.sku.trim()
            ? normalizeSku(variant.sku)
            : normalizeSku(`${sku}-${variantKey || ++index}`);

        const vSku = await ensureUniqueVariantSku(baseSku);

        const uploadedVariantUrl = variant?.id ? uploadedVariantImageMap.get(String(variant.id)) : undefined;
        const imageValue = uploadedVariantUrl
          ?? (typeof variant.image === 'string' && !variant.image.startsWith('__file__:') ? variant.image : null);

        const vWholesalePrice = variant.wholesalePrice ? parseFloat(String(variant.wholesalePrice)) : undefined;
        const vWholesaleMin = variant.wholesaleMinQuantity ? parseInt(String(variant.wholesaleMinQuantity), 10) : undefined;
        const vWholesalePack = variant.wholesalePackQuantity ? parseInt(String(variant.wholesalePackQuantity), 10) : undefined;

        if (vWholesaleMin !== undefined && (isNaN(vWholesaleMin) || vWholesaleMin <= 0)) {
            return { success: false, message: 'Variant minimum wholesale quantity must be a positive integer.' };
        }
        if (vWholesalePack !== undefined && (isNaN(vWholesalePack) || vWholesalePack <= 0)) {
            return { success: false, message: 'Variant wholesale pack quantity must be a positive integer.' };
        }

        if (wholesaleVisible && (vWholesalePrice === undefined || isNaN(vWholesalePrice) || vWholesalePrice <= 0)) {
           if (wholesalePrice === undefined || isNaN(wholesalePrice) || wholesalePrice <= 0) {
              return { success: false, message: 'When wholesale is visible, variable products must have a valid wholesale price on the parent or every variant.' };
           }
        }

        toCreate.push({
          name: title || `Variant ${index}`,
          sku: vSku,
          price: variant.price ? parseFloat(String(variant.price)) : undefined,
          salePrice: variant.salePrice ? parseFloat(String(variant.salePrice)) : undefined,
          attributes: cleanedAttrs,
          image: imageValue,
          wholesalePrice: vWholesalePrice,
          wholesaleMinQuantity: vWholesaleMin,
          wholesalePackQuantity: vWholesalePack,
        });
      }

      if (toCreate.length > 0) {
        dataForPrisma.variants = { create: toCreate };
      }
    }

    // ------- combo products with variant support -------
    if (productType === 'combo') {
      // New format: comboItems JSON array with {childId, variantId?}
      const comboItemsRaw = formData.get('comboItems');

      if (comboItemsRaw) {
        try {
          const comboItems = JSON.parse(comboItemsRaw as string) as Array<{
            childId: string;
            variantId?: string | null;
          }>;

          if (comboItems.length > 0) {
            // Validate that all child products exist and check productType
            const childIds = comboItems.map(item => item.childId);
            const existingChildren = await prisma.product.findMany({
              where: { id: { in: childIds } },
              select: { id: true, productType: true },
            });
            const childMap = new Map(existingChildren.map(p => [p.id, p.productType]));

            // Validate variable children have variantId
            for (const item of comboItems) {
              const childType = childMap.get(item.childId);
              if (!childType) continue; // will be filtered out below
              if ((childType === ProductTypeEnum.variable || childType === ProductTypeEnum.piece) && !item.variantId) {
                return {
                  success: false,
                  message: 'Combo items must include a variant for variable products.',
                };
              }
            }

            const validItems = comboItems.filter(item => childMap.has(item.childId));

            // Validate variantIds belong to their respective child products
            const variantIds = validItems.map(i => i.variantId).filter(Boolean) as string[];
            if (variantIds.length > 0) {
              const variants = await prisma.productVariant.findMany({
                where: { id: { in: variantIds } },
                select: { id: true, productId: true },
              });
              const variantToProduct = new Map(variants.map(v => [v.id, v.productId]));
              for (const item of validItems) {
                if (item.variantId && variantToProduct.get(item.variantId) !== item.childId) {
                  return {
                    success: false,
                    message: `Variant ${item.variantId} does not belong to product ${item.childId}.`,
                  };
                }
              }
            }

            if (validItems.length === 0) {
              return {
                success: false,
                message: 'No valid combo products found. Please select valid products.',
              };
            }

            dataForPrisma.comboItems = {
              create: validItems.map(item => ({
                child: { connect: { id: item.childId } },
                ...(item.variantId && { variant: { connect: { id: item.variantId } } }),
              })),
            };
          }
        } catch (error) {
          console.error('[COMBO_PARSE_ERROR]', error);
          return {
            success: false,
            message: 'Invalid combo items format. Please try again.',
          };
        }
      } else {
        // Fallback: Old format for backward compatibility
        const comboRaw = formData.getAll('comboProductIds');

        const comboIds = comboRaw
          .map((raw) => {
            let s =
              typeof raw === 'string'
                ? raw
                : raw?.toString
                  ? raw.toString()
                  : '';

            s = s.trim();
            if (!s) return '';

            if (
              (s.startsWith('"') && s.endsWith('"')) ||
              (s.startsWith("'") && s.endsWith("'"))
            ) {
              try {
                s = JSON.parse(s);
              } catch {
                // keep as is
              }
            }

            return s.trim();
          })
          .filter((id) => id && id !== 'none' && id !== 'undefined' && id !== 'null');

        if (comboIds.length > 0) {
          const existingChildren = await prisma.product.findMany({
            where: { id: { in: comboIds } },
            select: { id: true, productType: true },
          });

          // Reject variable/piece children in legacy format (no variant info)
          const hasVariableChild = existingChildren.some(
            c => c.productType === ProductTypeEnum.variable || c.productType === ProductTypeEnum.piece
          );
          if (hasVariableChild) {
            return {
              success: false,
              message: 'Combo items must include a variant for variable products. Please use the updated combo selector.',
            };
          }

          const validIds = existingChildren.map((p) => p.id);

          if (validIds.length === 0) {
            return {
              success: false,
              message:
                'No valid combo products found for the selected items. Please refresh and select again.',
            };
          }

          const missing = comboIds.filter((id) => !validIds.includes(id));
          if (missing.length > 0) {
            console.warn('[COMBO_DEBUG] Some combo product IDs do not exist:', {
              comboIds,
              validIds,
              missing,
            });
          }

          dataForPrisma.comboItems = {
            create: validIds.map((id) => ({
              child: { connect: { id } },
            })),
          };
        }
      }
    }

    newProduct = await prisma.product.create({
      data: {
        ...dataForPrisma,
        ProductLog: {
          create: {
            action: 'Product created',
            details: `Product "${name}" was created.`,
            user: actor,
          },
        },
      },
    });

    // Sync multi-category join table
    if (categoryIds.length > 0) {
      await prisma.productCategory.createMany({
        data: categoryIds.map(cid => ({ productId: newProduct.id, categoryId: cid })),
        skipDuplicates: true,
      });
    }

    // NOTE: Inventory bootstrap intentionally removed.

    // ------- images for create (File + library URL mixed) -------
    const imageFiles = formData.getAll('images') as (File | string)[];
    if (imageFiles && imageFiles.length > 0) {
      const filesToUpload = imageFiles.filter(
        (f) => f instanceof File,
      ) as File[];
      const libraryUrls = imageFiles.filter(
        (f) => typeof f === 'string',
      ) as string[];

      const uploadedImages = await uploadImages(filesToUpload);

      const finalImages: ProductImage[] = [
        ...libraryUrls.map((url) => ({
          url: normalizeUrl(url),
          id: url.split('/').pop() || url,
        })),
        ...uploadedImages.map((img) => ({ ...img, url: normalizeUrl(img.url) })),
      ];

      if (finalImages.length > 0) {
        await prisma.product.update({
          where: { id: newProduct.id },
          data: { image: JSON.stringify(finalImages) },
        });
      }
    }
  } catch (error: any) {
    console.error('Error in createProduct action:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error(`Prisma Error Code: ${error.code}`);
      if (error.code === 'P2025') {
        return {
          success: false,
          message:
            'Database error: P2025. One or more required records (like a category or combo product) could not be found.',
        };
      }
      if (error.code === 'P2002') {
        // unique constraint fallback (very rare with our ensureUnique* but just in case)
        return {
          success: false,
          message:
            'Database error: Unique constraint failed. Please try again.',
        };
      }
      return {
        success: false,
        message: `Database error: ${error.code}. Check your inputs.`,
      };
    }
    return {
      success: false,
      message:
        error.message || 'An unknown error occurred during product creation.',
    };
  }

  await revalidateTags(['products', 'shop-products']);
  return { success: true, redirect: `/dashboard/products/${newProduct.id}` };
}

/* -------------------------------------------------------
   Update (unchanged, image ordering etc.)
------------------------------------------------------- */

export async function updateProduct(
  productId: string,
  formData: FormData,
  actor: string = 'System',
): Promise<{ success: boolean; message?: string; redirect?: string }> {
  let productBeforeUpdate: Prisma.ProductGetPayload<{ include: { variants: true; comboItems: true } }> | null = null;
  let finalSlug: string | undefined;
  let incomingProductType: AppProductType | null = null;

  try {
    productBeforeUpdate = await prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true, comboItems: true },
    });
    if (!productBeforeUpdate) {
      return { success: false, message: 'Product not found.' };
    }

    const dataToUpdate: Prisma.ProductUpdateInput = {};
    const logEntries: Partial<ProductLog>[] = [];

    const fieldsToCompare: (keyof Product)[] = [
      'name',
      'description',
      'shortDescription',
      'price',
      'salePrice',
      'tags',
      'weight',
      'length',
      'width',
      'height',
      'ornaFabric',
      'jamaFabric',
      'selowarFabric',
      'isPublished',
      'wholesaleEnabled',
      'wholesaleVisible',
      'wholesalePrice',
      'wholesaleMinQuantity',
      'wholesalePackQuantity',
      'wholesaleUnitLabel',
      'wholesaleNote',
    ];

    const numericFields = [
      'price',
      'salePrice',
      'weight',
      'length',
      'width',
      'height',
      'ornaFabric',
      'jamaFabric',
      'selowarFabric',
      'wholesalePrice',
      'wholesaleMinQuantity',
      'wholesalePackQuantity',
    ] as const;

    // -------- basic updatable fields --------
    fieldsToCompare.forEach((field) => {
      const key = field as string;
      const formValue = formData.get(key);
      if (formValue !== null) {
        let newValue: string | number | null | undefined;

        if (numericFields.includes(key as any)) {
          newValue = formValue ? parseFloat(formValue as string) : undefined;
        } else {
          newValue = (formValue as string) || undefined;
        }

        const oldValue =
          productBeforeUpdate![field as keyof typeof productBeforeUpdate];

        if (String(newValue ?? '') !== String(oldValue ?? '')) {
          (dataToUpdate as any)[field] = newValue;
          logEntries.push({
            action: `${key.charAt(0).toUpperCase() + key.slice(1)} updated`,
            details: `From "${oldValue || 'N/A'}" to "${newValue || 'N/A'}"`,
            user: actor,
          });
        }
      }
    });

    // -------- slug --------
    const newSlug = formData.get('slug') as string | null;
    if (newSlug && newSlug !== productBeforeUpdate.slug) {
      // make unique on update as well
      dataToUpdate.slug = await ensureUniqueSlug(newSlug);
      logEntries.push({
        action: 'Slug updated',
        details: `From "${productBeforeUpdate.slug || 'N/A'}" to "${dataToUpdate.slug}"`,
        user: actor,
      });
    }
    finalSlug = (dataToUpdate.slug as string | undefined) || productBeforeUpdate.slug || undefined;

    // -------- SKU --------
    const newSkuRaw = formData.get('sku') as string | null;
    if (newSkuRaw && newSkuRaw !== productBeforeUpdate.sku) {
      dataToUpdate.sku = await ensureUniqueSku(newSkuRaw);
      logEntries.push({
        action: 'SKU updated',
        details: `From "${productBeforeUpdate.sku || 'N/A'}" to "${dataToUpdate.sku}"`,
        user: actor,
      });
    }

    // -------- Product Type (simple/variable/...) --------
    const formType = formData.get('productType') as AppProductType | null;
    const normalizedFormType = formType === 'three_piece' ? 'variable' : formType;
    const normalizedExistingType =
      productBeforeUpdate.productType === ProductTypeEnum.piece ? ProductTypeEnum.variable : productBeforeUpdate.productType;
    incomingProductType = normalizedFormType;
    if (
      normalizedFormType &&
      appTypeToPrismaType[normalizedFormType] &&
      appTypeToPrismaType[normalizedFormType] !== normalizedExistingType
    ) {
      return {
        success: false,
        message: 'Changing product type is not allowed. Please create a new product for a different type.',
      };
    }

    // -------- Boolean fixes & Wholesale Validation --------
    ['isPublished', 'wholesaleEnabled', 'wholesaleVisible'].forEach(key => {
      if (dataToUpdate[key as keyof Prisma.ProductUpdateInput] !== undefined) {
        dataToUpdate[key as keyof Prisma.ProductUpdateInput] =
          dataToUpdate[key as keyof Prisma.ProductUpdateInput] === 'true' ||
          dataToUpdate[key as keyof Prisma.ProductUpdateInput] === true;
      }
    });

    if (dataToUpdate.wholesaleEnabled === false ||
        (dataToUpdate.wholesaleEnabled === undefined && productBeforeUpdate.wholesaleEnabled === false)) {
      dataToUpdate.wholesaleVisible = false;
    }

    const finalWholesaleVisible = dataToUpdate.wholesaleVisible !== undefined ? dataToUpdate.wholesaleVisible : productBeforeUpdate.wholesaleVisible;
    const isVariableProductType = normalizedExistingType === ProductTypeEnum.variable;

    if (finalWholesaleVisible && !isVariableProductType) {
      const finalPrice = dataToUpdate.wholesalePrice !== undefined ? dataToUpdate.wholesalePrice : productBeforeUpdate.wholesalePrice;
      if (finalPrice === null || finalPrice === undefined || isNaN(Number(finalPrice)) || Number(finalPrice) <= 0) {
        return { success: false, message: 'Wholesale price must be greater than 0 when visible.' };
      }
    }
    const finalMinQty = dataToUpdate.wholesaleMinQuantity !== undefined ? dataToUpdate.wholesaleMinQuantity : productBeforeUpdate.wholesaleMinQuantity;
    if (finalMinQty !== null && finalMinQty !== undefined && (isNaN(Number(finalMinQty)) || Number(finalMinQty) <= 0)) {
        return { success: false, message: 'Minimum wholesale quantity must be a positive integer.' };
    }
    const finalPackQty = dataToUpdate.wholesalePackQuantity !== undefined ? dataToUpdate.wholesalePackQuantity : productBeforeUpdate.wholesalePackQuantity;
    if (finalPackQty !== null && finalPackQty !== undefined && (isNaN(Number(finalPackQty)) || Number(finalPackQty) <= 0)) {
        return { success: false, message: 'Wholesale pack quantity must be a positive integer.' };
    }

    // ========= IMAGE HANDLING (ordered) =========
    const imageFilesRaw = formData.getAll('images');
    const fileImages = imageFilesRaw.filter(
      (f) => typeof f === 'object' && f !== null,
    ) as File[];

    const uploadedImages: ProductImage[] =
      fileImages.length > 0 ? await uploadImages(fileImages) : [];

    const existingImagesFromFormRaw = formData.get('existingImages');
    const existingImagesFromForm: ProductImage[] = existingImagesFromFormRaw
      ? JSON.parse(existingImagesFromFormRaw as string)
      : [];

    const finalImages: ProductImage[] = [
      ...existingImagesFromForm.map((img) => ({ ...img, url: normalizeUrl(img.url) })),
      ...uploadedImages.map((img) => ({ ...img, url: normalizeUrl(img.url) })),
    ];

    const imagesTouched = existingImagesFromFormRaw !== null || imageFilesRaw.length > 0;

    if (imagesTouched) {
      dataToUpdate.image = JSON.stringify(finalImages);
      logEntries.push({
        action: 'Main image updated',
        details: `Product images updated. Total: ${finalImages.length}`,
        user: actor,
      });
    }

    // -------- category connect/disconnect --------
    // Parse multi-category IDs
    let categoryIds: string[] = [];
    const categoryIdsRaw = formData.get('categoryIds') as string | null;
    if (categoryIdsRaw) {
      try { categoryIds = JSON.parse(categoryIdsRaw); } catch { /* ignore */ }
    }
    // Fallback: if categoryIds empty but legacy categoryId present in form, sync from it
    const formCategoryId = formData.get('categoryId') as string | null;
    if (categoryIds.length === 0 && formCategoryId && formCategoryId !== 'none') {
      categoryIds = [formCategoryId];
    }

    // Primary category: preserve existing if still selected, else take first
    const primaryCategoryId = (() => {
      if (categoryIds.length === 0) return null;
      if (productBeforeUpdate.categoryId && categoryIds.includes(productBeforeUpdate.categoryId)) {
        return productBeforeUpdate.categoryId;
      }
      return categoryIds[0];
    })();

    const categoryUpdate: { connect?: { id: string }; disconnect?: boolean } = {};
    if (primaryCategoryId && primaryCategoryId !== productBeforeUpdate.categoryId) {
      categoryUpdate.connect = { id: primaryCategoryId };
      logEntries.push({ action: 'Category changed', user: actor });
    } else if (!primaryCategoryId && productBeforeUpdate.categoryId) {
      categoryUpdate.disconnect = true;
      logEntries.push({ action: 'Category removed', user: actor });
    }

    // -------- apply operations in transaction --------
    const operations: any[] = [];
    if (Object.keys(dataToUpdate).length > 0 || Object.keys(categoryUpdate).length > 0) {
      operations.push(
        prisma.product.update({
          where: { id: productId },
          data: {
            ...dataToUpdate,
            ...(Object.keys(categoryUpdate).length > 0 && { Category: categoryUpdate }),
          },
        }),
      );
    }

    // Sync multi-category join table
    if (categoryIdsRaw !== null || categoryIds.length > 0) {
      operations.push(
        prisma.productCategory.deleteMany({ where: { productId } }),
      );
      if (categoryIds.length > 0) {
        operations.push(
          prisma.productCategory.createMany({
            data: categoryIds.map(cid => ({ productId, categoryId: cid })),
            skipDuplicates: true,
          }),
        );
      }
    }

    if (logEntries.length > 0) {
      operations.push(
        prisma.productLog.createMany({
          data: logEntries.map((log) => ({ ...log, productId })) as any[],
        }),
      );
    }

    if (operations.length > 0) {
      await prisma.$transaction(operations);
    }

    // -------- delete orphan files --------
    const oldImagesRaw = productBeforeUpdate.image;
    const oldImages: ProductImage[] =
      oldImagesRaw && typeof oldImagesRaw === 'string' ? JSON.parse(oldImagesRaw) : [];

    const newImageIds = finalImages.map((img) => img.id);
    const imagesToDelete = oldImages.filter(
      (oldImg) => !newImageIds.includes(oldImg.id) && oldImg.url.startsWith('/uploads/'),
    );

    for (const image of imagesToDelete) {
      const otherProductsWithSameImage = await prisma.product.count({
        where: { id: { not: productId }, image: { contains: `"url":"${image.url}"` } },
      });

      if (otherProductsWithSameImage === 0) {
        try {
          const imagePath = join(process.cwd(), 'public', image.url);
          await unlink(imagePath);
          const imageDir = dirname(imagePath);
          const files = await readdir(imageDir);
          if (files.length === 0) await rmdir(imageDir);
        } catch (fileError: any) {
          if (fileError.code !== 'ENOENT') {
            console.warn(`Could not delete old image file ${image.url}:`, fileError);
          }
        }
      }
    }

    // -------- Attributes (rebuild) --------
    const attributesRaw = formData.get('attributes') as string | null;
    if (attributesRaw !== null) {
      let attributes: Array<{ name?: string; options?: string }> = [];
      try {
        attributes = attributesRaw.trim() ? JSON.parse(attributesRaw) : [];
      } catch (err) {
        console.warn('Invalid attributes JSON, clearing attributes.', err);
        attributes = [];
      }

      const normalizedExistingType =
        productBeforeUpdate.productType === ProductTypeEnum.piece
          ? ProductTypeEnum.variable
          : productBeforeUpdate.productType;
      const isVariableProduct = normalizedExistingType === appTypeToPrismaType['variable'];

      const attrMap = new Map<string, string[]>();
      for (const attr of attributes || []) {
        const name = String(attr?.name || '').trim();
        if (!name) continue;

        const lowerName = name.toLowerCase();
        const options = Array.from(
          new Set(
            String(attr?.options || '')
              .split(',')
              .map((o) => o.trim())
              .filter((o) => Boolean(o) && o.toLowerCase() !== lowerName),
          ),
        );

        if (options.length === 0) continue;
        attrMap.set(name, options);
      }

      if (isVariableProduct) {
        const ops: any[] = [
          prisma.attribute.deleteMany({ where: { productId } }),
        ];

        if (attrMap.size > 0) {
          ops.push(
            prisma.attribute.createMany({
              data: Array.from(attrMap.entries()).map(([name, options]) => ({
                productId,
                name,
                options,
              })),
            }),
          );
        }

        await prisma.$transaction(ops);
        logEntries.push({
          action: 'Attributes synced',
          details: `Total attributes: ${attrMap.size}`,
          user: actor,
        });
      }
    }

    // -------- Variant image uploads (per-variant) --------
    const variantImageEntries = Array.from(formData.entries()).filter(
      ([key, value]) => key.startsWith('variantImage:') && value instanceof File,
    ) as [string, File][];

    const uploadedVariantImageMap = new Map<string, string>();

    if (variantImageEntries.length > 0) {
      for (const [key, file] of variantImageEntries) {
        try {
          const variationId = key.split(':')[1];
          const uploaded = await uploadImages([file]);
          const url = normalizeUrl(uploaded[0]?.url);
          if (variationId && url) {
            uploadedVariantImageMap.set(variationId, url);
          }
        } catch (err) {
          console.warn('[VARIANT_IMAGE_UPLOAD_FAILED]', key, err);
        }
      }
    }

    // -------- Variations (rebuild) --------
    // Prefer single JSON blob sent via formData.set('variations', JSON.stringify(...))
    // Avoid getAll noise because some browsers may append intermediate values.
    const variationsRaw = formData.get('variations') as string | null;
    const clearVariantsFlag = (formData.get('clearVariants') as string | null) === 'true';
    if (variationsRaw !== null) {
      let variations: any[] = [];
      try {
        // Treat empty string as empty array, and if parse fails, default to []
        const candidate = variationsRaw.trim();
        variations = candidate ? JSON.parse(candidate) : [];
      } catch (err) {
        console.warn('Invalid variations JSON, clearing variants.', err);
        variations = [];
      }
      if (Array.isArray(variations)) {
        const normalizedExistingType =
          productBeforeUpdate.productType === ProductTypeEnum.piece
            ? ProductTypeEnum.variable
            : productBeforeUpdate.productType;
        const isVariableProduct = normalizedExistingType === appTypeToPrismaType['variable'];

        // Prevent variations on non-variable products
        if (variations.length > 0 && !isVariableProduct) {
          return {
            success: false,
            message: 'This product is not variable. Create a new variable product to add variations.',
          };
        }

        const toCreate: any[] = [];
        let index = 0;
        for (const variant of variations) {
          const variantId = variant.id && typeof variant.id === 'string' && !variant.id.startsWith('var_') ? variant.id : undefined;
          const existingVariant = variantId ? productBeforeUpdate.variants.find((v: any) => v.id === variantId) : null;
          const baseSku =
            variant.sku && variant.sku.trim()
              ? normalizeSku(variant.sku)
              : existingVariant?.sku
                ? existingVariant.sku
              : dataToUpdate.sku
                ? `${dataToUpdate.sku}-${attrSlug(variant.attributes || {}) || ++index}`
                : `${productBeforeUpdate.sku}-${attrSlug(variant.attributes || {}) || ++index}`;
          const vSku = await ensureUniqueVariantSku(baseSku);

          toCreate.push({
            name: variant.name || productBeforeUpdate.name,
            sku: vSku,
            price: variant.price ? parseFloat(variant.price) : null,
            salePrice: variant.salePrice ? parseFloat(variant.salePrice) : null,
            attributes: variant.attributes || {},
          });
        }

        // Smart Sync: Update existing, Create new, Delete missing
        // This preserves Variant IDs, which ensures InventoryItems (linked by FK) are NOT deleted.

        const incomingIds = new Set<string>();
        const ops: any[] = [];

        // 1. Upsert (Update or Create)
        for (const variant of variations) {
          // If variant has an ID that exists in current product, we update it.
          // Otherwise strict Unique SKU check might fail if we don't exclude current ID.
          // For simplicity, we trust the ID if provided and valid.

          const variantId = variant.id && typeof variant.id === 'string' && !variant.id.startsWith('var_')
            ? variant.id
            : undefined; // 'var_' prefix is temp ID from frontend

          const existingVariant = variantId
            ? productBeforeUpdate.variants.find((v: any) => v.id === variantId)
            : null;

          const baseSku =
            variant.sku && variant.sku.trim()
              ? normalizeSku(variant.sku)
              : existingVariant?.sku
                ? existingVariant.sku
                : dataToUpdate.sku
                  ? `${dataToUpdate.sku}-${attrSlug(variant.attributes || {}) || ++index}`
                  : `${productBeforeUpdate.sku}-${attrSlug(variant.attributes || {}) || ++index}`;

          const uploadedVariantUrl = variant?.id ? uploadedVariantImageMap.get(String(variant.id)) : undefined;
          const imageValue = uploadedVariantUrl
            ?? (typeof variant.image === 'string' && !variant.image.startsWith('__file__:') ? variant.image : null);

          const vWholesalePrice = variant.wholesalePrice ? parseFloat(String(variant.wholesalePrice)) : null;
          const vWholesaleMin = variant.wholesaleMinQuantity ? parseInt(String(variant.wholesaleMinQuantity), 10) : null;
          const vWholesalePack = variant.wholesalePackQuantity ? parseInt(String(variant.wholesalePackQuantity), 10) : null;

          if (vWholesaleMin !== null && (isNaN(vWholesaleMin) || vWholesaleMin <= 0)) {
              return { success: false, message: 'Variant minimum wholesale quantity must be a positive integer.' };
          }
          if (vWholesalePack !== null && (isNaN(vWholesalePack) || vWholesalePack <= 0)) {
              return { success: false, message: 'Variant wholesale pack quantity must be a positive integer.' };
          }

          if (finalWholesaleVisible && (vWholesalePrice === null || isNaN(vWholesalePrice) || vWholesalePrice <= 0)) {
            const parentPrice = dataToUpdate.wholesalePrice !== undefined ? dataToUpdate.wholesalePrice : productBeforeUpdate.wholesalePrice;
             if (parentPrice === null || parentPrice === undefined || isNaN(Number(parentPrice)) || Number(parentPrice) <= 0) {
                return { success: false, message: 'When wholesale is visible, variable products must have a valid wholesale price on the parent or every variant.' };
             }
          }

          if (variantId) {
            incomingIds.add(variantId);
            ops.push(prisma.productVariant.update({
              where: { id: variantId },
              data: {
                name: variant.name || productBeforeUpdate.name,
                sku: baseSku, // We trust user or auto-gen. Ideally check uniqueness if changed.
                price: variant.price ? parseFloat(String(variant.price)) : null,
                salePrice: variant.salePrice ? parseFloat(String(variant.salePrice)) : null,
                image: imageValue,
                attributes: variant.attributes || {},
                wholesalePrice: vWholesalePrice,
                wholesaleMinQuantity: vWholesaleMin,
                wholesalePackQuantity: vWholesalePack,
              }
            }));
          } else {
            // New variant
            const vSku = await ensureUniqueVariantSku(baseSku);
            ops.push(prisma.productVariant.create({
              data: {
                productId,
                name: variant.name || productBeforeUpdate.name,
                sku: vSku,
                price: variant.price ? parseFloat(String(variant.price)) : null,
                salePrice: variant.salePrice ? parseFloat(String(variant.salePrice)) : null,
                image: imageValue,
                attributes: variant.attributes || {},
                wholesalePrice: vWholesalePrice,
                wholesaleMinQuantity: vWholesaleMin,
                wholesalePackQuantity: vWholesalePack,
              }
            }));
          }
        }

        // 2. Identify missing variants (to be deleted)
        // Only delete variants that were NOT in the incoming list
        const existingVariantIds = productBeforeUpdate.variants.map(v => v.id);
        const toDeleteIds = existingVariantIds.filter(id => !incomingIds.has(id));

        if (toDeleteIds.length > 0) {
          ops.push(prisma.productVariant.deleteMany({
            where: { id: { in: toDeleteIds }, productId }
          }));
        }

        if (ops.length > 0) {
          await prisma.$transaction(ops);
          logEntries.push({ action: 'Variants synced', details: `Updated/Created: ${variations.length}, Deleted: ${toDeleteIds.length}`, user: actor });
        }

        // Removed the "else if (variations.length === 0 && clearVariantsFlag)" block 
        // because the above logic naturally handles it (incomingIds empty -> delete all).
        // But to be extra safe with "clearVariantsFlag" explicit intent:
        if (variations.length === 0 && clearVariantsFlag) {
          // If explicit clear requested and empty list provided, ensure everything is gone.
          // The above logic does this via `toDeleteIds`, but we can leave this check purely for logging if needed.
          // Actually, the above logic covers it perfectly.
        }
      }
    }

    // -------- Combo items handling --------
    const comboItemsRaw = formData.get('comboItems');
    const comboIdsRaw = formData.getAll('comboProductIds');
    const comboIds = comboIdsRaw.map((id) => String(id)).filter(Boolean);

    if (incomingProductType === 'combo') {
      // ensure productType combo
      (dataToUpdate as any).productType = appTypeToPrismaType['combo'];
      // drop variants for combo
      await prisma.productVariant.deleteMany({ where: { productId } });

      if (comboItemsRaw) {
        // New format: comboItems JSON with variant support
        try {
          const comboItems = JSON.parse(comboItemsRaw as string) as Array<{
            childId: string;
            variantId?: string | null;
          }>;

          // Validate child products exist and check productType
          const childIds = comboItems.map(item => item.childId);
          const existingChildren = await prisma.product.findMany({
            where: { id: { in: childIds } },
            select: { id: true, productType: true },
          });
          const childMap = new Map(existingChildren.map(p => [p.id, p.productType]));

          // Validate variable children have variantId
          for (const item of comboItems) {
            const childType = childMap.get(item.childId);
            if (!childType) continue;
            if ((childType === ProductTypeEnum.variable || childType === ProductTypeEnum.piece) && !item.variantId) {
              return {
                success: false,
                message: 'Combo items must include a variant for variable products.',
              };
            }
          }

          const validItems = comboItems.filter(item => childMap.has(item.childId));

          // Validate variantIds belong to their respective child products
          const variantIds = validItems.map(i => i.variantId).filter(Boolean) as string[];
          if (variantIds.length > 0) {
            const variants = await prisma.productVariant.findMany({
              where: { id: { in: variantIds } },
              select: { id: true, productId: true },
            });
            const variantToProduct = new Map(variants.map(v => [v.id, v.productId]));
            for (const item of validItems) {
              if (item.variantId && variantToProduct.get(item.variantId) !== item.childId) {
                return {
                  success: false,
                  message: `Variant ${item.variantId} does not belong to product ${item.childId}.`,
                };
              }
            }
          }

          await prisma.$transaction([
            prisma.comboProductItem.deleteMany({ where: { parentId: productId } }),
            ...(validItems.length > 0 ? [
              prisma.comboProductItem.createMany({
                data: validItems.map(item => ({
                  parentId: productId,
                  childId: item.childId,
                  variantId: item.variantId || null,
                })),
              }),
            ] : []),
          ]);
          logEntries.push({ action: 'Combo items updated', details: `Total combo items: ${validItems.length} (variant-aware)`, user: actor });
        } catch (error) {
          console.error('[COMBO_PARSE_ERROR:update]', error);
          return { success: false, message: 'Invalid combo items format.' };
        }
      } else if (comboIds.length > 0) {
        // Legacy format fallback: reject if any child is variable
        const children = await prisma.product.findMany({
          where: { id: { in: comboIds } },
          select: { id: true, productType: true },
        });
        const hasVariableChild = children.some(c => c.productType === ProductTypeEnum.variable || c.productType === ProductTypeEnum.piece);
        if (hasVariableChild) {
          return {
            success: false,
            message: 'Combo items must include a variant for variable products. Please use the updated combo selector.',
          };
        }

        await prisma.$transaction([
          prisma.comboProductItem.deleteMany({ where: { parentId: productId } }),
          prisma.comboProductItem.createMany({
            data: comboIds.map((childId) => ({ parentId: productId, childId })),
          }),
        ]);
        logEntries.push({ action: 'Combo items updated', details: `Total combo items: ${comboIds.length}`, user: actor });
      } else {
        // No combo data sent, clear existing
        await prisma.comboProductItem.deleteMany({ where: { parentId: productId } });
      }
    } else if (comboIds.length > 0) {
      // If combo ids sent but type not combo, clear them to avoid stale links
      await prisma.comboProductItem.deleteMany({ where: { parentId: productId } });
    }

    // -------- Simple handling --------
    if (incomingProductType === 'simple') {
      (dataToUpdate as any).productType = appTypeToPrismaType['simple'];
      // remove combo links, remove variants
      await prisma.$transaction([
        prisma.comboProductItem.deleteMany({ where: { parentId: productId } }),
        prisma.productVariant.deleteMany({ where: { productId } }),
      ]);
      logEntries.push({ action: 'Variants removed', details: 'Switched to simple product', user: actor });
    }
  } catch (error: any) {
    console.error('Error in updateProduct action:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return { success: false, message: 'A required record (e.g. category or combo product) could not be found. Please check your selection.' };
      }
      if (error.code === 'P2002') {
        return { success: false, message: 'A unique constraint was violated (e.g. duplicate SKU). Please check your inputs.' };
      }
      return { success: false, message: `Database error (${error.code}). Please check your inputs and try again.` };
    }
    if (error instanceof Prisma.PrismaClientValidationError) {
      return { success: false, message: 'Validation error — please check all fields and try again.' };
    }
    return { success: false, message: error.message || 'An unknown error occurred during product update.' };
  }

  await revalidateTags(['products', `products:${productId}`, 'shop-products']);
  if (productBeforeUpdate?.slug) await revalidateTags([`products/slug:${productBeforeUpdate.slug}`]);
  if (finalSlug) await revalidateTags([`products/slug:${finalSlug}`]);

  return { success: true, redirect: `/dashboard/products/${productId}` };
}

export async function setProductPublished(productId: string, isPublished: boolean) {
  try {
    await prisma.product.update({ where: { id: productId }, data: { isPublished } });
    await revalidateTags(['products', 'shop-products', `products:${productId}`]);

    // In publish mode, trigger stock sync when isPublished changes
    const settings = await getGeneralSettings();
    if (settings.stockSyncMode === 'publish') {
      // Trigger stock sync for the product (and all its variants)
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { variants: true },
      });
      if (product) {
        console.log(`[STOCK_SYNC_PUBLISH] Product ${productId} isPublished=${isPublished}, triggering sync`);
        // Sync main product
        await triggerStockStatusSync(productId, null, true);
        // Sync all variants
        for (const variant of product.variants) {
          await triggerStockStatusSync(productId, variant.id, true);
        }
      }
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, message: error?.message || 'Failed to update publish status' };
  }
}

export async function getShopProducts(): Promise<Product[]> {
  try {
    const url = `${getBaseUrl()}/api/shop/products`;
    const res = await fetch(url, { cache: 'force-cache', next: { tags: ['shop-products'] } });
    const data = await handleApiResponse<Product[]>(res);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[SERVICE_ERROR:getShopProducts]', error);
    return [];
  }
}

export async function getShopCategories(): Promise<Category[]> {
  try {
    const url = `${getBaseUrl()}/api/shop/categories`;
    const res = await fetch(url, { cache: 'force-cache', next: { tags: ['categories'] } });
    const data = await handleApiResponse<Category[]>(res);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('[SERVICE_ERROR:getShopCategories]', error);
    return [];
  }
}

/* -------------------------------------------------------
   Delete
------------------------------------------------------- */

export async function deleteProduct(
  productId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const orderItems = await prisma.orderProduct.count({ where: { productId } });
    if (orderItems > 0) {
      throw new Error('This product cannot be deleted because it is part of one or more existing orders.');
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, image: true },
    });
    if (!product) throw new Error('Product not found.');

    await prisma.$transaction([
      prisma.attribute.deleteMany({ where: { productId } }),
      prisma.productVariant.deleteMany({ where: { productId } }),
      prisma.productLog.deleteMany({ where: { productId } }),
      prisma.product.delete({ where: { id: productId } }),
    ]);

    if (product.image && typeof product.image === 'string') {
      const images = JSON.parse(product.image) as { url: string; id: string }[];
      for (const image of images) {
        const otherProductsWithSameImage = await prisma.product.count({
          where: { id: { not: productId }, image: { contains: `"url":"${image.url}"` } },
        });

        if (otherProductsWithSameImage === 0 && image.url.startsWith('/uploads/')) {
          try {
            const imagePath = join(process.cwd(), 'public', image.url);
            await unlink(imagePath);
            const imageDir = dirname(imagePath);
            const files = await readdir(imageDir);
            if (files.length === 0) await rmdir(imageDir);
          } catch (fileError: any) {
            if (fileError.code !== 'ENOENT') {
              console.warn(
                `Could not delete image file for product ${productId}:`,
                fileError.message,
              );
            }
          }
        }
      }
    }

    await revalidateTags(['products']);
    return { success: true };
  } catch (error: any) {
    console.error('Prisma Error in deleteProduct:', error);
    return { success: false, message: error.message };
  }
}


