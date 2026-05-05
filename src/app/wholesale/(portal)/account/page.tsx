import { getWholesalerAccount } from "@/services/wholesale-portal";
import { getMyProductRequests } from "@/services/product-requests";
import WholesaleAccountClient from "./account-client";

export default async function WholesaleAccountPage() {
  const [account, requests] = await Promise.all([
    getWholesalerAccount(),
    getMyProductRequests()
  ]);
  
  return <WholesaleAccountClient account={account} initialRequests={requests} />;
}
