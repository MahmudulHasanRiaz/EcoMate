import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma'; // Fixed import

export async function GET() {
    try {
        const setting = await prisma.appSetting.findUnique({
            where: { key: 'courier_general' }
        });

        return NextResponse.json(setting?.value || {});
    } catch (error) {
        console.error('Failed to fetch courier general settings:', error);
        return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const { requirePermission } = await import('@/server/auth/guards');
        const { checkRateLimit } = await import('@/server/utils/rate-limit');
        const user = await requirePermission('settings', 'update');

        if (!await checkRateLimit(`settings:${user.id}`, 5, 60)) {
            return new NextResponse('Too many requests', { status: 429 });
        }

        const body = await req.json();

        const setting = await prisma.appSetting.upsert({
            where: { key: 'courier_general' },
            update: { value: body },
            create: {
                key: 'courier_general',
                value: body
            }
        });

        return NextResponse.json(setting.value);
    } catch (error) {
        console.error('Failed to save courier general settings:', error);
        return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
    }
}
