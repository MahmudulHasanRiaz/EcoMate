import { NextRequest } from 'next/server';
import { enforcePermission } from '@/lib/security';
import { getWebhookFailureById } from '@/server/modules/webhook-failures';
import { apiSuccess, apiServerError, apiError } from '@/lib/error';
import prisma from '@/lib/prisma';
import { processWooWebhookPayload } from '@/server/modules/woo/webhook-processor';
import { handlePathaoWebhook } from '@/server/modules/courier/pathao';

export const dynamic = 'force-dynamic';

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { allowed, error: authError } = await enforcePermission('integrations', 'create');
        if (!allowed) return authError;

        const { id } = await params;
        const failure = await getWebhookFailureById(id);

        if (!failure) {
            return apiError('Failure record not found', 404);
        }

        const source = failure.source || '';
        const payload = failure.payload;

        if (!payload) {
            return apiError('No payload found in failure record', 400);
        }

        let result: any;

        if (source.startsWith('woo')) {
            if (!failure.integrationId) {
                return apiError('Missing integrationId for Woo replay', 400);
            }

            const integration = await prisma.wooCommerceIntegration.findUnique({
                where: { id: failure.integrationId },
                include: { business: true },
            });

            if (!integration) {
                return apiError('Integration not found for Woo replay', 404);
            }

            const externalOrderId = failure.externalOrderId || (payload as any)?.id?.toString();
            if (!externalOrderId) {
                return apiError('Could not determine externalOrderId for Woo replay', 400);
            }

            const internalOrderId = failure.orderId || `woo-${integration.id}-${externalOrderId}`;

            result = await processWooWebhookPayload(
                {
                    id: integration.id,
                    storeUrl: integration.storeUrl,
                    storeName: integration.storeName,
                    consumerKey: integration.consumerKey,
                    consumerSecret: integration.consumerSecret,
                    webhookSecret: integration.webhookSecret,
                    businessId: integration.businessId,
                    business: integration.business ? { id: integration.business.id, name: integration.business.name } : null,
                },
                payload,
                externalOrderId,
                internalOrderId
            );
        } else if (source.startsWith('courier-pathao') || source.startsWith('pathao')) {
            result = await handlePathaoWebhook(payload, undefined);
        } else {
            return apiError(`Replay not supported for source: ${source}`, 400);
        }

        // Update failure record with a note about the replay
        await prisma.webhookFailure.update({
            where: { id },
            data: {
                error: `${failure.error}\n\n[REPLAY_ATTEMPTED]: ${new Date().toISOString()} - Result: ${JSON.stringify(result)}`,
            },
        });

        return apiSuccess(result, 'Replay successful');
    } catch (error: any) {
        console.error('[WEBHOOK_REPLAY_ERROR]', error);
        return apiServerError(error);
    }
}
