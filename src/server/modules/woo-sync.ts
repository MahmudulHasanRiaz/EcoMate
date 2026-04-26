import prisma from '@/lib/prisma';
import { randomBytes, createHash } from 'crypto';
import { enqueueStockSyncJob, enqueueStockSyncBatchJob } from '@/server/queues/index';
import { pushWooStatusUpdate, normalizeWooStoreUrl } from './integrations';
import { generateOrderNumber } from '../utils/orderNumber';
import { handleStockReservation } from './stock-reservation';
import { revalidateTags } from '../utils/revalidate';
import { generateInvalidPhonePlaceholder, normalizeBdPhoneForStorage } from '@/lib/phone';
import { notifyAdmins } from './notifications';
import { recordWebhookFailure } from './webhook-failures';
import { resolveSkuMap } from './woo-sku-map';
import { getGeneralSettings } from '../utils/app-settings';
import { inferPlatformFromUrl } from '@/server/utils/platform';
import { tryAutoUtmAttribution } from '@/server/modules/marketing';

async function getStockSyncMode(): Promise<'inventory' | 'publish'> {
  const settings = await getGeneralSettings();
  return settings.stockSyncMode === 'publish' ? 'publish' : 'inventory';
}

// Resilience Constants
const WOO_RATE_GAP_MS = 500;
const WOO_CB_FAIL_WINDOW_MS = 5 * 60 * 1000;
const WOO_CB_FAIL_THRESHOLD = 3;
const WOO_CB_OPEN_MS = 10 * 60 * 1000;
const WOO_LOCK_TTL_MS = 2 * 60 * 1000;

// Resilience State (In-memory Fallback)
const wooRateMap = new Map<string, number>();
const wooFailCountMap = new Map<string, { count: number; firstFail: number }>();
const wooCBOpenMap = new Map<string, number>();

function buildWooKey(...parts: string[]) {
  return `woo:sync:${parts.join(':')}`;
}

async function getRedis() {
  try {
    const { getRedisClient } = await import('@/server/queues/redis');
    return getRedisClient();
  } catch {
    return null;
  }
}

async function wooRateLimit(integrationId: string) {
  const key = buildWooKey('rate', integrationId);
  const redis = await getRedis();
  const now = Date.now();

  if (redis) {
    const last = await redis.get(key);
    if (last) {
      const elapsed = now - parseInt(last);
      if (elapsed < WOO_RATE_GAP_MS) {
        await new Promise(r => setTimeout(r, WOO_RATE_GAP_MS - elapsed));
      }
    }
    await redis.set(key, Date.now().toString(), 'PX', WOO_RATE_GAP_MS * 2);
  } else {
    const last = wooRateMap.get(integrationId) || 0;
    const elapsed = now - last;
    if (elapsed < WOO_RATE_GAP_MS) {
      await new Promise(r => setTimeout(r, WOO_RATE_GAP_MS - elapsed));
    }
    wooRateMap.set(integrationId, Date.now());
  }
}

async function isCircuitOpen(integrationId: string): Promise<boolean> {
  const key = buildWooKey('cb:open', integrationId);
  const redis = await getRedis();
  const now = Date.now();

  if (redis) {
    const open = await redis.get(key);
    if (open) return true;
  } else {
    const openUntil = wooCBOpenMap.get(integrationId) || 0;
    if (now < openUntil) return true;
  }
  return false;
}

async function recordWooFailure(integrationId: string) {
  const failKey = buildWooKey('cb:fail', integrationId);
  const openKey = buildWooKey('cb:open', integrationId);
  const redis = await getRedis();
  const now = Date.now();

  if (redis) {
    const count = await redis.incr(failKey);
    if (count === 1) {
      await redis.expire(failKey, Math.floor(WOO_CB_FAIL_WINDOW_MS / 1000));
    }
    if (count >= WOO_CB_FAIL_THRESHOLD) {
      await redis.set(openKey, 'true', 'PX', WOO_CB_OPEN_MS);
      console.warn(`[WOO_CIRCUIT_BREAKER] OPEN for integration ${integrationId}`);
    }
  } else {
    const entry = wooFailCountMap.get(integrationId) || { count: 0, firstFail: now };
    if (now - entry.firstFail > WOO_CB_FAIL_WINDOW_MS) {
      entry.count = 1;
      entry.firstFail = now;
    } else {
      entry.count += 1;
    }
    wooFailCountMap.set(integrationId, entry);

    if (entry.count >= WOO_CB_FAIL_THRESHOLD) {
      wooCBOpenMap.set(integrationId, now + WOO_CB_OPEN_MS);
      console.warn(`[WOO_CIRCUIT_BREAKER] OPEN (Memory) for integration ${integrationId}`);
    }
  }
}

async function clearWooFailures(integrationId: string) {
  const failKey = buildWooKey('cb:fail', integrationId);
  const openKey = buildWooKey('cb:open', integrationId);
  const redis = await getRedis();

  if (redis) {
    await redis.del(failKey, openKey);
  } else {
    wooFailCountMap.delete(integrationId);
    wooCBOpenMap.delete(integrationId);
  }
}

async function withWooIntegrationLock<T>(integrationId: string, task: () => Promise<T>): Promise<T> {
  const lockKey = buildWooKey('lock', integrationId);
  const redis = await getRedis();
  if (!redis) return task();

  const token = randomBytes(16).toString('hex');
  let acquired = false;
  for (let i = 0; i < 50; i++) { // retry for ~10s
    const result = await redis.set(lockKey, token, 'PX', WOO_LOCK_TTL_MS, 'NX');
    if (result === 'OK') {
      acquired = true;
      break;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  if (!acquired) {
    throw new Error('WOO_INTEGRATION_LOCKED');
  }

  try {
    return await task();
  } finally {
    // Lua script to release lock safely
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(script, 1, lockKey, token).catch(e => console.error('[WOO_LOCK_RELEASE_ERR]', e));
  }
}

type WooOrder = any;
const WOO_ALLOWED_IMPORT_STATUS = 'processing' as const;

function normalizeWooImportStatus(statusFilter?: string): typeof WOO_ALLOWED_IMPORT_STATUS {
  const requested = (statusFilter || '').trim().toLowerCase();
  if (requested && requested !== WOO_ALLOWED_IMPORT_STATUS) {
    console.warn(`[WOO_SYNC_STATUS_FORCED] Requested status "${requested}" ignored; forced to "${WOO_ALLOWED_IMPORT_STATUS}"`);
  }
  return WOO_ALLOWED_IMPORT_STATUS;
}

function mapPayment(method: string | undefined): 'CashOnDelivery' | 'bKash' | 'Nagad' {
  const m = (method || '').toLowerCase();
  if (m.includes('bkash')) return 'bKash';
  if (m.includes('nagad')) return 'Nagad';
  return 'CashOnDelivery';
}

type WooAddress = {
  address: string;
  district: string;
  city?: string;
  cityName?: string;
  zoneName?: string;
  postalCode?: string;
  country: string;
  billing?: any;
  shipping?: any;
};

function normalizeWooAddress(wo: any): WooAddress {
  const billing = wo?.billing || {};
  const shipping = wo?.shipping || {};
  const address = shipping.address_1 || billing.address_1 || '';
  const city = shipping.city || billing.city || '';
  const district = shipping.state || billing.state || city || '';
  const zoneName = shipping.state || billing.state || '';
  const postalCode = shipping.postcode || billing.postcode || '';
  const country = shipping.country || billing.country || 'BD';
  return {
    address: address || '',
    district: district || city || '',
    city: city || undefined,
    cityName: city || undefined,
    zoneName: zoneName || undefined,
    postalCode: postalCode || undefined,
    country: country || 'BD',
    billing,
    shipping,
  };
}

async function closeOpenIncompleteLeadsByPhone(phoneNormalized?: string | null) {
  if (!phoneNormalized) return;
  try {
    await prisma.wooCheckoutLead.updateMany({
      where: {
        status: 'OPEN',
        phoneNormalized,
      },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
    });
  } catch (e) {
    console.error('[WOO_SYNC_CLOSE_INCOMPLETE_ERR]', e);
  }
}

const wooWebhookManageMap = new Map<string, number>();

async function tryAcquireWooWebhookLock(integrationId: string) {
  try {
    const { getRedisClient } = await import('@/server/queues/redis');
    const redis = getRedisClient();
    if (redis) {
      const ok = await redis.set(`woo:webhook:manage:${integrationId}`, '1', 'EX', 90, 'NX');
      return ok === 'OK';
    }
  } catch (e) {
    console.error('[WOO_LOCK_REDIS_ERR]', e);
  }

  // memory fallback
  const now = Date.now();
  const last = wooWebhookManageMap.get(integrationId);
  if (last && now - last < 90 * 1000) return false;
  wooWebhookManageMap.set(integrationId, now);
  return true;
}

async function releaseWooWebhookLock(integrationId: string) {
  try {
    const { getRedisClient } = await import('@/server/queues/redis');
    const redis = getRedisClient();
    if (redis) await redis.del(`woo:webhook:manage:${integrationId}`);
  } catch (e) {
    console.error('[WOO_UNLOCK_REDIS_ERR]', e);
  }
  wooWebhookManageMap.delete(integrationId);
}

async function markWebhookEnsured(integrationId: string) {
  wooWebhookEnsureRecentMap.set(integrationId, Date.now());
  try {
    const { getRedisClient } = await import('@/server/queues/redis');
    const redis = getRedisClient();
    if (redis) await redis.set(`woo:webhook:last_ensure:${integrationId}`, Date.now().toString(), 'EX', 5 * 60);
  } catch (e) {
    console.error('[WOO_ENSURE_COOLDOWN_ERR]', e);
  }
}

const wooWebhookEnsureInflight = new Map<string, number>();

async function markEnsureInflight(integrationId: string) {
  const now = Date.now();
  wooWebhookEnsureInflight.set(integrationId, now);
  try {
    const { getRedisClient } = await import('@/server/queues/redis');
    const redis = getRedisClient();
    if (redis) await redis.set(`woo:webhook:ensure_inflight:${integrationId}`, String(now), 'EX', 60);
  } catch (e) {
    console.error('[WOO_INFLIGHT_SET_ERR]', e);
  }
}

async function clearEnsureInflight(integrationId: string) {
  wooWebhookEnsureInflight.delete(integrationId);
  try {
    const { getRedisClient } = await import('@/server/queues/redis');
    const redis = getRedisClient();
    if (redis) await redis.del(`woo:webhook:ensure_inflight:${integrationId}`);
  } catch (e) {
    console.error('[WOO_INFLIGHT_DEL_ERR]', e);
  }
}

const wooWebhookEnsureRecentMap = new Map<string, number>();
const WOO_WEBHOOK_ENSURE_RECENT_TTL_MS = 5 * 60 * 1000;

async function hasRecentEnsure(integrationId: string) {
  const now = Date.now();
  const mem = wooWebhookEnsureRecentMap.get(integrationId);
  if (mem && now - mem < WOO_WEBHOOK_ENSURE_RECENT_TTL_MS) return true;
  try {
    const { getRedisClient } = await import('@/server/queues/redis');
    const redis = getRedisClient();
    if (redis) {
      const v = await redis.get(`woo:webhook:last_ensure:${integrationId}`);
      if (v) return true;
    }
  } catch (e) {
    console.error('[WOO_ENSURE_RECENT_READ_ERR]', e);
  }
  return false;
}

function resolveWebhookAppBase(): string | null {
  const candidates = [
    process.env.WOO_WEBHOOK_BASE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
  ];

  const isProduction = process.env.NODE_ENV === 'production';
  const isIPv4Host = (host: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);

  for (const raw of candidates) {
    const value = (raw || '').trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      const protocol = parsed.protocol.toLowerCase();
      const hostname = parsed.hostname.toLowerCase();

      if (protocol !== 'http:' && protocol !== 'https:') continue;

      if (isProduction) {
        const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1';
        const isInternalAlias = !hostname.includes('.') && !isIPv4Host(hostname);
        if (isLocalHost || isInternalAlias) {
          console.error(`[WOO_WEBHOOK_BASE_INVALID] Ignoring non-public host: ${hostname}`);
          continue;
        }
        if (protocol !== 'https:') {
          console.error(`[WOO_WEBHOOK_BASE_INVALID] Ignoring non-https base URL in production: ${value}`);
          continue;
        }
      }

      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // ignore invalid env values
    }
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('[WOO_WEBHOOK_BASE_MISSING] Set APP_URL or NEXT_PUBLIC_APP_URL to public HTTPS base URL.');
    return null;
  }

  return 'http://localhost:9002';
}

export async function ensureWooWebhook(integration: any, options: { forceRecreate?: boolean; rotateSecret?: boolean } = {}) {
  if (!(await tryAcquireWooWebhookLock(integration.id))) {
    console.log('[WOO_WEBHOOK_MANAGE_LOCK_BUSY]', integration.id);
    return;
  }

  try {
    if (!options.forceRecreate && await hasRecentEnsure(integration.id)) {
      console.log('[WOO_WEBHOOK_ENSURE_SKIP_RECENT]', integration.id);
      return;
    }
    await markEnsureInflight(integration.id);
    try {
      if (!integration?.storeUrl || !integration?.consumerKey || !integration?.consumerSecret) return;

      const appBase = resolveWebhookAppBase();
      if (!appBase) return;

      const targetUrl = `${appBase.replace(/\/$/, '')}/api/webhooks/woo/${integration.id}`;
      const normalizedTarget = targetUrl.replace(/\/$/, '');
      console.log('[WOO_WEBHOOK_TARGET]', normalizedTarget);
      const auth = Buffer.from(`${integration.consumerKey}:${integration.consumerSecret}`).toString('base64');
      const requestHeaders = {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      };

      let secret = integration.webhookSecret as string | null;
      let secretChanged = false;
      if (!secret || options.rotateSecret) {
        if (options.rotateSecret) {
          console.log('[WOO_WEBHOOK_SECRET_ROTATED] Rotating secret for integration', integration.id);
        } else {
          console.log('[WOO_WEBHOOK_ENSURE] Generating new webhook secret for integration', integration.id);
        }
        secret = `whsec_${randomBytes(24).toString('hex')}`;
        secretChanged = true;
      }

      const deleteHook = async (hookId: number | string, reason: string) => {
        const deleteUrl = new URL(`/wp-json/wc/v3/webhooks/${hookId}`, integration.storeUrl);
        deleteUrl.searchParams.set('force', 'true');
        const delRes = await fetch(deleteUrl.toString(), { method: 'DELETE', headers: requestHeaders });
        if (!delRes.ok) {
          console.error('[WOO_WEBHOOK_DELETE_FAILED]', reason, hookId, await delRes.text());
        }
      };

      // Paginate to find ALL hooks (Woo limits per_page)
      const perPage = 100;
      let pageNum = 1;
      const hooks: any[] = [];
      while (pageNum <= 10) {
        const pageUrl = new URL('/wp-json/wc/v3/webhooks', integration.storeUrl);
        pageUrl.searchParams.set('per_page', String(perPage));
        pageUrl.searchParams.set('page', String(pageNum));
        const res = await fetch(pageUrl.toString(), { headers: requestHeaders });
        if (!res.ok) {
          console.error('[WOO_WEBHOOK_LIST_FAILED]', await res.text());
          return;
        }
        const batch = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        hooks.push(...batch);
        if (batch.length < perPage) break;
        pageNum += 1;
      }

      // Topics we need active — same delivery_url + secret for both
      const REQUIRED_TOPICS = ['order.created', 'order.updated'] as const;

      // Find all hooks that target this integration route
      const allHooksForThisIntegration = Array.isArray(hooks) ? hooks.filter((h: any) => {
        const url = (h.delivery_url || '');
        return url.includes(`/api/webhooks/woo/${integration.id}`);
      }) : [];

      const shouldRecreate = Boolean(options.forceRecreate || secretChanged);
      let anyHookCreated = false;

      // For each required topic, ensure exactly one active hook with correct URL
      for (const topic of REQUIRED_TOPICS) {
        const topicHooks = allHooksForThisIntegration.filter((h: any) => h.topic === topic);

        if (shouldRecreate) {
          console.log(`[WOO_WEBHOOK_FORCE] Recreating ${topic} hooks (secretChanged=${secretChanged}, force=${Boolean(options.forceRecreate)})`);
          for (const h of topicHooks) {
            await deleteHook(h.id, `force recreate ${topic}`);
          }
          // Fall through to create below
        } else if (topicHooks.length > 1) {
          console.log(`[WOO_WEBHOOK_CLEANUP] Found ${topicHooks.length} ${topic} hooks. Deleting all duplicates.`);
          for (const h of topicHooks) {
            await deleteHook(h.id, `duplicate ${topic} cleanup`);
          }
          // Fall through to create below
        } else if (topicHooks.length === 1) {
          const h = topicHooks[0];
          const hookUrl = (h.delivery_url || '').replace(/\/$/, '');
          const hookStatus = String(h.status || '').toLowerCase();
          if (hookUrl !== normalizedTarget) {
            console.log(`[WOO_WEBHOOK_CLEANUP] Deleting ${topic} hook with mismatched URL`, h.delivery_url);
            await deleteHook(h.id, `mismatched delivery_url ${topic}`);
            // Fall through to create below
          } else if (hookStatus !== 'active') {
            console.log(`[WOO_WEBHOOK_CLEANUP] Deleting non-active ${topic} hook ${h.id} (status=${hookStatus})`);
            await deleteHook(h.id, `inactive ${topic} hook`);
            // Fall through to create below
          } else {
            console.log(`[WOO_WEBHOOK_ENSURE] ${topic} hook ${h.id} is valid — no action needed.`);
            continue; // ← valid hook exists, skip creation
          }
        }

        // Create the hook for this topic
        const createPayload = {
          name: `EcoMate ${topic}`,
          topic,
          delivery_url: normalizedTarget,
          secret,
          status: 'active',
        };
        const createUrl = new URL('/wp-json/wc/v3/webhooks', integration.storeUrl);
        const createRes = await fetch(createUrl.toString(), {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(createPayload),
        });
        if (!createRes.ok) {
          console.error(`[WOO_WEBHOOK_CREATE_FAILED] topic=${topic}`, await createRes.text());
          continue;
        }
        console.log(`[WOO_WEBHOOK_CREATED] topic=${topic} url=${normalizedTarget}`);
        anyHookCreated = true;
      }

      // Persist secret to DB any time we created/recreated a hook
      if ((anyHookCreated || secretChanged) && secret) {
        await prisma.wooCommerceIntegration.update({
          where: { id: integration.id },
          data: { webhookSecret: secret },
        });
        integration.webhookSecret = secret;
        await revalidateTags(['integrations']);
        try {
          const { getRedisClient } = await import('@/server/queues/redis');
          const redis = getRedisClient();
          if (redis) await redis.del(`woo:integration:${integration.id}`);
        } catch (e) {
          console.error('[WOO_CACHE_INVALIDATE_WARN]', e);
        }
        console.log(`[WOO_WEBHOOK_SECRET_SYNCED] Secret persisted to DB for integration ${integration.id}`);
      }

      await markWebhookEnsured(integration.id);
      await revalidateTags(['integrations']);


    } catch (err) {
      console.error('[WOO_WEBHOOK_ENSURE_ERROR]', err);
    } finally {
      await clearEnsureInflight(integration.id);
    }
  } finally {
    await releaseWooWebhookLock(integration.id);
  }
}

/**
 * Process a single Woo order: Find match, upsert customer, create local order, handle stock.
 */
export async function syncOneWooOrder(
  wo: WooOrder,
  integration: any,
  skuMap?: Map<string, any>,
  productInfoMap?: Map<string, any>
) {
  const lineItems = Array.isArray(wo.line_items) ? wo.line_items : [];

  // Use provided caches or resolve per-order
  const effectiveSkuMap = skuMap || await resolveSkuMap(
    lineItems.map((li: any) => (li.sku || '').trim()).filter((s: string) => !!s)
  );

  let effectiveProductInfoMap = productInfoMap;
  if (!effectiveProductInfoMap) {
    const productIds = Array.from(new Set(Array.from(effectiveSkuMap.values()).map(v => v.productId)));
    const productInfos = productIds.length
      ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        include: {
          variants: { include: { InventoryItem: true } },
          comboItems: {
            include: {
              child: { include: { InventoryItem: true } },
              variant: { include: { InventoryItem: true } }
            }
          },
          InventoryItem: true,
        },
      })
      : [];
    effectiveProductInfoMap = new Map(productInfos.map(p => [p.id, p]));
  }

  const orderId = `woo-${integration.id}-${wo.id}`;
  const total = parseFloat(wo.total || '0') || 0;
  const shipping = parseFloat(wo.shipping_total || '0') || 0;
  const discount = parseFloat(wo.discount_total || '0') || 0;
  const customerName = `${wo.billing?.first_name || ''} ${wo.billing?.last_name || ''}`.trim() || 'Unknown';
  const phoneRaw = wo.billing?.phone || wo.shipping?.phone || '';
  const normalized = normalizeBdPhoneForStorage(phoneRaw);
  const normalizedPhoneValue = normalized.value || null;
  const normalizedPhone = normalized.value || generateInvalidPhonePlaceholder();
  const customerEmail = wo.billing?.email || '';
  const paymentMethod = mapPayment(wo.payment_method);
  const normalizedAddress = normalizeWooAddress(wo);
  const ipRaw = (wo?.customer_ip_address || '').split(',')[0].trim();
  const ipHash = ipRaw ? createHash('sha256').update(ipRaw).digest('hex') : null;
  console.log(`[WOO_SYNC_ONE] Processing ${wo.id} (${wo.status}) for integration ${integration.id}`);


  // If order already exists locally, push hold to Woo and skip import
  const existing = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  const legacyWhere: any = {
    source: 'woo',
    id: { endsWith: `-${wo.id}` },
  };
  if (normalizedPhoneValue) {
    legacyWhere.customerPhone = normalizedPhoneValue;
  } else if (integration.businessId) {
    legacyWhere.businessId = integration.businessId;
  }
  const legacyExisting = !existing
    ? await prisma.order.findFirst({
      where: legacyWhere,
      select: { id: true },
    })
    : null;
  if (existing || legacyExisting) {
    const targetId = existing?.id || legacyExisting?.id || orderId;
    console.log(`[WOO_SYNC_SKIP] Order ${wo.id} already exists (localId: ${targetId})`);

    // Even if order exists, check for UTM attribution
    await tryAutoUtmAttribution({
        orderId: targetId,
        payload: wo,
        integrationBusinessId: integration?.businessId
    });

    // reinforce hold upstream to prevent re-processing
    await pushHoldWithRetry({
      storeUrl: integration.storeUrl,
      consumerKey: integration.consumerKey,
      consumerSecret: integration.consumerSecret,
      externalOrderId: String(wo.id),
      integrationId: integration.id,
      orderId: targetId,
      storeName: integration.storeName || integration.storeUrl,
    });
    await closeOpenIncompleteLeadsByPhone(normalizedPhoneValue);
    return { action: 'skipped', orderId };
  }

  // Ensure customer exists to satisfy FK
  const customer = await prisma.customer.upsert({
    where: { phone: normalizedPhone },
    update: {
      name: customerName || undefined,
      email: customerEmail || undefined,
      address: normalizedAddress.address || '',
      district: normalizedAddress.district || '',
      country: normalizedAddress.country || 'BD',
    } as any,
    create: {
      name: customerName || 'Customer',
      phone: normalizedPhone,
      email: customerEmail || undefined,
      joinDate: new Date(),
      address: normalizedAddress.address || '',
      district: normalizedAddress.district || '',
      country: normalizedAddress.country || 'BD',
      updatedAt: new Date(),
    } as any,
  });

  // Determine final status and reason based on SKU matching and stock levels
  const outOfStockItems: string[] = [];
  const missingSkuItems: string[] = [];

  lineItems.forEach((li: any) => {
    const rawSku = (li.sku || '').trim();
    const skuKey = rawSku.toLowerCase();
    const match = effectiveSkuMap.get(skuKey);
    const name = li.name || rawSku || 'Unknown Item';

    if (!match) {
      missingSkuItems.push(name);
      return;
    }

    const pInfo = effectiveProductInfoMap!.get(match.productId);
    if (!pInfo) {
      missingSkuItems.push(name);
      return;
    }

    if (pInfo.productType === 'combo') {
      // Check child components for stock
      const childOut = pInfo.comboItems.some((ci: any) => {
        const stock = ci.variant
          ? ci.variant.InventoryItem.reduce((acc: number, i: any) => acc + i.quantity, 0)
          : ci.child.InventoryItem.reduce((acc: number, i: any) => acc + i.quantity, 0);
        return stock <= 0;
      });
      if (childOut) outOfStockItems.push(name);
    } else {
      // Check simple product or specific variant for stock
      const variant = match.variantId
        ? pInfo.variants.find((v: any) => v.id === match.variantId)
        : pInfo.variants.find((v: any) => v.sku?.trim().toLowerCase() === skuKey);

      const stock = variant
        ? variant.InventoryItem.reduce((acc: number, i: any) => acc + i.quantity, 0)
        : pInfo.InventoryItem.reduce((acc: number, i: any) => acc + i.quantity, 0);

      if (stock <= 0) outOfStockItems.push(name);
    }
  });

  const anyMissing = missingSkuItems.length > 0;
  const anyOutOfStock = outOfStockItems.length > 0;
  const finalStatus: 'New' | 'Draft' = (anyMissing || anyOutOfStock || lineItems.length === 0) ? 'Draft' : 'New';

  let draftReason = '';
  if (anyMissing) {
    draftReason = `Missing SKUs: ${missingSkuItems.join(', ')}`;
  } else if (anyOutOfStock) {
    draftReason = `Out of stock: ${outOfStockItems.join(', ')}`;
  } else if (lineItems.length === 0) {
    draftReason = 'No line items found in order.';
  }
  const sourceBusinessName = integration.business?.name || 'Unknown Business';
  const sourceStoreLabel = integration.storeName || integration.storeUrl || 'Unknown Store';
  const importLogContext = `Business: ${sourceBusinessName} | Store: ${sourceStoreLabel}`;

  const data = {
    id: orderId,
    customerName,
    customerEmail,
    customerPhone: customer.phone,
    platform: inferPlatformFromUrl(wo.landingPage || wo.meta_data?.find?.((m: any) => m.key === 'landingPage')?.value),
    source: 'woo',
    date: new Date(wo.date_created || Date.now()),
    status: finalStatus as any,
    total,
    shipping,
    discount,
    customerNote: wo.customer_note || '',
    businessId: integration.businessId,
    businessName: integration.business?.name || undefined,
    businessLogo: integration.business?.logo || undefined,
    paymentMethod,
    paidAmount: 0,
    shippingAddress: {
      ...normalizedAddress,
    },
    rawPayload: wo,
    ipHash,
    updatedAt: new Date(),
    statusUpdatedAt: new Date(),
    OrderLog: {
      create: {
        title: 'Imported',
        description: draftReason
          ? `Order imported as Draft. Reason: ${draftReason} | ${importLogContext}`
          : `Order imported from Woo store ${sourceStoreLabel} | ${importLogContext}`,
        user: 'System',
      },
    },
  };

  const result = await prisma.$transaction(async tx => {
    const existing = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, status: true },
    });

    const baseOrderData = {
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      customerPhone: data.customerPhone,
      platform: data.platform,
      status: data.status as any,
      total: data.total,
      shipping: data.shipping,
      discount: data.discount,
      paymentMethod: data.paymentMethod,
      paidAmount: data.paidAmount,
      businessId: data.businessId,
      businessName: data.businessName,
      businessLogo: data.businessLogo,
      shippingAddress: data.shippingAddress,
      rawPayload: data.rawPayload,
    };

    let upserted: any;
    if (existing) {
      const numbering = existing.orderNumber ? null : await generateOrderNumber(tx, data.date);
      const statusBefore = String(existing.status || '');
      const statusAfter = String(baseOrderData.status || '');
      const statusChanged = Boolean(statusBefore && statusAfter && statusBefore !== statusAfter);
      const updatePayload: any = {
        ...baseOrderData,
        ...(numbering || {}),
      };
      if (statusChanged) {
        updatePayload.statusUpdatedAt = new Date();
        updatePayload.OrderLog = {
          create: {
            title: statusAfter,
            description: `Status: ${statusBefore} -> ${statusAfter} | Source: Woo Sync`,
            user: 'Woo Sync',
          },
        };
      }
      upserted = await tx.order.update({
        where: { id: orderId },
        data: updatePayload as any,
      });
    } else {
      const numbering = await generateOrderNumber(tx, data.date);
      upserted = await tx.order.create({
        data: {
          ...data,
          ...numbering,
        } as any,
      });
    }

    // Rebuild order products based on SKU matches
    await tx.orderProduct.deleteMany({ where: { orderId } });
    const productCreates = lineItems
      .map((li: any) => {
        const rawSku = (li.sku || '').trim();
        const skuKey = rawSku.toLowerCase();
        const match = effectiveSkuMap.get(skuKey);
        const productId = match?.productId;
        const quantity = Number(li.quantity || 0);
        if (!productId || quantity <= 0) return null;
        const productInfo = effectiveProductInfoMap.get(productId);
        const lineTotal = parseFloat(li.total || li.subtotal || '0') || 0;
        const unitPrice = quantity > 0 ? lineTotal / quantity : lineTotal;
        const variant = match?.variantId
          ? productInfo?.variants?.find((v: any) => v.id === match?.variantId)
          : productInfo?.variants?.find((v: any) => v.sku?.toLowerCase() === skuKey);

        let variantId = match?.variantId;
        if (!variantId && variant) variantId = variant.id;

        // Site discount logic
        // Keep the invariant: lineNet = (price * quantity) - siteDiscount
        // where `price` is the effective list/sale unit price.
        let siteDiscount = 0;
        let componentBreakdown: any = null;
        let effectivePrice = unitPrice;

        if (productInfo?.productType === 'combo' && productInfo.comboItems?.length) {
          const comboListPrice = productInfo.salePrice ?? productInfo.price ?? 0;
          const comboGross = comboListPrice * quantity;
          if (comboGross >= lineTotal) {
            effectivePrice = comboListPrice;
            siteDiscount = comboGross - lineTotal;
          } else {
            effectivePrice = unitPrice;
            siteDiscount = 0;
          }

          componentBreakdown = productInfo.comboItems.map((comp: any) => ({
            productId: comp.child.id,
            sku: comp.child.sku,
            name: comp.child.name,
            unitPrice: comp.child.salePrice ?? comp.child.price ?? 0,
            quantity,
          }));
        } else {
          effectivePrice = (() => {
            if (variant && variant.salePrice !== null && variant.salePrice !== undefined) return Number(variant.salePrice);
            if (productInfo?.salePrice !== null && productInfo?.salePrice !== undefined) return Number(productInfo.salePrice);
            return Number(variant?.price ?? productInfo?.price ?? unitPrice);
          })();
          const diff = Math.max(effectivePrice - unitPrice, 0);
          siteDiscount = diff * quantity;
        }

        return {
          orderId,
          productId,
          sku: rawSku,
          variantId,
          quantity,
          price: effectivePrice,
          siteDiscount,
          componentBreakdown,
          updatedAt: new Date(),
        };
      })
      .filter(Boolean) as Array<any>;

    if (productCreates.length) {
      await tx.orderProduct.createMany({ data: productCreates });
    }

    // Handle stock reservation if imported as 'New' and not already reserved
    // Skip reservation in 'publish' mode - stock is managed by isPublished flag
    if (upserted.status === 'New' && !upserted.isStockReserved) {
      const mode = await getStockSyncMode();
      if (mode !== 'publish') {
        const finalOrder = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            products: {
              include: {
                product: {
                  include: {
                    variants: true,
                    comboItems: { include: { child: { include: { variants: true } } } }
                  }
                }
              }
            }
          }
        });
        if (finalOrder) {
          console.log('[STOCK_RESERVE] Creating reservation for Woo Sync order', orderId);
          await handleStockReservation(tx, finalOrder, 'System');
          await tx.order.update({ where: { id: orderId }, data: { isStockReserved: true } });
        }
      } else {
        console.log('[STOCK_RESERVE_SKIP] Publish mode active, skipping reservation for Woo order', orderId);
      }
    }

    return upserted;
  });

  // Immediately push Woo status to hold so it won't re-import as processing
  await pushHoldWithRetry({
    storeUrl: integration.storeUrl,
    consumerKey: integration.consumerKey,
    consumerSecret: integration.consumerSecret,
    externalOrderId: String(wo.id),
    integrationId: integration.id,
    orderId,
    storeName: integration.storeName || integration.storeUrl,
  });
  await closeOpenIncompleteLeadsByPhone(normalizedPhoneValue);

  // --- UTM-based Campaign Auto-Attribution (fire-and-forget, never blocks) ---
  if (orderId) {
    await tryAutoUtmAttribution({
        orderId,
        payload: wo,
        integrationBusinessId: integration?.businessId
    });
  }

  return { action: 'imported', orderId, created: result.createdAt.getTime() === result.updatedAt.getTime() };
}

/**
 * Process a batch of Woo orders with shared SKU and product info maps.
 */
export async function syncWooOrdersBatch(batch: WooOrder[], integration: any) {
  const result = {
    fetched: batch.length,
    imported: 0,
    skipped: 0,
    failed: 0,
    failedIds: [] as string[],
  };

  const allSkus = Array.from(new Set(batch.flatMap(wo =>
    (Array.isArray(wo.line_items) ? wo.line_items : [])
      .map((li: any) => (li.sku || '').trim())
      .filter(Boolean)
  )));

  const skuMap = await resolveSkuMap(allSkus);
  const productIds = Array.from(new Set(Array.from(skuMap.values()).map(v => v.productId)));

  const productInfos = productIds.length
    ? await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: {
        variants: { include: { InventoryItem: true } },
        comboItems: {
          include: {
            child: { include: { InventoryItem: true } },
            variant: { include: { InventoryItem: true } }
          }
        },
        InventoryItem: true,
      },
    })
    : [];

  const productInfoMap = new Map(productInfos.map(p => [p.id, p]));

  for (const wo of batch) {
    try {
      const syncResult = await syncOneWooOrder(wo, integration, skuMap, productInfoMap);
      if (syncResult.action === 'imported') {
        result.imported += 1;
      } else if (syncResult.action === 'skipped') {
        result.skipped += 1;
      }
    } catch (err: any) {
      result.failed += 1;
      result.failedIds.push(String(wo.id));
      const errMsg = `[WOO_BATCH_ITEM_FAIL] Order ${wo.id}: ${err?.message || err}\nStack: ${err?.stack || 'No stack'}\n\n`;
      console.error(errMsg);
      const path = require('path');
      const errorLogPath = path.join(process.cwd(), 'woo-sync-errors.log');
      try {
        require('fs').appendFileSync(errorLogPath, `${new Date().toISOString()} ${errMsg}`);
      } catch (logErr) {
        console.warn('[WOO_SYNC_LOG_FAIL]', logErr);
      }
    }
  }

  return result;
}

export async function importWooOrders(
  integrationId: string,
  sinceDate?: string,
  days?: number,
  statusFilter?: string,
  forceInline?: boolean,
  singlePage?: number, // If provided, only process this specific page and return metadata (for chunked UI sync)
) {
  const integration = await prisma.wooCommerceIntegration.findUnique({
    where: { id: integrationId },
    include: { business: true },
  });
  if (!integration) throw new Error('Integration not found');

  if (await isCircuitOpen(integration.id)) {
    const err: any = new Error('WOO_CIRCUIT_OPEN');
    err.code = 'WOO_CIRCUIT_OPEN';
    throw err;
  }

  return withWooIntegrationLock(integration.id, async () => {
    // Normalize store URL to prevent 500s from missing protocol
    let normalizedStoreUrl: string;
    try {
      normalizedStoreUrl = normalizeWooStoreUrl(integration.storeUrl);
    } catch (urlErr: any) {
      const err: any = new Error(
        `Invalid Woo store URL for integration "${integration.storeName || integration.id}": ${urlErr.message}`
      );
      err.code = 'WOO_INVALID_STORE_URL';
      throw err;
    }

    const base = new URL('/wp-json/wc/v3/orders', normalizedStoreUrl);
    base.searchParams.set('consumer_key', integration.consumerKey);
    base.searchParams.set('consumer_secret', integration.consumerSecret);
    base.searchParams.set('per_page', '100');
    const effectiveStatusFilter = normalizeWooImportStatus(statusFilter);
    base.searchParams.set('status', effectiveStatusFilter);
    console.log(`[WOO_SYNC] Integration: ${normalizedStoreUrl}, status=${effectiveStatusFilter}`);

    let finalSince = sinceDate;
    if (days) {
      const d = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
      d.setHours(0, 0, 0, 0);
      finalSince = d.toISOString();
    } else if (!finalSince) {
      const d = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
      d.setHours(0, 0, 0, 0);
      finalSince = d.toISOString();
    }

    console.log(`[WOO_SYNC] Integration: ${integration.storeUrl}, FinalSince: ${finalSince}, Days: ${days ?? 'default(30)'}, Status: ${effectiveStatusFilter}, SinglePage: ${singlePage ?? 'none (full loop)'}`);
    base.searchParams.set('after', finalSince);

    // -----------------------------------------------------------------------
    // SINGLE-PAGE MODE: Process only one specific page and return metadata.
    // Used by the frontend chunked sync to avoid HTTP timeouts on large stores.
    // -----------------------------------------------------------------------
    if (singlePage !== undefined && singlePage >= 1) {
      // Only run webhook ensure on the first page to avoid unnecessary overhead
      if (singlePage === 1) {
        await ensureWooWebhook(integration);
      }

      await wooRateLimit(integration.id);
      base.searchParams.set('page', String(singlePage));
      console.log(`[WOO_SYNC_PAGE] Fetching page ${singlePage}, status=${effectiveStatusFilter}`);

      try {
        const res = await fetch(base.toString());
        if (!res.ok) {
          const text = await res.text();
          console.error(`[WOO_SYNC_PAGE] Fetch failed (${res.status}): ${text}`);
          await recordWooFailure(integration.id);
          throw new Error(`Woo fetch failed (${res.status}): ${text}`);
        }

        const totalPagesHeader = Number(res.headers.get('x-wp-totalpages') || '0');
        const totalOrders = Number(res.headers.get('x-wp-total') || '0');
        const totalPages = Number.isFinite(totalPagesHeader) && totalPagesHeader > 0 ? totalPagesHeader : 1;

        const batch: WooOrder[] = await res.json();
        if (!Array.isArray(batch)) throw new Error('Woo response is not an array');

        console.log(`[WOO_SYNC_PAGE] Page ${singlePage}/${totalPages}: received ${batch.length} orders.`);
        await clearWooFailures(integration.id);

        const pageSummary = {
          page: singlePage,
          totalPages,
          totalOrders,
          hasMore: batch.length > 0 && singlePage < totalPages,
          fetched: batch.length,
          queued: 0,
          imported: 0,
          skipped: 0,
          failed: 0,
          failedIds: [] as string[],
        };

        if (batch.length > 0) {
          const isQueued = !forceInline && await enqueueStockSyncBatchJob({ batch, integration });
          if (isQueued) {
            pageSummary.queued = batch.length;
          } else {
            console.log(`[WOO_SYNC_PAGE] ${forceInline ? 'forceInline.' : 'Queue failed.'} Processing ${batch.length} orders inline.`);
            const batchResult = await syncWooOrdersBatch(batch, integration);
            pageSummary.imported = batchResult.imported;
            pageSummary.skipped = batchResult.skipped;
            pageSummary.failed = batchResult.failed;
            pageSummary.failedIds = batchResult.failedIds;
          }
        }

        return { ...pageSummary, updated: pageSummary.imported, created: 0 };
      } catch (err) {
        if ((err as any).code === 'WOO_CIRCUIT_OPEN') throw err;
        await recordWooFailure(integration.id);
        throw err;
      }
    }

    // -----------------------------------------------------------------------
    // FULL LOOP MODE (original behavior): Processes all pages in one request.
    // Used by auto-sync / cron / queue workers.
    // -----------------------------------------------------------------------
    await ensureWooWebhook(integration);

    let page = 1;
    let totalPages: number | null = null;
    const MAX_PAGES_SAFETY = 200;

    const summary = {
      fetched: 0,
      queued: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      failedIds: [] as string[],
      fetchedPages: 0,
      totalPages: null as number | null,
    };

    while (page <= MAX_PAGES_SAFETY) {
      if (totalPages !== null && page > totalPages) break;
      await wooRateLimit(integration.id);
      base.searchParams.set('page', String(page));

      console.log(`[WOO_SYNC_FETCH] Page ${page}, status=${effectiveStatusFilter}`);

      try {
        const res = await fetch(base.toString());
        if (!res.ok) {
          const text = await res.text();
          console.error(`[WOO_SYNC] Fetch failed (${res.status}): ${text}`);
          await recordWooFailure(integration.id);
          if (res.status === 429 || res.status >= 500) {
            await new Promise(r => setTimeout(r, 1000 * page));
          }
          throw new Error(`Woo fetch failed (${res.status}): ${text}`);
        }

        const totalPagesHeader = Number(res.headers.get('x-wp-totalpages') || '0');
        if (Number.isFinite(totalPagesHeader) && totalPagesHeader > 0) {
          totalPages = totalPagesHeader;
          summary.totalPages = totalPages;
        }

        const batch: WooOrder[] = await res.json();
        if (!Array.isArray(batch)) {
          throw new Error('Woo response is not an array');
        }
        console.error(`[WOO_SYNC_BATCH_URGENT] Page ${page} received ${batch.length} orders.`);

        await clearWooFailures(integration.id);

        if (!batch.length) break;
        summary.fetched += batch.length;

        // Use batch processing instead of individual order jobs
        const isQueued = !forceInline && await enqueueStockSyncBatchJob({ batch, integration });
        if (isQueued) {
          summary.queued += batch.length;
        } else {
          console.log(`[WOO_IMPORT_SYNC_FALLBACK] ${forceInline ? 'forceInline enabled.' : 'Queue failed.'} Processing batch of ${batch.length} sync.`);
          const batchResult = await syncWooOrdersBatch(batch, integration);
          summary.imported += batchResult.imported;
          summary.skipped += batchResult.skipped;
          summary.failed += batchResult.failed;
          summary.failedIds.push(...batchResult.failedIds);
        }

        page += 1;
        summary.fetchedPages = page - 1;

        if (page > MAX_PAGES_SAFETY) {
          console.warn(`[WOO_SYNC_SAFETY_LIMIT] Reached max page safety limit (${MAX_PAGES_SAFETY}) for integration ${integration.id}`);
        }
      } catch (err) {
        if ((err as any).code === 'WOO_CIRCUIT_OPEN') throw err;
        await recordWooFailure(integration.id);
        throw err;
      }
    }
    return { ...summary, updated: summary.imported, created: 0 };
  });
}

export async function runWooProcessingFallbackReconciliation() {
  const integrations = await prisma.wooCommerceIntegration.findMany({
    where: { status: 'Active', autoSyncEnabled: true },
    select: { id: true, autoSyncEnabled: true },
  });
  const results: Array<{ integrationId: string; ok: boolean; error?: string }> = [];
  for (const integration of integrations) {
    // Skip integrations where auto-sync has been disabled
    if (integration.autoSyncEnabled === false) {
      console.log(`[WOO_AUTOSYNC_DISABLED] Skipping fallback reconciliation for integration ${integration.id} (autoSyncEnabled=false)`);
      results.push({ integrationId: integration.id, ok: false, error: 'Auto-sync disabled' });
      continue;
    }
    try {
      if (await isCircuitOpen(integration.id)) {
        console.log(`[WOO_CB_OPEN_SKIP] Skipping fallback for integration ${integration.id}`);
        results.push({ integrationId: integration.id, ok: false, error: 'Circuit Open' });
        continue;
      }
      await importWooOrders(integration.id, undefined, 1, 'processing');
      results.push({ integrationId: integration.id, ok: true });
    } catch (err: any) {
      console.error('[WOO_PROCESSING_RECONCILE_ERROR]', integration.id, err);
      results.push({ integrationId: integration.id, ok: false, error: err?.message || 'Failed' });
    }
  }
  return { ok: true, results };
}
async function pushHoldWithRetry(params: {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  externalOrderId: string;
  integrationId?: string;
  orderId?: string;
  storeName?: string;
}) {
  const maxAttempts = 3;
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pushWooStatusUpdate({
        ...params,
        status: 'on-hold' as any,
      });
      return;
    } catch (err) {
      lastError = err;
      const delayMs = 300 * attempt;
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
  console.error('[WOO_HOLD_PUSH_ERROR]', lastError);
  await recordWebhookFailure({
    source: 'woo-hold-push',
    integrationId: params.integrationId,
    orderId: params.orderId,
    externalOrderId: params.externalOrderId,
    payload: { storeUrl: params.storeUrl },
    error: lastError,
  });
  if (params.integrationId) {
    await notifyAdmins(
      'Woo on-hold push failed',
      `Failed to push on-hold for Woo order ${params.externalOrderId}${params.storeName ? ` (${params.storeName})` : ''}.`,
      params.orderId ? `/dashboard/orders/${params.orderId}` : '/dashboard/orders',
      'AlertCircle',
    );
  }
}
