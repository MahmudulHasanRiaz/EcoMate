import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { apiError, apiSuccess, apiServerError } from '@/lib/error';
import { processWooWebhookPayload } from '@/server/modules/woo/webhook-processor';
import { recordWebhookFailure } from '@/server/modules/webhook-failures';
import { ensureWooWebhook } from '@/server/modules/woo-sync';

export const revalidate = 0;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Auto-heal cooldown ──────────────────────────────────────────────────────
// Prevents repeated probes (signed or unsigned) from triggering continuous
// webhook recreate storms. Per-integration, per-reason, 10 min TTL.
const HEAL_COOLDOWN_MS = 10 * 60 * 1000;
const healCooldownMap = new Map<string, number>(); // `${integrationId}:${reason}` → timestamp

async function isHealCoolingDown(integrationId: string, reason: string): Promise<boolean> {
    const key = `${integrationId}:${reason}`;
    // Try Redis first
    try {
        const { getRedisClient } = await import('@/server/queues/redis');
        const redis = getRedisClient();
        if (redis) {
            const v = await redis.get(`woo:heal:cooldown:${key}`);
            return Boolean(v);
        }
    } catch { /* fall through to memory */ }
    const last = healCooldownMap.get(key);
    return Boolean(last && Date.now() - last < HEAL_COOLDOWN_MS);
}

async function markHealCooldown(integrationId: string, reason: string): Promise<void> {
    const key = `${integrationId}:${reason}`;
    healCooldownMap.set(key, Date.now());
    try {
        const { getRedisClient } = await import('@/server/queues/redis');
        const redis = getRedisClient();
        if (redis) {
            await redis.set(`woo:heal:cooldown:${key}`, '1', 'PX', HEAL_COOLDOWN_MS);
        }
    } catch { /* ignore */ }
}

// ── Woo-header gate ─────────────────────────────────────────────────────────
// A real Woo webhook MUST include at least one of these delivery-info headers.
// Generic scanners/probes will not have them.
function looksLikeRealWooRequest(req: NextRequest): boolean {
    return Boolean(
        req.headers.get('x-wc-webhook-topic') ||
        req.headers.get('x-wc-webhook-event') ||
        req.headers.get('x-wc-webhook-source')
    );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: integrationId } = await params;
    if (!integrationId) return apiError('Missing integration ID', 400);

    // ── Mandatory entry log ────────────────────────────────────────────────
    const signature = req.headers.get('x-wc-webhook-signature');
    const topic = req.headers.get('x-wc-webhook-topic') || '';
    const ua = (req.headers.get('user-agent') || '').slice(0, 60);
    console.log(`[WOO_WEBHOOK_HIT] ID=${integrationId} hasSignature=${Boolean(signature)} topic="${topic}" ua="${ua}"`);

    // ── Woo-header gate ────────────────────────────────────────────────────
    const isRealWoo = looksLikeRealWooRequest(req);

    try {
        const rawBody = await req.text();

        const integration = await prisma.wooCommerceIntegration.findUnique({
            where: { id: integrationId },
            include: { business: true },
        });

        if (!integration) {
            return apiError('Integration not found', 404);
        }

        if (integration.status !== 'Active') {
            return apiError('Integration is inactive', 403);
        }

        if ((integration as any).autoSyncEnabled === false) {
            console.log(`[WOO_WEBHOOK_IGNORED] ID=${integrationId} (autoSyncEnabled=false)`);
            return apiSuccess({ success: true, ignored: true, reason: 'auto-sync-disabled' });
        }

        // ── Missing secret ─────────────────────────────────────────────────
        if (!integration.webhookSecret) {
            console.error(`[WOO_WEBHOOK_CONFIG_FAIL] ID=${integrationId} Missing secret`);
            await recordWebhookFailure({
                source: 'woo-webhook-config',
                integrationId,
                error: 'Missing webhook secret',
                payload: { headers: Object.fromEntries(req.headers) },
            });
            if (isRealWoo && !(await isHealCoolingDown(integrationId, 'missing-secret'))) {
                await markHealCooldown(integrationId, 'missing-secret');
                ensureWooWebhook(integration, { forceRecreate: true, rotateSecret: true })
                    .catch(e => console.error('[WOO_AUTOHEAL_FAIL]', e));
            }
            return apiError('Unauthorized', 401);
        }

        // ── Missing signature ──────────────────────────────────────────────
        if (!signature) {
            if (!isRealWoo) {
                // Non-Woo probes may spoof user-agent. Ignore quietly to reduce noise.
                return apiSuccess({ success: true, ignored: true, reason: 'non-woo-unsigned' });
            }
            console.warn(`[WOO_WEBHOOK_SIG_MISSING] ID=${integrationId} isRealWoo=${isRealWoo}`);
            await recordWebhookFailure({
                source: 'woo-signature-missing',
                integrationId,
                error: 'Missing signature header',
                payload: { headers: Object.fromEntries(req.headers) },
            });
            // Only trigger heal if real Woo headers + cooldown allows.
            // Do NOT rotate secret — unknown if Woo knows current secret yet.
            if (isRealWoo && !(await isHealCoolingDown(integrationId, 'missing-signature'))) {
                await markHealCooldown(integrationId, 'missing-signature');
                ensureWooWebhook(integration, { forceRecreate: true, rotateSecret: false })
                    .catch(e => console.error('[WOO_AUTOHEAL_FAIL]', e));
            }
            return apiError('Unauthorized', 401);
        }

        // ── Signature verification (strict) ────────────────────────────────
        const computed = crypto
            .createHmac('sha256', integration.webhookSecret)
            .update(rawBody, 'utf8')
            .digest('base64');

        if (computed !== signature) {
            console.error(`[WOO_WEBHOOK_SIG_FAIL] ID=${integrationId} sig_match=false isRealWoo=${isRealWoo}`);
            await recordWebhookFailure({
                source: 'woo-signature-mismatch',
                integrationId,
                error: `Signature mismatch`,
                payload: { headers: Object.fromEntries(req.headers) },
            });
            // Rotate + recreate: secret may have drifted. Gate on Woo headers + cooldown.
            if (isRealWoo && !(await isHealCoolingDown(integrationId, 'sig-mismatch'))) {
                await markHealCooldown(integrationId, 'sig-mismatch');
                ensureWooWebhook(integration, { forceRecreate: true, rotateSecret: true })
                    .catch(e => console.error('[WOO_AUTOHEAL_FAIL]', e));
            }
            return apiError('Invalid signature', 401);
        }

        // ── Payload processing ─────────────────────────────────────────────
        let payload: any;
        try {
            payload = JSON.parse(rawBody);
        } catch (e) {
            return apiError('Invalid JSON', 400);
        }

        const externalOrderId = String(payload.id);
        const internalOrderId = `woo-${integration.id}-${externalOrderId}`;

        const result = await processWooWebhookPayload(integration, payload, externalOrderId, internalOrderId);

        return apiSuccess(result);
    } catch (err: any) {
        console.error('[WOO_WEBHOOK_ERROR]', err);
        await recordWebhookFailure({
            source: 'woo-webhook-route',
            integrationId,
            error: err,
        });
        return apiServerError(err);
    }
}
