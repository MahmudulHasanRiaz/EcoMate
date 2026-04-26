import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { apiServerError, apiSuccess } from '@/lib/error';
import { enforcePermission } from '@/lib/security';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  try {
    const { allowed, error } = await enforcePermission('checkPassing', 'read');
    if (!allowed) return error;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + 7);
    end.setHours(23, 59, 59, 999);

    const rows = await prisma.$queryRaw<
      Array<{ day: Date; count: bigint | number; total: number | null }>
    >(Prisma.sql`
      SELECT "passingDate"::date AS day, 
             COUNT(*)::int AS count, 
             COALESCE(SUM("amount"), 0) AS total
      FROM "CheckPassingItem"
      WHERE "passingDate" >= DATE(${today}) 
        AND "passingDate" <= DATE(${end}) 
        AND "status" = 'Pending'
      GROUP BY day
      ORDER BY day ASC
    `);

    const data = rows.map((row) => ({
      date: toIsoDate(row.day),
      count: Number(row.count || 0),
      total: Number(row.total || 0),
    }));

    return apiSuccess(data);
  } catch (error) {
    return apiServerError(error);
  }
}

