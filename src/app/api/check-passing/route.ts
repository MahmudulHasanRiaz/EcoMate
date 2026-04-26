import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError, apiServerError, apiSuccess } from '@/lib/error';
import { enforcePermission } from '@/lib/security';
import { CheckStatus, Prisma, CheckPassingSource } from '@prisma/client';
import { getActorDetails } from '@/server/utils/current-user';
import {
  buildCheckPassingItemFromPurchasePayment,
  buildCheckPassingItemFromExpense,
  buildCheckPassingItemFromStaffPayment,
  upsertCheckPassingItem
} from '@/server/modules/check-passing-items';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CheckPassingSourceLocal = 'Purchase' | 'Expense' | 'Staff' | 'CutoffSettlement';

const STATUS_VALUES = new Set<CheckStatus>(['Pending', 'Passed', 'Bounced', 'Cancelled']);
const toIso = (value?: Date | null) => (value ? value.toISOString() : '');

const decodeCursor = (cursor?: string | null) => {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed?.date || !parsed?.source || !parsed?.id) return null;
    return {
      date: new Date(parsed.date),
      source: String(parsed.source),
      id: String(parsed.id),
    };
  } catch {
    return null;
  }
};

const encodeCursor = (row: { date: Date; source: string; id: string }) =>
  Buffer.from(JSON.stringify({ date: row.date.toISOString(), source: row.source, id: row.id })).toString('base64');

const parseDateParam = (value: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

export async function GET(req: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission('checkPassing', 'read');
    if (!allowed) return error;

    const params = req.nextUrl.searchParams;
    const pageSize = Math.min(Math.max(Number(params.get('pageSize') || 100), 1), 200);
    const cursorStr = params.get('cursor'); // Encoded string
    const fromParam = parseDateParam(params.get('from'));
    const toParam = parseDateParam(params.get('to'));
    const status = params.get('status') as CheckStatus | null;
    const source = params.get('source') as CheckPassingSource | null;
    const search = params.get('search')?.trim() || '';

    const where: Prisma.CheckPassingItemWhereInput = {};
    if (fromParam) where.passingDate = { gte: fromParam };
    if (toParam) {
      where.passingDate = {
        ...(where.passingDate as object),
        lte: toParam
      };
    }
    if (status && STATUS_VALUES.has(status)) where.status = status;
    if (source) where.source = source as any;

    if (search) {
      where.OR = [
        { referenceLabel: { contains: search, mode: 'insensitive' } },
        { referenceId: { contains: search, mode: 'insensitive' } },
        { payee: { contains: search, mode: 'insensitive' } },
        { type: { contains: search, mode: 'insensitive' } },
        { checkNo: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Decoding cursor for Prisma
    // Our cursor is { date, source, id }. CheckPassingItem has @@index([passingDate, status]) but not typically (date, source, id) for sort.
    // However, if we sort by passingDate, then source, then id (or just id), we can use cursor.
    // Prisma native cursor requires a unique identifier or unique compound. id is unique.
    // If sorting by non-unique fields, we need to include them in orderBy and cursor.
    // CheckPassingItem has 'id' which is CUID and unique. But we want sort by date.

    // The previous implementation sorted by "passingDate" ASC, source ASC, id ASC.
    // We can replicate this.

    let cursorObj: { id: string } | undefined;
    if (cursorStr) {
      // We can just use ID if we assume the client sends the ID of the last item.
      // But wait, the previous `decodeCursor` returned { date, source, id } for manual SQL comparison.
      // With Prisma `cursor` based pagination on arbitrary sorts, we pass the cursor of the ID.
      const decoded = decodeCursor(cursorStr);
      if (decoded?.id) cursorObj = { id: decoded.id };
    }

    let items;
    try {
      items = await prisma.checkPassingItem.findMany({
        where,
        orderBy: [
          { passingDate: 'asc' },
          { source: 'asc' },
          { id: 'asc' }
        ],
        take: pageSize + 1,
        cursor: cursorObj,
        skip: cursorObj ? 1 : 0,
      });
    } catch (e) {
      // Handle "Record to validate cursor position not found"
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        console.warn('[API:GET_CHECK_PASSING] Invalid cursor (item likely deleted), resetting to first page.');
        items = await prisma.checkPassingItem.findMany({
          where,
          orderBy: [
            { passingDate: 'asc' },
            { source: 'asc' },
            { id: 'asc' }
          ],
          take: pageSize + 1,
        });
      } else {
        throw e;
      }
    }

    const hasMore = items.length > pageSize;
    const slice = hasMore ? items.slice(0, pageSize) : items;

    const mappedItems = slice.map((row) => ({
      id: row.sourceId, // Front-end expects the SOURCE ID (payment ID), NOT the CheckPassingItem ID? 
      // WAIT. The previous SQL selected `pp.id::text AS id`. That IS sourceId.
      // So we should return sourceId.
      // BUT, for updates/PATCH, it uses `id` from this list. 
      // The PATCH expects `id` to be PurchasePayment ID etc.
      // So yes, return `sourceId` as `id`.
      date: toIso(row.passingDate),
      amount: row.amount,
      status: row.status,
      checkNo: row.checkNo || undefined,
      source: row.source,
      referenceId: row.referenceId || '',
      referenceLabel: row.referenceLabel || row.referenceId || '',
      referenceUrl: row.referenceUrl || '',
      payee: row.payee || '',
      type: row.type || '',
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
      _cpId: row.id, // Internal ID just in case
    }));

    const lastItem = slice[slice.length - 1];
    const nextCursor = hasMore && lastItem
      ? encodeCursor({
        date: lastItem.passingDate,
        source: lastItem.source,
        id: lastItem.id, // Using CheckPassingItem ID for cursor if we used it in query? 
        // CheckPassingItem.id is unique. 
        // Actually, decodeCursor expects {date, source, id}.
        // We should use CheckPassingItem ID for the cursor stability if possible.
        // But encodeCursor uses `id`. 
        // Let's rely on CheckPassingItem.id for the cursor.
        // So: encodeCursor({ ..., id: lastItem.id })
      })
      : null;

    return apiSuccess({ items: mappedItems, nextCursor });
  } catch (error) {
    console.error('[API_ERROR:GET_CHECK_PASSING]', error);
    return apiServerError(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission('checkPassing', 'update');
    if (!allowed) return error;

    const body = await req.json().catch(() => ({}));
    const updates = Array.isArray(body?.updates)
      ? body.updates
      : body?.id && body?.source && body?.status
        ? [body]
        : [];

    if (!updates.length) {
      return apiError('No updates provided.', 400);
    }

    const actor = await getActorDetails('System');

    // Process updates sequentially (one-by-one)
    const results: Array<{ id: string; source: CheckPassingSource; status: CheckStatus; updatedAt: string }> = [];
    const logs: Array<{
      source: string;
      sourceId: string;
      previousStatus: CheckStatus | null;
      newStatus: CheckStatus;
      note?: string | null;
      userName: string;
      userId?: string | null;
    }> = [];

    for (const update of updates) {
      try {
        const source = update?.source as CheckPassingSource;
        const status = update?.status as CheckStatus;
        const note = typeof update?.note === 'string' ? update.note.trim() : null;

        if (!source || !update?.id || !STATUS_VALUES.has(status)) {
          throw new Error(`Invalid update payload for ${update?.source}:${update?.id}`);
        }

        if (source === 'Purchase') {
          // Use domain reconcile function (not in transaction to avoid nesting)
          const existing = await prisma.purchasePayment.findUnique({
            where: { id: update.id },
            select: { checkStatus: true, check: true, checkDate: true, updatedAt: true },
          });

          if (!existing || !existing.checkDate || Number(existing.check || 0) <= 0) {
            throw new Error(`Purchase check not found: ${update.id}`);
          }

          if (existing.checkStatus !== status) {
            // Call domain function which handles ledger reconciliation
            const { updateCheckStatusCore } = await import('@/server/modules/purchases');
            const purchaseResult = await updateCheckStatusCore({
              paymentId: update.id,
              status,
              user: actor.name,
            });

            // Guard: ensure reconciliation succeeded
            if (!purchaseResult?.success) {
              throw new Error(
                purchaseResult?.message
                  ? `Purchase reconcile failed (${update.id}): ${purchaseResult.message}`
                  : `Purchase reconcile failed (${update.id})`
              );
            }

            logs.push({
              source,
              sourceId: update.id,
              previousStatus: existing.checkStatus,
              newStatus: status,
              note,
              userName: actor.name,
              userId: actor.id || null,
            });
          }

          const refreshed = await prisma.purchasePayment.findUnique({
            where: { id: update.id },
            select: { updatedAt: true },
          });

          // No need to manually sync check passing item - updateCheckStatusCore handles it
          results.push({ id: update.id, source, status, updatedAt: toIso(refreshed?.updatedAt) });
          continue;
        }

        if (source === 'Expense') {
          await prisma.$transaction(async (tx) => {
            const existing = await tx.expense.findUnique({
              where: { id: update.id },
              select: { checkStatus: true, check: true, checkDate: true, updatedAt: true },
            });

            if (!existing || !existing.checkDate || Number(existing.check || 0) <= 0) {
              throw new Error(`Expense check not found: ${update.id}`);
            }

            if (existing.checkStatus !== status) {
              const { updateExpenseCheckStatus } = await import('@/server/modules/expenses');
              await updateExpenseCheckStatus(update.id, status, tx);

              logs.push({
                source,
                sourceId: update.id,
                previousStatus: existing.checkStatus,
                newStatus: status,
                note,
                userName: actor.name,
                userId: actor.id || null,
              });
            }

            const refreshed = await tx.expense.findUnique({
              where: { id: update.id },
              select: { updatedAt: true },
            });

            const item = await buildCheckPassingItemFromExpense(tx, update.id);
            if (item) await upsertCheckPassingItem(tx, item);

            results.push({ id: update.id, source, status, updatedAt: toIso(refreshed?.updatedAt) });
          });
          continue;
        }

        if (source === 'Staff') {
          await prisma.$transaction(async (tx) => {
            const existing = await tx.staffPayment.findUnique({
              where: { id: update.id },
              select: { checkStatus: true, check: true, checkDate: true, updatedAt: true },
            });

            if (!existing || !existing.checkDate || Number(existing.check || 0) <= 0) {
              throw new Error(`Staff check not found: ${update.id}`);
            }

            if (existing.checkStatus !== status) {
              const { updateStaffPaymentCheckStatus } = await import('@/server/modules/staff-payment-ledger');
              await updateStaffPaymentCheckStatus(update.id, status, tx);

              logs.push({
                source,
                sourceId: update.id,
                previousStatus: existing.checkStatus,
                newStatus: status,
                note,
                userName: actor.name,
                userId: actor.id || null,
              });
            }

            const refreshed = await tx.staffPayment.findUnique({
              where: { id: update.id },
              select: { updatedAt: true },
            });

            const item = await buildCheckPassingItemFromStaffPayment(tx, update.id);
            if (item) await upsertCheckPassingItem(tx, item);

            results.push({ id: update.id, source, status, updatedAt: toIso(refreshed?.updatedAt) });
          });
          continue;
        }

        if (source === 'CutoffSettlement') {
          await prisma.$transaction(async (tx) => {
            const existing = await tx.cutoffSettlement.findUnique({
              where: { id: update.id },
              select: { checkStatus: true, check: true, checkDate: true, updatedAt: true },
            });

            if (!existing || !existing.checkDate || Number(existing.check || 0) <= 0) {
              throw new Error(`CutoffSettlement check not found: ${update.id}`);
            }

            if (existing.checkStatus !== status) {
              const { updateCutoffSettlementCheckStatus } = await import('@/server/modules/cutoff');
              await updateCutoffSettlementCheckStatus(update.id, status, tx);

              logs.push({
                source,
                sourceId: update.id,
                previousStatus: existing.checkStatus,
                newStatus: status,
                note,
                userName: actor.name,
                userId: actor.id || null,
              });
            }

            const refreshed = await tx.cutoffSettlement.findUnique({
              where: { id: update.id },
              select: { updatedAt: true },
            });

            const { buildCheckPassingItemFromCutoffSettlement } = await import('@/server/modules/check-passing-items');
            const item = await buildCheckPassingItemFromCutoffSettlement(tx, update.id);
            if (item) await upsertCheckPassingItem(tx, item);

            results.push({ id: update.id, source, status, updatedAt: toIso(refreshed?.updatedAt) });
          });
          continue;
        }

        throw new Error(`Unsupported source: ${source}`);
      } catch (err: any) {
        // Log error but continue processing other updates
        console.error(`[CHECK_PASSING_UPDATE_ERROR] ${update?.source}:${update?.id}`, err);
        throw err; // Re-throw to halt on first error
      }
    }

    // Write logs in a separate transaction
    if (logs.length) {
      await prisma.checkPassingLog.createMany({ data: logs });
    }

    return apiSuccess({ updated: results });
  } catch (error) {
    return apiServerError(error);
  }
}
