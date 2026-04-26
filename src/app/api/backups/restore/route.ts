import { NextRequest, NextResponse } from "next/server";
import { restoreBackup } from "@/server/modules/backup";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const { key } = await req.json();
        if (!key) return NextResponse.json({ error: "Backup key is required" }, { status: 400 });

        console.log(`[RESTORE_API] Request received for key: ${key} by user: ${userId}`);
        const result = await restoreBackup(key);
        
        // Purge Next.js Data Cache for the entire dashboard
        const { revalidatePath } = await import('next/cache');
        revalidatePath('/dashboard', 'layout');
        revalidatePath('/', 'layout');

        // Small delay to ensure DB transactions settle before reload
        await new Promise(resolve => setTimeout(resolve, 1000));

        return NextResponse.json(result);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
