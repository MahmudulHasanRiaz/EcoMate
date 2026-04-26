import { NextRequest } from 'next/server';
import { getCustomerById, updateCustomer, deleteCustomer } from '@server/modules/customers';
import { enforcePermission } from '@/lib/security';
import { updateCustomerSchema } from '@/lib/validations/customers';
import { apiSuccess, apiServerError, apiError, apiNotFound } from '@/lib/error';
import { Prisma } from '@prisma/client';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { allowed, error } = await enforcePermission('customers', 'read');
        if (!allowed) return error;

        const { id } = await params;
        const customer = await getCustomerById(id);
        if (!customer) return apiNotFound('Customer not found');

        return apiSuccess(customer);
    } catch (error: any) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
                return apiError('Phone number already exists', 409);
            }
            if (error.code === 'P2025') {
                return apiNotFound('Customer not found');
            }
        }
        return apiServerError(error);
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { allowed, error } = await enforcePermission('customers', 'update');
        if (!allowed) return error;

        const { id } = await params;
        const body = await req.json();

        // Validate with Zod
        const validated = updateCustomerSchema.safeParse(body);
        if (!validated.success) {
            return apiError('Validation failed', 422, validated.error);
        }

        const result = await updateCustomer(id, {
            ...validated.data,
            email: validated.data.email ?? undefined
        });
        return apiSuccess(result, 'Customer updated successfully');
    } catch (error: any) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === 'P2002') {
                return apiError('Phone number already exists', 409);
            }
            if (error.code === 'P2025') {
                return apiNotFound('Customer not found');
            }
        }
        return apiServerError(error);
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { allowed, error } = await enforcePermission('customers', 'delete');
        if (!allowed) return error;

        const { id } = await params;
        await deleteCustomer(id);
        return apiSuccess(null, 'Customer deleted successfully');
    } catch (error: any) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            return apiNotFound('Customer not found');
        }
        return apiServerError(error);
    }
}
