import { getWholesaleCatalog } from "@/services/wholesale-portal";
import WholesaleCatalogClient from "./catalog-client";

export default async function WholesaleCatalogPage() {
  const catalog = await getWholesaleCatalog();
  return <WholesaleCatalogClient catalog={catalog} />;
}
