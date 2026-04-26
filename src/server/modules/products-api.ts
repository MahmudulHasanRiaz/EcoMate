import prisma from '@/lib/prisma';

export async function validateProductSlug(params: { slug: string; productId?: string }) {
  const { slug, productId } = params;
  const whereClause: { slug: string; id?: { not: string } } = { slug };
  if (productId) whereClause.id = { not: productId };

  const existingProduct = await prisma.product.findFirst({
    where: whereClause,
    select: { id: true },
  });

  return { isAvailable: !existingProduct };
}
