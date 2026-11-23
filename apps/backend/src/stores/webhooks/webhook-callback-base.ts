/**
 * Webhook callback base — shared resolver for provider webhook
 * registration (Phase 9 webhook lifecycle, G-04).
 *
 * The delivery URL registered with WooCommerce/Shopify/the custom bridge
 * is `{PUBLIC_API_BASE_URL}/api/webhooks/stores/<slug>/<storeId>` — the
 * API host, because Caddy routes `/api/webhooks/stores/*` to the backend
 * only on the api host block (a tenant-host URL would 404).
 *
 * A relative or http base is doomed (Shopify 422s "address is invalid",
 * Woo refuses non-https delivery URLs on live stores) — fail loudly
 * here instead of registering garbage. The VALUE is set at deploy
 * (`.env.example` + compose + Portainer template); this module only
 * resolves + validates it.
 */
import { BadRequestException } from '@nestjs/common';

/**
 * Resolve the public callback base for provider webhook registration.
 * Exported for unit tests (re-exported by `stores.controller.ts`, the
 * historical import path).
 */
export function resolveWebhookCallbackBase(
  env: Record<string, string | undefined> = process.env,
): string {
  const base = String(env.PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) {
    throw new BadRequestException(
      'Webhook callback base URL is not configured (PUBLIC_API_BASE_URL must be an https:// URL)',
    );
  }
  return base;
}
