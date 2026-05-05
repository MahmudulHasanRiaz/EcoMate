import { getSrCatalog, getSrCustomers } from "@/services/sr-portal";
import SrOrderTakingClient from "./order-taking-client";

export const dynamic = "force-dynamic";

export default async function SrNewOrderPage() {
  const [catalog, customers] = await Promise.all([
    getSrCatalog(),
    getSrCustomers(),
  ]);

  return (
    <SrOrderTakingClient
      catalog={catalog}
      initialCustomers={customers}
    />
  );
}
