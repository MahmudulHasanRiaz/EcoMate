import { NextRequest, NextResponse } from "next/server";
import { getBackupSettings, updateBackupSettings } from "@/server/utils/app-settings";
import { syncBackupSchedule } from "@/server/queues/backups";
import { auth } from "@clerk/nextjs/server";

export async function GET() {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const settings = await getBackupSettings();
        return NextResponse.json(settings);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const data = await req.json();
        await updateBackupSettings(data);
        await syncBackupSchedule().catch(console.error);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
