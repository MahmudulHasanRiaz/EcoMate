import { NextRequest } from 'next/server';
import { getBrands, createBrand } from '@server/modules/brands';
import { enforcePermission } from '@/lib/security';
import { createBrandSchema } from '@/lib/validations/brands';
import { apiSuccess, apiServerError, apiError } from '@/lib/error';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('products', 'read');
        if (!allowed) return error;

        const url = req.nextUrl;
        const search = url.searchParams.get('search') || undefined;
        const type = (url.searchParams.get('type') as any) || undefined;
        const isActiveStr = url.searchParams.get('isActive');
        const isActive = isActiveStr === 'true' ? true : isActiveStr === 'false' ? false : undefined;

        // Validation
        const validTypes = ['Self', 'Out', 'all'];
        if (type && !validTypes.includes(type)) {
            return apiError(`Invalid brand type: ${type}. Must be one of ${validTypes.join(', ')}`, 400);
        }

        const brands = await getBrands({ search, type, isActive });
        return apiSuccess(brands);
    } catch (error: any) {
        return apiServerError(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('products', 'create');
        if (!allowed) return error;

        const body = await req.json();

        // Validate with Zod
        const validated = createBrandSchema.safeParse(body);
        if (!validated.success) {
            return apiError('Validation failed', 422, validated.error);
        }

        const brand = await createBrand(validated.data as any);
        return apiSuccess(brand, 'Brand created successfully', 201);
    } catch (error: any) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return apiError('Brand slug or name already exists', 409);
        }
        if (error.message?.includes('CONFLICT:')) {
            return apiError(error.message.replace('CONFLICT: ', ''), 409);
        }
        return apiServerError(error);
    }
}
