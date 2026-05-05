
import { Metadata } from "next";
import { getWholesaleQueue } from "@/services/wholesale";
import WholesaleQueueClient from "./queue-client";
import { checkPermission } from "@/lib/security";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Wholesale Approval Queue | ecomate",
};

export default async function WholesaleQueuePage() {
  const { allowed } = await checkPermission('wholesaleManagement', 'read');
  if (!allowed) redirect('/unauthorized');

  const queue = await getWholesaleQueue();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Approval Queue</h1>
        <p className="text-muted-foreground">
          Review and approve orders detected as wholesale.
        </p>
      </div>

      <WholesaleQueueClient initialQueue={queue} />
    </div>
  );
}
