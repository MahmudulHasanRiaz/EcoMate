import { notFound } from "next/navigation";
import { getWholesaleProductById } from "@/services/wholesale-portal";
import ProductDetailClient from "./product-detail-client";

export const dynamic = "force-dynamic";

export default async function WholesaleProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getWholesaleProductById(id);

  if (!product) {
    notFound();
  }

  return <ProductDetailClient product={product} />;
}
