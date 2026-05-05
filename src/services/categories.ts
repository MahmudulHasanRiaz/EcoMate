'use server';

import prisma from '@/lib/prisma';
import { unstable_cache } from 'next/cache';

const getCachedCategories = unstable_cache(
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

export async function getCategories() {
    return getCachedCategories();
}

export type CategoryWithCount = Awaited<ReturnType<typeof getCategories>>[number];
