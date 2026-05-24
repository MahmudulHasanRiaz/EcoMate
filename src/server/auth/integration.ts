import prisma from "@/lib/prisma";
import { NextRequest } from "next/server";
import crypto from "crypto";

export type ValidatedIntegration = {
  id: string;
  businessId: string;
  storeName: string;
  storeUrl: string;
  platform: string;
  apiKey: string | null;
  consumerKey: string | null;
  consumerSecret: string | null;
  callbackUrl: string | null;
  autoSyncEnabled: boolean;
  incompleteEnabled: boolean;
  restrictionEnabled: boolean;
  restrictionScope: string | null;
  restrictionDurationType: string;
  restrictionDurationValue: number | null;
  restrictionMessage: string | null;
  restrictionSupportPhone: string | null;
  webhookSecret: string | null;
  webhookUrl: string | null;
  status: string;
  business: { id: string; name: string } | null;
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const CACHE_PREFIX = "integration:apikey:";

async function getRedis() {
  try {
    const { getRedisClient } = await import("@/server/queues/redis");
    return getRedisClient();
  } catch {
    return null;
  }
}

function generateApiKey(): string {
  return "sk_" + crypto.randomBytes(24).toString("hex");
}

export async function validateIntegrationApiKey(
  req: NextRequest
): Promise<ValidatedIntegration | null> {
  let token: string | null = null;

  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  }

  if (!token) {
    token = req.nextUrl.searchParams.get("apiKey");
  }

  if (!token) return null;

  // Redis cache lookup
  const redis = await getRedis();
  const cacheKey = `${CACHE_PREFIX}${token}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as ValidatedIntegration;
    } catch { /* fall through to DB */ }
  }

  let integration;
  try {
    integration = await prisma.wooCommerceIntegration.findUnique({
      where: { apiKey: token },
      include: { business: true },
    });
  } catch (e: any) {
    console.error("[INTEGRATION_AUTH_DB_ERR]", e);
    return null;
  }

  if (!integration) return null;

  const result: ValidatedIntegration = {
    id: integration.id,
    businessId: integration.businessId,
    storeName: integration.storeName,
    storeUrl: integration.storeUrl,
    platform: (integration as any).platform || "woocommerce",
    apiKey: integration.apiKey,
    consumerKey: integration.consumerKey,
    consumerSecret: integration.consumerSecret,
    callbackUrl: (integration as any).callbackUrl || null,
    autoSyncEnabled: integration.autoSyncEnabled,
    incompleteEnabled: integration.incompleteEnabled,
    restrictionEnabled: integration.restrictionEnabled,
    restrictionScope: integration.restrictionScope,
    restrictionDurationType: integration.restrictionDurationType,
    restrictionDurationValue: integration.restrictionDurationValue,
    restrictionMessage: integration.restrictionMessage,
    restrictionSupportPhone: integration.restrictionSupportPhone,
    webhookSecret: integration.webhookSecret,
    webhookUrl: integration.webhookUrl,
    status: integration.status,
    business: integration.business
      ? { id: integration.business.id, name: integration.business.name }
      : null,
  };

  // Cache in Redis
  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(result), "PX", CACHE_TTL_MS);
    } catch { /* silent */ }
  }

  return result;
}

export async function invalidateApiKeyCache(apiKey: string): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    try {
      await redis.del(`${CACHE_PREFIX}${apiKey}`);
    } catch { /* silent */ }
  }
}

export async function invalidateIntegrationCaches(
  integrationId: string,
  oldApiKey?: string | null
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.del(`woo:integration:${integrationId}`);
    if (oldApiKey) await redis.del(`${CACHE_PREFIX}${oldApiKey}`);
  } catch { /* silent */ }
}

export { generateApiKey };
