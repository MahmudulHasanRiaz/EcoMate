import { NextResponse } from "next/server";
import { applyPartnerPaymentCore } from "@/server/modules/purchases";
import { getActorName } from "@/server/utils/current-user";
import { assertNotPreCutoff } from "@/server/modules/cutoff";
import { enforcePermission } from "@/lib/security";

export async function POST(req: Request) {
    try {
        const { allowed, error: permError } = await enforcePermission('purchases', 'create');
        if (!allowed) return permError;

        const payload = await req.json();
        const actorName = await getActorName();

        // Pre-cutoff guard: if a payment date is supplied and it's before cutoff, block it
        if (payload.date) {
            await assertNotPreCutoff(payload.date);
        }

        const res = await applyPartnerPaymentCore({
            ...payload,
            user: actorName
        });

        if (res.success) {
            return NextResponse.json(res);
        } else {
            return NextResponse.json({ message: "Failed to apply payment" }, { status: 400 });
        }
    } catch (error: any) {
        if (error?.message?.includes('কাটঅফ') || error?.message?.includes('cutoff date')) {
            return NextResponse.json({ message: error.message }, { status: 403 });
        }
        console.error("[API_PARTNER_PAYMENT_ERROR]", error);
        return NextResponse.json({ message: error.message || "Internal server error" }, { status: 500 });
    }
}
