import { notFound } from "next/navigation";
import { getSrProductById } from "@/services/sr-portal";
import ProductDetailClient from "./product-detail-client";

export const dynamic = "force-dynamic";

export default async function SrProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getSrProductById(id);

  if (!product) {
    notFound();
  }

  return <ProductDetailClient product={product} />;
}
