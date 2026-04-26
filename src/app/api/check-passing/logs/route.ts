import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';
import { enforcePermission } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission('checkPassing', 'read');
    if (!allowed) return error;

    const source = req.nextUrl.searchParams.get('source') || '';
    const sourceId = req.nextUrl.searchParams.get('sourceId') || '';

    if (!source || !sourceId) {
      return apiError('source and sourceId are required.', 400);
    }

    const logs = await prisma.checkPassingLog.findMany({
      where: { source, sourceId },
      orderBy: { createdAt: 'desc' },
    });

    const data = logs.map((log) => ({
      id: log.id,
      source: log.source,
      sourceId: log.sourceId,
      previousStatus: log.previousStatus || null,
      newStatus: log.newStatus,
      note: log.note || null,
      userName: log.userName,
      userId: log.userId || null,
      createdAt: log.createdAt.toISOString(),
    }));

    return apiSuccess(data);
  } catch (error) {
    return apiServerError(error);
  }
}
