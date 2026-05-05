import { NextRequest } from 'next/server';
import { getCustomers, createCustomer } from '@server/modules/customers';
import { enforcePermission } from '@/lib/security';
import { createCustomerSchema } from '@/lib/validations/customers';
import { apiSuccess, apiServerError, apiError } from '@/lib/error';
import { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('customers', 'read');
        if (!allowed) return error;

        const url = req.nextUrl;
        const search = url.searchParams.get('search') || undefined;
        const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
        const cursor = url.searchParams.get('cursor') || undefined;
        const type = (url.searchParams.get('type') as any) || undefined;

        // Validation
        const validTypes = ['Retail', 'Wholesaler', 'all'];
        if (type && !validTypes.includes(type)) {
            return apiError(`Invalid customer type: ${type}. Must be one of ${validTypes.join(', ')}`, 400);
        }

        const data = await getCustomers({ search, pageSize, cursor, type });
        return apiSuccess(data);
    } catch (error: any) {
        return apiServerError(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const { allowed, error } = await enforcePermission('customers', 'create');
        if (!allowed) return error;

        const body = await req.json();

        // Validate with Zod
        const validated = createCustomerSchema.safeParse(body);
        if (!validated.success) {
            return apiError('Validation failed', 422, validated.error);
        }

        const customer = await createCustomer({
            ...validated.data,
            email: validated.data.email ?? undefined,
            type: validated.data.type as any
        });
        return apiSuccess(customer, 'Customer created successfully', 201);
    } catch (error: any) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return apiError('Phone number already exists', 409);
        }
        return apiServerError(error);
    }
}
