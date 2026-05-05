import { Metadata } from "next";
import { getWholesaleOrders } from "@/services/wholesale";
import { getBusinesses } from "@/services/partners";
import WholesaleOrdersClient from "./orders-client";
import { checkPermission } from "@/lib/security";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Wholesale Order Management | ecomate",
};

export default async function WholesaleOrdersPage() {
  const { allowed } = await checkPermission('wholesaleManagement', 'read');
  if (!allowed) redirect('/unauthorized');

  const [orders, businesses] = await Promise.all([
    getWholesaleOrders(),
    getBusinesses()
  ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Wholesale Management</h1>
        <p className="text-muted-foreground">
          View and manage all orders identified as wholesale.
        </p>
      </div>

      <WholesaleOrdersClient initialOrders={orders} businesses={businesses} />
    </div>
  );
}
