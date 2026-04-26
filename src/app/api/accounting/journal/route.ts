import { NextRequest, NextResponse } from 'next/server';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { createJournalEntry } from '@/server/modules/accounting';
import { getAppTimezone } from '@/lib/timezone';

const YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function getTimeZoneOffset(date: Date, timeZone: string) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        hour12: false,
    });
    const parts = dtf.formatToParts(date);
    const map: Record<string, string> = {};
    parts.forEach((part) => {
        if (part.type !== 'literal') {
            map[part.type] = part.value;
        }
    });
    const utcDate = Date.UTC(
        Number(map.year),
        Number(map.month) - 1,
        Number(map.day),
        Number(map.hour),
        Number(map.minute),
        Number(map.second)
    );
    return (utcDate - date.getTime()) / 60000;
}

function parseDateInTimeZone(value: string, timeZone: string) {
    if (!YMD_REGEX.test(value)) {
        return new Date(value);
    }
    const [year, month, day] = value.split('-').map(Number);
    const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const offset = getTimeZoneOffset(utcDate, timeZone);
    return new Date(utcDate.getTime() - offset * 60000);
}


export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const { requirePermission } = await import('@/server/auth/guards');
        await requirePermission('accounting', 'create');

        const body = await req.json();
        const rawDate = String(body?.date ?? '');
        const timeZone = await getAppTimezone();
        const date = parseDateInTimeZone(rawDate, timeZone);
        const description = String(body?.description ?? '');
        const entries = Array.isArray(body?.entries) ? body.entries : [];

        const created = await createJournalEntry({
            date,
            description,
            entries: entries.map((entry: any) => ({
                accountId: String(entry?.accountId ?? ''),
                debit: Number(entry?.debit ?? 0),
                credit: Number(entry?.credit ?? 0),
            })),
        });

        return NextResponse.json({ success: true, data: created }, { status: 201 });
    } catch (error: any) {
        if (error.name === 'PermissionError') {
            return NextResponse.json({ error: error.message }, { status: 403 });
        }
        const message = error?.message || 'Failed to post journal entry';
        console.error('[API:ACCOUNTING_JOURNAL_POST]', error);
        return NextResponse.json({ error: message }, { status: 400 });
    }
}
