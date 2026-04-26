import prisma from '@/lib/prisma';
import { getRedisClient } from '@/server/queues/redis';

export type SkuMatch = { productId: string; variantId?: string };

type SkuCache = {
  expires: number;
  map: Map<string, SkuMatch>;
  products: Array<{ id: string; sku: string | null }>;
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const REDIS_CACHE_KEY = 'woo:sku-map:v1';
const REDIS_CACHE_TTL_SEC = Math.floor(CACHE_TTL_MS / 1000);
let skuCache: SkuCache | null = null;

async function getSkuCache(): Promise<SkuCache> {
  if (skuCache && skuCache.expires > Date.now()) {
    return skuCache;
  }

  const redis = getRedisClient();
  if (redis) {
    try {
      const cached = await redis.get(REDIS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as { map?: Array<[string, SkuMatch]>; products?: Array<{ id: string; sku: string | null }> };
        const map = new Map<string, SkuMatch>(Array.isArray(parsed?.map) ? parsed.map : []);
        const products = Array.isArray(parsed?.products) ? parsed.products : [];
        skuCache = {
          expires: Date.now() + CACHE_TTL_MS,
          map,
          products,
        };
        return skuCache;
      }
    } catch (err) {
      console.warn('[WOO_SKU_CACHE_REDIS_READ_FAIL]', err);
    }
  }

  const [variants, products] = await Promise.all([
    prisma.productVariant.findMany({ select: { sku: true, productId: true, id: true } }),
    prisma.product.findMany({ select: { sku: true, id: true } }),
  ]);

  const map = new Map<string, SkuMatch>();

  variants.forEach((v) => {
    const key = v.sku?.trim().toLowerCase();
    if (!key) return;
    map.set(key, { productId: v.productId, variantId: v.id });
  });

  products.forEach((p) => {
    const key = p.sku?.trim().toLowerCase();
    if (!key) return;
    if (!map.has(key)) map.set(key, { productId: p.id });
  });

  skuCache = {
    expires: Date.now() + CACHE_TTL_MS,
    map,
    products: products.map((p) => ({ id: p.id, sku: p.sku ?? null })),
  };

  if (redis) {
    try {
      await redis.set(
        REDIS_CACHE_KEY,
        JSON.stringify({
          map: Array.from(map.entries()),
          products: products.map((p) => ({ id: p.id, sku: p.sku ?? null })),
        }),
        'EX',
        REDIS_CACHE_TTL_SEC,
      );
    } catch (err) {
      console.warn('[WOO_SKU_CACHE_REDIS_WRITE_FAIL]', err);
    }
  }

  return skuCache;
}

export async function resolveSkuMap(skus: string[]): Promise<Map<string, SkuMatch>> {
  if (!skus.length) return new Map<string, SkuMatch>();

  const uniqueSkus = Array.from(
    new Set(skus.map((s) => s.trim()).filter(Boolean)),
  );
  if (!uniqueSkus.length) return new Map<string, SkuMatch>();

  const { map: baseMap, products } = await getSkuCache();
  const result = new Map<string, SkuMatch>();

  uniqueSkus.forEach((raw) => {
    const key = raw.toLowerCase();
    const match = baseMap.get(key);
    if (match) result.set(key, match);
  });

  const missing = uniqueSkus.filter((raw) => !result.has(raw.toLowerCase()));
  if (missing.length && products.length) {
    missing.forEach((raw) => {
      const key = raw.toLowerCase();
      const candidates = products.filter((p) => {
        const sku = p.sku?.trim().toLowerCase();
        if (!sku) return false;
        return key.startsWith(`${sku}-`) || key.startsWith(`${sku}_`);
      });
      if (candidates.length === 1 && candidates[0].id) {
        result.set(key, { productId: candidates[0].id });
      }
    });
  }

  return result;
}
