import prisma from '@/lib/prisma';
import { unstable_cache } from 'next/cache';

export const getCategories = unstable_cache(
    async () => {
        return prisma.category.findMany({
            orderBy: { name: 'asc' },
            include: {
                _count: {
                    select: { Product: true }
                }
            }
        });
    },
    ['categories'],
    { tags: ['categories'] }
);

export type CategoryWithCount = Awaited<ReturnType<typeof getCategories>>[number];
