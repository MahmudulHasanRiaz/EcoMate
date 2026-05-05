import { Metadata } from "next";
import { checkPermission } from "@/lib/security";
import { redirect } from "next/navigation";
import { adminListProductRequests, adminGetProductRequestCounts } from "@/services/product-requests";
import ProductRequestsClient from "./requests-client";

export const metadata: Metadata = {
  title: "Product Requests | Wholesale Management",
};

export default async function ProductRequestsPage() {
  const { allowed } = await checkPermission("wholesaleManagement", "read");
  if (!allowed) redirect("/unauthorized");

  const [requests, counts] = await Promise.all([
    adminListProductRequests(),
    adminGetProductRequestCounts(),
  ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Product Requests</h1>
        <p className="text-muted-foreground">
          Manage product requests from wholesaler customers.
        </p>
      </div>
      <ProductRequestsClient initialRequests={requests} initialCounts={counts} />
    </div>
  );
}
