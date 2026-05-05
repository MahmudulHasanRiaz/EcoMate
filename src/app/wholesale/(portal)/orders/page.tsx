import { getWholesalerOrders } from "@/services/wholesale-portal";
import WholesaleOrdersClient from "./orders-client";

export default async function WholesaleOrdersPage() {
  const orders = await getWholesalerOrders();
  return <WholesaleOrdersClient orders={orders} />;
}
