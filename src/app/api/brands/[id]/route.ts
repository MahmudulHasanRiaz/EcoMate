import { NextRequest } from 'next/server';
import { getBrandById, updateBrand, toggleBrandActive } from '@server/modules/brands';
import { enforcePermission } from '@/lib/security';
import { updateBrandSchema } from '@/lib/validations/brands';
import { apiSuccess, apiServerError, apiError } from '@/lib/error';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { allowed, error } = await enforcePermission('products', 'read');
        if (!allowed) return error;

        const { id } = await params;
        const brand = await getBrandById(id);
        if (!brand) return apiError('Brand not found', 404);

        return apiSuccess(brand);
    } catch (error: any) {
        return apiServerError(error);
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { allowed, error } = await enforcePermission('products', 'update');
        if (!allowed) return error;

        const { id } = await params;
        const body = await req.json();

        // Check if it's just a toggle
        if (Object.keys(body).length === 1 && typeof body.isActive !== 'undefined') {
            const brand = await toggleBrandActive(id);
            return apiSuccess(brand, 'Brand status updated');
        }

        // Validate with Zod
        const validated = updateBrandSchema.safeParse(body);
        if (!validated.success) {
            return apiError('Validation failed', 422, validated.error);
        }

        const brand = await updateBrand(id, validated.data as any);
        return apiSuccess(brand, 'Brand updated successfully');
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
