import prisma from '@/lib/prisma';
import { Brand, BrandCreateInput, BrandUpdateInput } from '@/types';

export type BrandListParams = {
    search?: string;
    isActive?: boolean;
    type?: 'Self' | 'Out' | 'all';
};

export async function getBrands({
    search,
    isActive,
    type
}: BrandListParams = {}) {
    const where: any = {};

    if (typeof isActive !== 'undefined') {
        where.isActive = isActive;
    }

    if (type && type !== 'all') {
        where.type = type;
    }

    if (search) {
        where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { slug: { contains: search, mode: 'insensitive' } },
        ];
    }

    const items = await prisma.brand.findMany({
        where,
        orderBy: { name: 'asc' },
    });

    return items.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    })) as Brand[];
}

export async function getBrandById(id: string): Promise<Brand | undefined> {
    const row = await prisma.brand.findUnique({
        where: { id },
    });
    if (!row) return undefined;

    return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    } as Brand;
}

export async function getBrandBySlug(slug: string): Promise<Brand | undefined> {
    const row = await prisma.brand.findUnique({
        where: { slug },
    });
    if (!row) return undefined;

    return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    } as Brand;
}

export async function createBrand(data: BrandCreateInput) {
    // Check for existing slug or name
    const existing = await prisma.brand.findFirst({
        where: {
            OR: [
                { slug: data.slug },
                { name: { equals: data.name, mode: 'insensitive' as any } }
            ]
        }
    });
    if (existing) {
        if (existing.slug === data.slug) {
            throw new Error('CONFLICT: A brand with this slug already exists.');
        }
        throw new Error('CONFLICT: A brand with this name already exists.');
    }

    return prisma.brand.create({
        data: {
            name: data.name,
            slug: data.slug,
            type: data.type,
            logoUrl: data.logoUrl || null,
            description: data.description || null,
            isActive: typeof data.isActive !== 'undefined' ? data.isActive : true,
        },
    });
}

export async function updateBrand(id: string, data: BrandUpdateInput) {
    if (data.slug || data.name) {
        const existing = await prisma.brand.findFirst({
            where: { 
                id: { not: id },
                OR: [
                    data.slug ? { slug: data.slug } : {},
                    data.name ? { name: { equals: data.name, mode: 'insensitive' as any } } : {}
                ].filter(o => Object.keys(o).length > 0)
            }
        });
        if (existing) {
            if (data.slug && existing.slug === data.slug) {
                throw new Error('CONFLICT: A brand with this slug already exists.');
            }
            throw new Error('CONFLICT: A brand with this name already exists.');
        }
    }

    return prisma.brand.update({
        where: { id },
        data: {
            name: data.name,
            slug: data.slug,
            type: data.type,
            logoUrl: data.logoUrl,
            description: data.description,
            isActive: data.isActive,
        },
    });
}

export async function toggleBrandActive(id: string) {
    const brand = await prisma.brand.findUnique({
        where: { id },
        select: { isActive: true }
    });
    if (!brand) throw new Error('Brand not found');

    return prisma.brand.update({
        where: { id },
        data: { isActive: !brand.isActive }
    });
}
