'use server';

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import { pushWooStatusUpdate } from './integrations';
import { notifyAdmins } from './notifications';
import { getRedisClient } from '@/server/queues/redis';
import { getLoadShedFlags } from '@/server/utils/load-shed';
import { getGeneralSettings } from '@/server/utils/app-settings';

async function getStockSyncMode(): Promise<'inventory' | 'publish'> {
  const settings = await getGeneralSettings();
  return settings.stockSyncMode === 'publish' ? 'publish' : 'inventory';
}

type StockStatus = 'instock' | 'outofstock';

type WooTarget = { productId: number; variationId?: number };
type FetchWooTargetsOptions = { forceRefresh?: boolean };

// Simple in-memory caches (per runtime) to keep Woo lookups light
const skuMapCache: Map<string, { expires: number; targets: WooTarget[] }> = new Map(); // key: integrationId|skuLower
const productTypeCache: Map<string, { expires: number; productType: string | null }> = new Map(); // key: skuLower
const integrationRate: Map<string, number> = new Map(); // last push timestamp per integration
const integrationQueue: Map<string, Promise<void>> = new Map();

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const RATE_GAP_MS = 400;
const PUSH_COOLDOWN_MS = 2 * 60 * 1000; // per sku/integration
const pushCooldown: Map<string, number> = new Map(); // key integrationId|sku|status
const CACHE_PRUNE_INTERVAL_MS = 10 * 60 * 1000;
let lastCachePruneAt = 0;
const AUDIT_CONCURRENCY = 6;
const BULK_SYNC_CONCURRENCY = 8;
const SKU_MAPPING_TTL_MS = 24 * 60 * 60 * 1000;
const STOCK_AUDIT_SETTING_KEY = 'stock_audit';
const STOCK_AUDIT_INTERVAL_MS = 12 * 60 * 60 * 1000;
let fallbackAuditInFlight: Promise<void> | null = null;
const REDIS_PREFIX = 'stock-sync';
const LOCK_TTL_MS = 60 * 1000;
const LOW_STOCK_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const LOW_STOCK_THRESHOLD_TTL_MS = 5 * 60 * 1000;
const lowStockAlertCache: Map<string, number> = new Map();
let lowStockThresholdCache = { value: 5, expires: 0 };

const WOO_PUSH_CB_FAIL_WINDOW_MS = 5 * 60 * 1000;
const WOO_PUSH_CB_FAIL_THRESHOLD = 3;
const WOO_PUSH_CB_OPEN_MS = 10 * 60 * 1000;
const WOO_PUSH_CB_PREFIX = 'woo-push-cb';

const wooPushCbMap: Map<string, { firstFail: number; count: number }> = new Map();
const wooPushCbOpenMap: Map<string, number> = new Map();

const buildRedisKey = (...parts: string[]) => `${REDIS_PREFIX}:${parts.join(':')}`;

async function isWooPushCircuitOpen(integrationId: string) {
  const redis = getRedisClient();
  if (redis) {
    const key = buildRedisKey(WOO_PUSH_CB_PREFIX, 'open', integrationId);
    return Boolean(await redis.exists(key));
  }
  const openedAt = wooPushCbOpenMap.get(integrationId);
  if (openedAt && Date.now() - openedAt < WOO_PUSH_CB_OPEN_MS) return true;
  if (openedAt) wooPushCbOpenMap.delete(integrationId);
  return false;
}

async function recordWooPushFailure(integrationId: string) {
  const redis = getRedisClient();
  if (redis) {
    const failKey = buildRedisKey(WOO_PUSH_CB_PREFIX, 'fails', integrationId);
    const count = await redis.incr(failKey);
    if (count === 1) await redis.pexpire(failKey, WOO_PUSH_CB_FAIL_WINDOW_MS);

    if (count >= WOO_PUSH_CB_FAIL_THRESHOLD) {
      const openKey = buildRedisKey(WOO_PUSH_CB_PREFIX, 'open', integrationId);
      await redis.set(openKey, '1', 'PX', WOO_PUSH_CB_OPEN_MS);
      console.error(`[WOO_PUSH_CIRCUIT_OPENED] integration ${integrationId} due to ${count} failures`);
    }
  } else {
    const stats = wooPushCbMap.get(integrationId) || { firstFail: Date.now(), count: 0 };
    if (Date.now() - stats.firstFail > WOO_PUSH_CB_FAIL_WINDOW_MS) {
      stats.firstFail = Date.now();
      stats.count = 1;
    } else {
      stats.count++;
    }
    wooPushCbMap.set(integrationId, stats);
    if (stats.count >= WOO_PUSH_CB_FAIL_THRESHOLD) {
      wooPushCbOpenMap.set(integrationId, Date.now());
      console.error(`[WOO_PUSH_CIRCUIT_OPENED] integration ${integrationId} due to ${stats.count} failures (in-memory)`);
    }
  }
}

async function recordWooPushSuccess(integrationId: string) {
  const redis = getRedisClient();
  if (redis) {
    await redis.del(buildRedisKey(WOO_PUSH_CB_PREFIX, 'fails', integrationId));
    await redis.del(buildRedisKey(WOO_PUSH_CB_PREFIX, 'open', integrationId));
  } else {
    wooPushCbMap.delete(integrationId);
    wooPushCbOpenMap.delete(integrationId);
  }
}

type StockAuditSetting = {
  lastRun?: string;
};

const parseStockAuditLastRun = (value: unknown): Date | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as StockAuditSetting).lastRun;
  if (typeof raw !== 'string' || !raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getStockAuditLastRun = async (): Promise<Date | null> => {
  try {
    const record = await prisma.appSetting.findUnique({ where: { key: STOCK_AUDIT_SETTING_KEY } });
    return parseStockAuditLastRun(record?.value);
  } catch (err) {
    console.warn('[STOCK_AUDIT_LAST_RUN_READ_FAIL]', err);
    return null;
  }
};

const setStockAuditLastRun = async (date: Date) => {
  const value: StockAuditSetting = { lastRun: date.toISOString() };
  try {
    await prisma.appSetting.upsert({
      where: { key: STOCK_AUDIT_SETTING_KEY },
      update: { value },
      create: { key: STOCK_AUDIT_SETTING_KEY, value, updatedAt: new Date() },
    });
  } catch (err) {
    console.warn('[STOCK_AUDIT_LAST_RUN_WRITE_FAIL]', err);
  }
};

async function delay(ms: number) {
  if (ms <= 0) return;
  await new Promise(res => setTimeout(res, ms));
}

async function withIntegrationLock<T>(integrationId: string, task: () => Promise<T>): Promise<T> {
  const redis = getRedisClient();
  if (!redis) return task();

  const lockKey = buildRedisKey('lock', integrationId);
  const token = crypto.randomUUID();

  while (true) {
    const acquired = await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
    if (acquired) break;
    await delay(120);
  }

  try {
    return await task();
  } finally {
    try {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        token,
      );
    } catch (err) {
      console.warn('[STOCK_SYNC_LOCK_RELEASE_FAIL]', err);
    }
  }
}

async function getLowStockThreshold() {
  if (lowStockThresholdCache.expires > Date.now()) {
    return lowStockThresholdCache.value;
  }
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: 'lowStockThreshold' } });
    const threshold = Number((setting?.value as any)?.threshold ?? 5);
    lowStockThresholdCache = {
      value: Number.isFinite(threshold) ? threshold : 5,
      expires: Date.now() + LOW_STOCK_THRESHOLD_TTL_MS,
    };
    return lowStockThresholdCache.value;
  } catch (err) {
    console.warn('[LOW_STOCK_THRESHOLD_READ_FAIL]', err);
    return lowStockThresholdCache.value;
  }
}

async function shouldNotifyLowStock(skuLower: string) {
  if (!skuLower) return false;
  const redis = getRedisClient();
  if (redis) {
    const key = buildRedisKey('low-stock', skuLower);
    const result = await redis.set(key, '1', 'PX', LOW_STOCK_COOLDOWN_MS, 'NX');
    return Boolean(result);
  }
  const last = lowStockAlertCache.get(skuLower) || 0;
  if (Date.now() - last < LOW_STOCK_COOLDOWN_MS) return false;
  lowStockAlertCache.set(skuLower, Date.now());
  return true;
}

async function isCooldownActive(key: string) {
  const redis = getRedisClient();
  if (redis) {
    const exists = await redis.exists(buildRedisKey('cooldown', key));
    return exists === 1;
  }
  const last = pushCooldown.get(key) || 0;
  return Date.now() - last < PUSH_COOLDOWN_MS;
}

async function markCooldown(key: string) {
  const redis = getRedisClient();
  if (redis) {
    await redis.set(buildRedisKey('cooldown', key), '1', 'PX', PUSH_COOLDOWN_MS);
    return;
  }
  pushCooldown.set(key, Date.now());
}
async function rateLimit(integrationId: string) {
  const now = Date.now();
  const redis = getRedisClient();
  if (redis) {
    const key = buildRedisKey('rate', integrationId);
    const lastRaw = await redis.get(key);
    const last = lastRaw ? Number(lastRaw) : 0;
    const wait = RATE_GAP_MS - (now - last);
    if (wait > 0) await delay(wait);
    await redis.set(key, String(Date.now()), 'PX', RATE_GAP_MS * 4);
    return;
  }

  const last = integrationRate.get(integrationId) || 0;
  const wait = RATE_GAP_MS - (now - last);
  if (wait > 0) await delay(wait);
  integrationRate.set(integrationId, Date.now());
}

function pruneCaches() {
  const now = Date.now();
  if (now - lastCachePruneAt < CACHE_PRUNE_INTERVAL_MS) return;
  lastCachePruneAt = now;

  for (const [key, entry] of skuMapCache.entries()) {
    if (entry.expires <= now) skuMapCache.delete(key);
  }
  for (const [key, entry] of productTypeCache.entries()) {
    if (entry.expires <= now) productTypeCache.delete(key);
  }
  for (const [key, ts] of pushCooldown.entries()) {
    if (now - ts > PUSH_COOLDOWN_MS) pushCooldown.delete(key);
  }
  for (const [key, ts] of lowStockAlertCache.entries()) {
    if (now - ts > LOW_STOCK_COOLDOWN_MS) lowStockAlertCache.delete(key);
  }
}

const normalizeWooTargets = (targets: unknown): WooTarget[] => {
  if (!Array.isArray(targets)) return [];
  const dedup = new Map<string, WooTarget>();
  for (const t of targets) {
    if (!t || typeof t !== 'object') continue;
    const productId = Number((t as any).productId);
    const variationRaw = (t as any).variationId;
    const variationId = variationRaw === null || typeof variationRaw === 'undefined'
      ? undefined
      : Number(variationRaw);
    if (!Number.isFinite(productId)) continue;
    const safeVariation = Number.isFinite(variationId) ? variationId : undefined;
    const key = `${productId}|${safeVariation ?? 'none'}`;
    dedup.set(key, { productId, variationId: safeVariation });
  }
  return Array.from(dedup.values());
};

const serializeWooTargets = (targets: WooTarget[]) =>
  targets.map((t) => ({
    productId: t.productId,
    variationId: typeof t.variationId === 'number' ? t.variationId : null,
  }));

async function readSkuMapCache(cacheKey: string): Promise<WooTarget[] | null> {
  pruneCaches();
  const cached = skuMapCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.targets;

  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(buildRedisKey('sku-map', cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const normalized = normalizeWooTargets(parsed);
    await writeSkuMapCache(cacheKey, normalized);
    return normalized;
  } catch (err) {
    console.warn('[WOO_SKU_CACHE_REDIS_READ_FAIL]', err);
    return null;
  }
}

async function writeSkuMapCache(cacheKey: string, targets: WooTarget[], ttl: number = CACHE_TTL_MS) {
  skuMapCache.set(cacheKey, { expires: Date.now() + ttl, targets });
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(
      buildRedisKey('sku-map', cacheKey),
      JSON.stringify(targets),
      'PX',
      ttl,
    );
  } catch (err) {
    console.warn('[WOO_SKU_CACHE_REDIS_WRITE_FAIL]', err);
  }
}

const isMappingFresh = (lastVerifiedAt?: Date | null) => {
  if (!lastVerifiedAt) return false;
  return Date.now() - lastVerifiedAt.getTime() <= SKU_MAPPING_TTL_MS;
};

function enqueueIntegrationTask<T>(integrationId: string, task: () => Promise<T>): Promise<T> {
  const previous = integrationQueue.get(integrationId) || Promise.resolve();
  let resolveTask: (value: T) => void = () => undefined;
  let rejectTask: (reason?: any) => void = () => undefined;
  const taskPromise = new Promise<T>((resolve, reject) => {
    resolveTask = resolve;
    rejectTask = reject;
  });

  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        const result = await withIntegrationLock(integrationId, task);
        resolveTask(result);
      } catch (err) {
        rejectTask(err);
      }
    });

  integrationQueue.set(integrationId, next.then(() => undefined, () => undefined));
  return taskPromise;
}

async function runTasksInBatches(
  tasks: Array<() => Promise<void>>,
  batchSize: number,
) {
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize).map((task) => task());
    await Promise.all(batch);
  }
}

async function getProductTypeBySku(sku: string): Promise<string | null> {
  const skuLower = sku.trim().toLowerCase();
  if (!skuLower) return null;
  pruneCaches();
  const cached = productTypeCache.get(skuLower);
  if (cached && cached.expires > Date.now()) return cached.productType;

  const redis = getRedisClient();
  if (redis) {
    const redisKey = buildRedisKey('product-type', skuLower);
    const cachedValue = await redis.get(redisKey);
    if (cachedValue !== null) {
      const parsed = cachedValue === '__null__' ? null : cachedValue;
      productTypeCache.set(skuLower, { expires: Date.now() + CACHE_TTL_MS, productType: parsed });
      return parsed;
    }
  }

  const product = await prisma.product.findUnique({
    where: { sku: sku.trim() },
    select: { productType: true },
  });
  const productType = product?.productType ?? null;
  productTypeCache.set(skuLower, { expires: Date.now() + CACHE_TTL_MS, productType });
  if (redis) {
    const redisKey = buildRedisKey('product-type', skuLower);
    await redis.set(redisKey, productType ?? '__null__', 'PX', CACHE_TTL_MS);
  }
  return productType;
}

type SkuLookupResult = {
  targets: WooTarget[];
  status: 'found' | 'confirmedMissing' | 'lookupFailed';
};

async function performWooSkuLookup(integration: any, sku: string): Promise<SkuLookupResult> {
  const skuLower = sku.trim().toLowerCase();
  const auth = Buffer.from(`${integration.consumerKey}:${integration.consumerSecret}`).toString('base64');
  const baseUrl = integration.storeUrl.replace(/\/$/, '');

  const targets: WooTarget[] = [];
  let hadFailure = false;

  // Strategy: 1. Try direct SKU filter first (Fastest)
  const productUrl = new URL('/wp-json/wc/v3/products', baseUrl);
  productUrl.searchParams.set('sku', skuLower);
  productUrl.searchParams.set('per_page', '10');

  try {
    console.log(`[WOO_LOOKUP_START] Searching SKU: ${skuLower} via filter`);
    let res = await fetch(productUrl.toString(), {
      headers: { 'Authorization': `Basic ${auth}` }
    });

    let prods = [];
    if (res.ok) {
      prods = await res.json();
    } else {
      hadFailure = true;
      console.error(`[WOO_LOOKUP_FAIL] Direct SKU filter failed for ${skuLower}: ${res.status}`);
    }

    // Step 2. Fallback to broad search if no products found by direct SKU filter and no failure occurred
    if (prods.length === 0 && !hadFailure) {
      const searchUrl = new URL('/wp-json/wc/v3/products', baseUrl);
      searchUrl.searchParams.set('search', skuLower);
      searchUrl.searchParams.set('per_page', '10');
      console.log(`[WOO_LOOKUP_FALLBACK] Searching SKU: ${skuLower} via general search`);
      res = await fetch(searchUrl.toString(), {
        headers: { 'Authorization': `Basic ${auth}` }
      });
      if (res.ok) {
        prods = await res.json();
      } else {
        hadFailure = true;
        console.error(`[WOO_LOOKUP_FAIL] General search failed for ${skuLower}: ${res.status}`);
      }
    }

    for (const p of Array.isArray(prods) ? prods : []) {
      const pSku = (p.sku || '').trim().toLowerCase();

      // Check if this is a variation (it will have a parent_id > 0)
      if (p.parent_id && p.parent_id > 0) {
        if (pSku === skuLower) {
          targets.push({ productId: p.parent_id, variationId: p.id });
          continue;
        }
      }

      if (p.type === 'variable') {
        // If we found a variable parent, check its variations for this SKU
        const varUrl = new URL(`/wp-json/wc/v3/products/${p.id}/variations`, baseUrl);
        varUrl.searchParams.set('sku', skuLower);
        const vres = await fetch(varUrl.toString(), {
          headers: { 'Authorization': `Basic ${auth}` }
        });
        if (vres.ok) {
          const vars = await vres.json();
          for (const v of Array.isArray(vars) ? vars : []) {
            if ((v.sku || '').trim().toLowerCase() === skuLower) {
              targets.push({ productId: p.id, variationId: v.id });
            }
          }
        } else {
            hadFailure = true;
            console.error(`[WOO_LOOKUP_FAIL] Variation search failed for parent ${p.id}: ${vres.status}`);
        }
        // Also check if the parent SKU itself matches (though we usually skip this for variable)
        if (pSku === skuLower) {
          targets.push({ productId: p.id });
        }
      } else if (pSku === skuLower) {
        // Simple/Combo product
        targets.push({ productId: p.id });
      }
    }
  } catch (err) {
    hadFailure = true;
    console.error('[WOO_SKU_LOOKUP_ERROR]', err);
    await recordWooPushFailure(integration.id);
  }

  if (hadFailure) {
      console.log(`[WOO_SKU_LOOKUP_FAILED] Lookup failed for SKU: ${skuLower}`);
      return { targets, status: targets.length > 0 ? 'found' : 'lookupFailed' };
  }

  if (targets.length === 0) {
    console.log(`[WOO_SKU_LOOKUP_CONFIRMED_MISSING] No match found on Woo for SKU: ${skuLower}`);
    return { targets, status: 'confirmedMissing' };
  } else {
    console.log(`[WOO_LOOKUP_MATCH] Found ${targets.length} targets for SKU: ${skuLower}`);
    return { targets, status: 'found' };
  }
}

const WOO_SKU_NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const inFlightLookups = new Map<string, Promise<WooTarget[]>>();

async function fetchWooTargetsBySku(
  integration: any,
  sku: string,
  options: FetchWooTargetsOptions = {},
): Promise<WooTarget[]> {
  const skuLower = sku.trim().toLowerCase();
  if (!skuLower) return [];
  const forceRefresh = Boolean(options.forceRefresh);
  // Include forceRefresh in the in-flight key to prevent reusing non-refresh promises
  const inFlightKey = `${integration.id}|${skuLower}|force:${forceRefresh}`;
  const cacheKey = `${integration.id}|${skuLower}`;

  if (inFlightLookups.has(inFlightKey)) {
    return inFlightLookups.get(inFlightKey)!;
  }

  const doLookup = async (): Promise<WooTarget[]> => {
    if (!forceRefresh) {
      const cached = await readSkuMapCache(cacheKey);
      if (cached !== null) {
        if (cached.length === 0) {
          console.log(`[WOO_NEGATIVE_CACHE_HIT] Skipping WooCommerce API for missing SKU: ${skuLower}`);
        }
        return cached;
      }
    }

    // 1. Direct SKU lookup (Works for simple products and parent entries)
    const mapping = await prisma.wooSkuMapping.findUnique({
      where: { integrationId_sku: { integrationId: integration.id, sku: skuLower } },
      select: { targets: true, lastVerifiedAt: true },
    });
    
    // Support negative caching from DB
    if (mapping && !forceRefresh && isMappingFresh(mapping.lastVerifiedAt)) {
      const mappedTargets = normalizeWooTargets(mapping.targets);
      // Set correct TTL for cache hydration
      const ttl = mappedTargets.length === 0 ? WOO_SKU_NEGATIVE_CACHE_TTL_MS : CACHE_TTL_MS;
      await writeSkuMapCache(cacheKey, mappedTargets, ttl);
      return mappedTargets;
    }

    let lookupResult = await performWooSkuLookup(integration, skuLower);
    
    if (lookupResult.status === 'lookupFailed') {
      if (mapping && mapping.targets) {
        console.warn(`[WOO_MAPPING_STALE_FALLBACK] Lookup failed. Using stale mapping for SKU: ${skuLower}`);
        const mappedTargets = normalizeWooTargets(mapping.targets);
        return mappedTargets;
      }
      console.error(`[WOO_SKU_LOOKUP_FAILED] No prior mapping to fall back to for SKU: ${skuLower}`);
      return []; // Do NOT cache the failure
    }

    const normalized = normalizeWooTargets(lookupResult.targets);
    
    // Save the result (Negative Caching is applied here since status is found or confirmedMissing)
    const now = new Date();
    await prisma.wooSkuMapping.upsert({
      where: { integrationId_sku: { integrationId: integration.id, sku: skuLower } },
      update: { targets: serializeWooTargets(normalized), lastVerifiedAt: now },
      create: {
        id: `wsm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        integrationId: integration.id,
        sku: skuLower,
        targets: serializeWooTargets(normalized),
        lastVerifiedAt: now,
        updatedAt: now,
      },
    });
    
    const ttl = normalized.length === 0 ? WOO_SKU_NEGATIVE_CACHE_TTL_MS : CACHE_TTL_MS;
    await writeSkuMapCache(cacheKey, normalized, ttl);
    return normalized;
  };

  const lookupPromise = doLookup();
  inFlightLookups.set(inFlightKey, lookupPromise);
  try {
    return await lookupPromise;
  } finally {
    inFlightLookups.delete(inFlightKey);
  }
}

async function attemptPushTargets(
  integration: any,
  sku: string,
  status: StockStatus,
  targets: WooTarget[],
) {
  let retryableFailure = false;
  let hadFailure = false;
  for (const t of targets) {
    await rateLimit(integration.id);
    const endpoint = t.variationId
      ? `${integration.storeUrl.replace(/\/$/, '')}/wp-json/wc/v3/products/${t.productId}/variations/${t.variationId}`
      : `${integration.storeUrl.replace(/\/$/, '')}/wp-json/wc/v3/products/${t.productId}`;
    try {
      const auth = Buffer.from(`${integration.consumerKey}:${integration.consumerSecret}`).toString('base64');
      try {
        const checkRes = await fetch(endpoint, {
          headers: { 'Authorization': `Basic ${auth}` },
        });
        if (checkRes.ok) {
          const data = await checkRes.json().catch(() => null);
          if (data?.manage_stock === true) {
            const disableRes = await fetch(endpoint, {
              method: 'PUT',
              headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ manage_stock: false }),
            });
            if (!disableRes.ok) {
              hadFailure = true;
              const disableText = await disableRes.text();
              console.warn('[WOO_MANAGE_STOCK_DISABLE_FAIL]', endpoint, disableRes.status, disableText);
            } else {
              console.log(`[WOO_MANAGE_STOCK_DISABLED] ${sku} (${endpoint})`);
            }
          }
        } else {
          hadFailure = true;
          const checkText = await checkRes.text();
          console.warn('[WOO_MANAGE_STOCK_FETCH_FAIL]', endpoint, checkRes.status, checkText);
        }
      } catch (err) {
        hadFailure = true;
        console.warn('[WOO_MANAGE_STOCK_CHECK_ERR]', endpoint, err);
      }

      const payload: Record<string, unknown> = { stock_status: status };
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const raw = await res.text();
      let json: any = null;
      if (raw) {
        try {
          json = JSON.parse(raw);
        } catch {
          json = null;
        }
      }
      if (!res.ok) {
        hadFailure = true;
        if ([400, 404, 410].includes(res.status)) {
          retryableFailure = true;
        }
        console.error('[WOO_STATUS_PUSH_FAIL]', endpoint, res.status, raw);
        await recordWooPushFailure(integration.id);
      } else {
        await markCooldown(`${integration.id}|${sku.trim().toLowerCase()}|${status}`);
        const remoteStatus = json?.stock_status;
        if (remoteStatus && remoteStatus !== status) {
          console.warn(`[WOO_STATUS_MISMATCH] ${sku} expected ${status}, got ${remoteStatus} (${endpoint})`);
        }
        console.log(`[WOO_STATUS_PUSH_SUCCESS] ${sku} -> ${status} (${endpoint})`);
      }
    } catch (err) {
      hadFailure = true;
      console.error('[WOO_STATUS_PUSH_ERR]', endpoint, err);
      await recordWooPushFailure(integration.id);
    }
  }
  return { retryableFailure, hadFailure };
}

async function pushStockStatusToIntegration(
  integration: any,
  sku: string,
  status: StockStatus,
  force = false,
) {
  const skuLower = sku.trim().toLowerCase();
  if (!skuLower) return;

  if (await isWooPushCircuitOpen(integration.id)) {
    console.warn('[WOO_PUSH_CIRCUIT_OPEN] skip', integration.id);
    return;
  }

  const cooldownKey = `${integration.id}|${skuLower}|${status}`;
  // Bypass cooldown only for force=true
  if (!force && await isCooldownActive(cooldownKey)) return;

  const targets = await fetchWooTargetsBySku(integration, sku, { forceRefresh: false });
  if (!targets.length) return;

  let attempt = await attemptPushTargets(integration, sku, status, targets);
  if (attempt.retryableFailure) {
    const refreshedTargets = await fetchWooTargetsBySku(integration, sku, { forceRefresh: true });
    if (refreshedTargets.length) {
      attempt = await attemptPushTargets(integration, sku, status, refreshedTargets);
    }
  }

  if (!attempt.hadFailure) {
    await recordWooPushSuccess(integration.id);
  }
}

async function pushStockStatusForSku(
  sku: string,
  status: StockStatus,
  force = false,
) {
  if (!sku?.trim()) return;

  // Safety: Don't push if this SKU belongs to a variable product parent
  const productType = await getProductTypeBySku(sku);
  if (productType === 'variable') {
    console.log(`[STOCK_SYNC_SKIP] SKU ${sku} is a variable parent, skipping sync.`);
    return;
  }

  const integrations = await prisma.wooCommerceIntegration.findMany({ where: force ? { status: 'Active' } : { status: 'Active', autoSyncEnabled: true } });
  await Promise.all(
    integrations.map((integration) =>
      enqueueIntegrationTask(integration.id, () =>
        pushStockStatusToIntegration(integration, sku, status, force)
      )
    )
  );
}

async function getTotalQty(productId: string, variantId?: string | null): Promise<number> {
  const items = await prisma.inventoryItem.findMany({
    where: { productId, variantId: variantId ?? null },
    select: { quantity: true, reservedQuantity: true },
  });
  return items.reduce((sum, i) => sum + Math.max((i.quantity || 0) - (i.reservedQuantity || 0), 0), 0);
}

async function getComboQty(product: any): Promise<number> {
  if (!product?.comboItems?.length) return 0;
  const totals = await Promise.all(
    product.comboItems.map((ci: any) => getTotalQty(ci.childId, ci.variantId || null))
  );
  return totals.length ? Math.min(...totals) : 0;
}

export async function triggerStockStatusSync(productId: string, variantId?: string | null, force = false) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { variants: true, comboItems: true },
  });
  if (!product) return;
  const sku =
    product.variants.find(v => v.id === variantId)?.sku ||
    product.sku ||
    null;
  if (!sku) return;

  // Check stock sync mode
  const mode = await getStockSyncMode();
  if (mode === 'publish') {
    // In publish mode, stock status is based on isPublished flag
    const newStatus: StockStatus = product.isPublished ? 'instock' : 'outofstock';
    await pushStockStatusForSku(sku, newStatus, force);
    return;
  }

  const totalQty = product.productType === 'combo'
    ? await getComboQty(product)
    : await getTotalQty(productId, variantId);
  const newStatus: StockStatus = totalQty > 0 ? 'instock' : 'outofstock';

  // Trigger Notification for Low Stock (independent of sync)
  const threshold = await getLowStockThreshold();
  if (totalQty > 0 && totalQty <= threshold) {
    const skuLower = sku.trim().toLowerCase();
    if (await shouldNotifyLowStock(skuLower)) {
      const variant = product.variants.find(v => v.id === variantId);
      const itemName = variant ? `${product.name} (${variant.name})` : product.name;
      notifyAdmins(
        `Low Stock: ${itemName}`,
        `Remaining quantity: ${totalQty}`,
        `/dashboard/inventory`,
        'Warehouse'
      );
    }
  }

  // Strategy: Only push if forced OR if status is expected to change upstream
  // The actual check of "did it flip?" can be more accurately done if we know the previous status,
  // but for safety, we push if force=true or from order logic when crossing zero.
  if (force) {
    await pushStockStatusForSku(sku, newStatus, false);
  } else {
    // If not forced, the caller handles the "crossing zero" check for efficiency
    console.log(`[STOCK_SYNC_SKIP] Redundant status push skipped for SKU: ${sku} (Qty: ${totalQty})`);
  }
}

export async function runStockStatusAudit() {
  const flags = await getLoadShedFlags();
  if (flags.sync) {
    console.log('[LOAD_SHED] skipping stock audit.');
    return;
  }

  const mode = await getStockSyncMode();

  // In publish mode, use isPublished instead of qty
  if (mode === 'publish') {
    console.log('[STOCK_AUDIT] Running in publish mode - using isPublished flag');
    const PAGE_SIZE = 250;
    let cursor: string | undefined;

    while (true) {
      const products = await prisma.product.findMany({
        take: PAGE_SIZE,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          sku: true,
          isPublished: true,
          productType: true,
          variants: { select: { id: true, sku: true } },
        },
      });

      if (products.length === 0) break;

      const tasks: Array<() => Promise<void>> = [];

      for (const p of products) {
        const status: StockStatus = p.isPublished ? 'instock' : 'outofstock';
        if (p.sku) {
          tasks.push(() => pushStockStatusForSku(p.sku, status, false));
        }
        for (const v of p.variants || []) {
          if (!v.sku) continue;
          // Variants use parent's isPublished
          tasks.push(() => pushStockStatusForSku(v.sku, status, false));
        }
      }

      if (tasks.length) {
        const activeConcurrency = flags.sync ? 1 : AUDIT_CONCURRENCY;
        await runTasksInBatches(tasks, activeConcurrency);
      }

      cursor = products[products.length - 1]?.id;
      if (products.length < PAGE_SIZE) break;
    }

    await setStockAuditLastRun(new Date());
    return;
  }

  // Inventory mode - existing qty-based logic
  const totals = new Map<string, number>();
  const rows = await prisma.$queryRaw<
    Array<{ productId: string; variantId: string | null; available: number }>
  >(Prisma.sql`
    SELECT
      "productId",
      "variantId",
      SUM(GREATEST("quantity" - "reservedQuantity", 0))::float AS available
    FROM "InventoryItem"
    GROUP BY "productId", "variantId"
  `);

  rows.forEach((row) => {
    const key = `${row.productId}|${row.variantId || 'none'}`;
    totals.set(key, Number(row.available || 0));
  });

  const PAGE_SIZE = 250;
  let cursor: string | undefined;

  while (true) {
    const products = await prisma.product.findMany({
      take: PAGE_SIZE,
      skip: cursor ? 1 : 0,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        sku: true,
        productType: true,
        variants: { select: { id: true, sku: true } },
        comboItems: { select: { childId: true, variantId: true } },
      },
    });

    if (products.length === 0) break;

    const tasks: Array<() => Promise<void>> = [];

    for (const p of products) {
      if (p.sku) {
        const baseTotal = p.productType === 'combo'
          ? (p.comboItems?.length
            ? Math.min(
              ...p.comboItems.map((ci: any) => totals.get(`${ci.childId}|${ci.variantId || 'none'}`) || 0)
            )
            : 0)
          : (totals.get(`${p.id}|none`) || 0);
        tasks.push(() => pushStockStatusForSku(p.sku, baseTotal > 0 ? 'instock' : 'outofstock', false));
      }
      for (const v of p.variants || []) {
        if (!v.sku) continue;
        const key = `${p.id}|${v.id}`;
        const qty = totals.get(key) || 0;
        tasks.push(() => pushStockStatusForSku(v.sku, qty > 0 ? 'instock' : 'outofstock', false));
      }
    }

    if (tasks.length) {
      const activeConcurrency = flags.sync ? 1 : AUDIT_CONCURRENCY;
      if (flags.sync) console.log('[LOAD_SHED] throttling audit concurrency to 1');
      await runTasksInBatches(tasks, activeConcurrency);
    }

    cursor = products[products.length - 1]?.id;
    if (products.length < PAGE_SIZE) break;
  }

  await setStockAuditLastRun(new Date());
}

export async function ensureStockStatusAuditFallback() {
  if (fallbackAuditInFlight) return fallbackAuditInFlight;

  const lastRun = await getStockAuditLastRun();
  const flags = await getLoadShedFlags();

  if (flags.sync) {
    console.log('[LOAD_SHED] skipping fallback stock audit section.');
    return;
  }

  if (lastRun && Date.now() - lastRun.getTime() < STOCK_AUDIT_INTERVAL_MS) {
    return;
  }

  fallbackAuditInFlight = (async () => {
    try {
      console.log('[STOCK_AUDIT_FALLBACK] Triggering stock audit from dashboard.');
      await runStockStatusAudit();
    } catch (err) {
      console.error('[STOCK_AUDIT_FALLBACK_ERROR]', err);
    } finally {
      fallbackAuditInFlight = null;
    }
  })();

  return fallbackAuditInFlight;
}

// Helper to fetch variations for a product
async function fetchWooVariations(integration: any, productId: number): Promise<Array<{ id: number; sku: string }>> {
  const baseUrl = integration.storeUrl.replace(/\/$/, '');
  const url = `${baseUrl}/wp-json/wc/v3/products/${productId}/variations?per_page=100`;
  const auth = Buffer.from(`${integration.consumerKey}:${integration.consumerSecret}`).toString('base64');

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}` }
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error('[WOO_VARS_FETCH_ERR]', url, err);
  }
  return [];
}

export async function pushStockStatusForSkus(skus: string[], force: boolean = false) {
  // Check mode first
  const mode = await getStockSyncMode();

  const products = await prisma.product.findMany({
    where: {
      OR: [
        { sku: { in: skus } },
        { variants: { some: { sku: { in: skus } } } }
      ]
    },
    include: { variants: true, comboItems: true }
  });
  if (!products.length) return;

  const integrations = await prisma.wooCommerceIntegration.findMany({ where: force ? { status: 'Active' } : { status: 'Active', autoSyncEnabled: true } });
  if (!integrations.length) return;

  console.log(`[BULK_SYNC] Processing ${products.length} products for ${integrations.length} integrations (Mode: ${mode})`);

  const tasks: Array<() => Promise<void>> = [];

  // In publish mode, we ignore quantity and use isPublished
  if (mode === 'publish') {
    for (const p of products) {
      const status: StockStatus = p.isPublished ? 'instock' : 'outofstock';
      if (p.productType === 'variable') {
        for (const v of p.variants) {
          if (!v.sku) continue;
          console.log(`[BULK_SYNC] Syncing Variation (Publish Mode): ${v.sku} -> Status: ${status}`);
          for (const integration of integrations) {
            tasks.push(() =>
              enqueueIntegrationTask(integration.id, () =>
                pushStockStatusToIntegration(integration, v.sku!, status, true)
              )
            );
          }
        }
      } else if (p.sku) {
        console.log(`[BULK_SYNC] Syncing Product (Publish Mode): ${p.sku} -> Status: ${status}`);
        for (const integration of integrations) {
          tasks.push(() =>
            enqueueIntegrationTask(integration.id, () =>
              pushStockStatusToIntegration(integration, p.sku!, status, true)
            )
          );
        }
      }
    }
  } else {
    // Inventory Mode: Calculate quantity totals
    const relevantProductIds = new Set<string>();
    for (const product of products) {
      relevantProductIds.add(product.id);
      for (const combo of product.comboItems || []) {
        relevantProductIds.add(combo.childId);
      }
    }

    const items = relevantProductIds.size
      ? await prisma.inventoryItem.findMany({
        where: { productId: { in: Array.from(relevantProductIds) } },
        select: { productId: true, variantId: true, quantity: true, reservedQuantity: true },
      })
      : [];
    const totals = new Map<string, number>();
    for (const it of items) {
      const key = `${it.productId}|${it.variantId || 'none'}`;
      const available = Math.max((it.quantity || 0) - (it.reservedQuantity || 0), 0);
      totals.set(key, (totals.get(key) || 0) + available);
    }

    for (const p of products) {
      if (p.productType === 'variable') {
        // Variable products: Only sync variations. Skip the parent SKU.
        for (const v of p.variants) {
          if (!v.sku) continue;
          const qty = totals.get(`${p.id}|${v.id}`) || 0;
          const status = qty > 0 ? 'instock' : 'outofstock';
          console.log(`[BULK_SYNC] Syncing Variation: ${v.sku} -> Status: ${status}`);
          for (const integration of integrations) {
            tasks.push(() =>
              enqueueIntegrationTask(integration.id, () =>
                pushStockStatusToIntegration(integration, v.sku!, status, true)
              )
            );
          }
        }
      } else if (p.sku) {
        // Simple/Combo/3-piece: Sync the main SKU
        const qty = p.productType === 'combo'
          ? (p.comboItems?.length ? Math.min(
            ...p.comboItems.map((ci: any) => totals.get(`${ci.childId}|${ci.variantId || 'none'}`) || 0)
          ) : 0)
          : (totals.get(`${p.id}|none`) || 0);
        const status = qty > 0 ? 'instock' : 'outofstock';
        console.log(`[BULK_SYNC] Syncing Product: ${p.sku} -> Status: ${status}`);
        for (const integration of integrations) {
          tasks.push(() =>
            enqueueIntegrationTask(integration.id, () =>
              pushStockStatusToIntegration(integration, p.sku!, status, true)
            )
          );
        }
      }
    }
  }

  if (tasks.length) {
    const flags = await getLoadShedFlags();
    const activeConcurrency = flags.sync ? 1 : BULK_SYNC_CONCURRENCY;
    if (flags.sync) console.log('[LOAD_SHED] throttling bulk sync concurrency to 1');
    await runTasksInBatches(tasks, activeConcurrency);
  }
}

export async function refreshWooSkuMappings(skus: string[], integrationId?: string) {
  const cleanedSkus = skus.filter((sku): sku is string => typeof sku === 'string');
  const uniqueSkus = Array.from(
    new Set(cleanedSkus.map((sku) => sku.trim()).filter(Boolean)),
  );
  if (!uniqueSkus.length) return { refreshed: 0, integrations: 0 };

  const where: { status: string; id?: string } = { status: 'Active' };
  if (integrationId) where.id = integrationId;
  const finalWhere = { ...where };
  const integrations = await prisma.wooCommerceIntegration.findMany({ where: finalWhere });
  if (!integrations.length) return { refreshed: 0, integrations: 0 };

  const tasks: Array<() => Promise<void>> = [];
  for (const integration of integrations) {
    for (const sku of uniqueSkus) {
      tasks.push(() =>
        enqueueIntegrationTask(integration.id, async () => {
          await fetchWooTargetsBySku(integration, sku, { forceRefresh: true });
        }),
      );
    }
  }

  const flags = await getLoadShedFlags();
  const activeConcurrency = flags.sync ? 1 : BULK_SYNC_CONCURRENCY;
  if (flags.sync) console.log('[LOAD_SHED] throttling mapping refresh concurrency to 1');
  await runTasksInBatches(tasks, activeConcurrency);
  return { refreshed: tasks.length, integrations: integrations.length };
}
