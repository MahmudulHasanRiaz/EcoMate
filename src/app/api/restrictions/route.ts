
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createHash } from "crypto";
import { normalizeBdPhone } from "@/lib/utils/phone-utils";

function hashIp(ip: string): string {
    return createHash('sha256').update(ip).digest('hex');
}

export async function GET(req: NextRequest) {
    try {
        const { requirePermission } = await import('@/server/auth/guards');
        await requirePermission('orders', 'read');

        const { searchParams } = new URL(req.url);
        const targetHash = searchParams.get('targetHash');
        let targetType = searchParams.get('targetType');
        const targetValue = searchParams.get('targetValue');
        const integrationId = searchParams.get('integrationId');

        let hashToSearch = targetHash;

        if (targetValue && targetType) {
            if (targetType === 'IP') {
                hashToSearch = hashIp(targetValue);
            } else if (targetType === 'IP_HASH') {
                hashToSearch = targetValue;
                targetType = 'IP';
            } else if (targetType === 'PHONE') {
                const norm = normalizeBdPhone(targetValue);
                if (norm) hashToSearch = norm;
            }
        }

        if (hashToSearch) {
            const restrictions = await prisma.orderRestriction.findMany({
                where: {
                    targetHash: hashToSearch,
                    expiresAt: { gte: new Date() }, // Only active restrictions
                    ...(targetType ? { targetType } : {}),
                    ...(integrationId ? {
                        OR: [
                            { integrationId: integrationId },
                            { scope: 'GLOBAL' }
                        ]
                    } : {})
                }
            });
            return NextResponse.json(restrictions);
        }

        const list = await prisma.orderRestriction.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50
        });
        return NextResponse.json(list);
    } catch (e) {
        console.error('[API_RESTRICTION_GET_ERROR]', e);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const { requirePermission } = await import('@/server/auth/guards');
        const user = await requirePermission('orders', 'create');

        const body = await req.json();
        let { targetType, targetValue, durationDays, scope, integrationId, businessId } = body;

        if (!targetValue || !targetType) {
            return NextResponse.json({ error: "Target value and type are required" }, { status: 400 });
        }

        let targetHash = targetValue;

        if (targetType === 'IP') {
            targetHash = hashIp(targetValue);
        } else if (targetType === 'IP_HASH') {
            // Already hashed
            targetHash = targetValue;
            targetType = 'IP';
        } else if (targetType === 'PHONE') {
            const norm = normalizeBdPhone(targetValue);
            if (!norm) return NextResponse.json({ error: "Invalid phone format" }, { status: 400 });
            targetHash = norm;
        } else {
            return NextResponse.json({ error: "Invalid target type" }, { status: 400 });
        }

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + (durationDays || 3650)); // Default 10 years

        // Resolve message and supportPhone
        let message = body.message;
        let supportPhone = "";

        // If targetType is IP, force scope to GLOBAL
        if (targetType === 'IP') {
            scope = 'GLOBAL';
        }

        // P47cb: Strict validation for SITE scope on PHONE
        if (targetType === 'PHONE' && scope === 'SITE') {
            if (!integrationId) {
                return NextResponse.json({ error: "integrationId is required for SITE phone restriction" }, { status: 400 });
            }
            if (!businessId) {
                return NextResponse.json({ error: "businessId is required for SITE phone restriction" }, { status: 400 });
            }
        }

        if (integrationId) {
            const integration = await prisma.wooCommerceIntegration.findUnique({ where: { id: integrationId } });
            if (!integration) {
                return NextResponse.json({ error: "Integration not found" }, { status: 404 });
            }

            // P47cb: SITE consistency guard and canonicalization
            if (scope === 'SITE') {
                if (businessId && integration.businessId !== businessId) {
                    return NextResponse.json({ error: "Selected site does not belong to provided business context" }, { status: 400 });
                }
                // Canonicalize business context
                businessId = integration.businessId;
            }

            if (integration) {
                if (!message && integration.restrictionMessage) message = integration.restrictionMessage;
                if (integration.restrictionSupportPhone) supportPhone = integration.restrictionSupportPhone;
                else if (integration.supportPhone) supportPhone = integration.supportPhone;
            }
        }

        if (!message) message = "You are restricted from placing orders.";

        if (!supportPhone && businessId) {
            const business = await prisma.business.findUnique({ where: { id: businessId } });
            if (business?.phone) supportPhone = business.phone;
        }

        if (!supportPhone) {
            try {
                const general = await prisma.appSetting.findUnique({ where: { key: 'general' } });
                const settings = general?.value as any;
                if (settings?.supportPhone) supportPhone = settings.supportPhone;
                else if (settings?.phone) supportPhone = settings.phone;
            } catch { }
        }

        const restriction = await prisma.orderRestriction.create({
            data: {
                targetType,
                targetHash,
                scope: scope || 'SITE',
                integrationId: integrationId || null,
                businessId: businessId || null,
                message,
                supportPhone: supportPhone || null,
                expiresAt,
                createdByStaffId: user.id,
            }
        });

        return NextResponse.json(restriction);
    } catch (e: any) {
        if (e.code === 'P2002') {
            return NextResponse.json({ error: "Already blocked" }, { status: 409 });
        }
        console.error('[API_RESTRICTION_CREATE_ERROR]', e);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const { requirePermission } = await import('@/server/auth/guards');
        await requirePermission('orders', 'delete');

        const { searchParams } = new URL(req.url);
        const targetHash = searchParams.get('targetHash');
        const targetType = searchParams.get('targetType');
        const targetValue = searchParams.get('targetValue');
        const scope = searchParams.get('scope');
        const integrationId = searchParams.get('integrationId');
        const allScopes = searchParams.get('allScopes') === 'true';

        // Case 1: Delete by targetType + targetValue (New bulk delete for phone)
        if (targetType === 'PHONE' && targetValue && allScopes) {
            const norm = normalizeBdPhone(targetValue);
            if (!norm) {
                return NextResponse.json({ error: "Invalid phone format" }, { status: 400 });
            }

            const result = await prisma.orderRestriction.deleteMany({
                where: {
                    targetType: 'PHONE',
                    targetHash: norm
                    // details: intentionally ignore scope/integrationId to clear EVERYTHING for this phone
                }
            });

            if (result.count === 0) {
                // Idempotent success: if already unblocked, return success with 0 count
                return NextResponse.json({ success: true, deletedCount: 0 });
            }

            return NextResponse.json({ success: true, deletedCount: result.count });
        }

        // Case 2: Delete by specific hash (Legacy/IP support)
        if (!targetHash) {
            return NextResponse.json({ error: "Target hash required" }, { status: 400 });
        }

        const result = await prisma.orderRestriction.deleteMany({
            where: {
                targetHash,
                ...(scope ? { scope } : {}),
                ...(integrationId ? { integrationId } : {})
            }
        });

        return NextResponse.json({ success: true, deletedCount: result.count });
    } catch (e) {
        console.error('[API_RESTRICTION_DELETE_ERROR]', e);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
