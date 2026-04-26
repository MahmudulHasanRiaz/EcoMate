import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export type ApiResponse<T = any> = {
    success: boolean;
    message: string;
    data?: T;
    errors?: any;
};

export function apiSuccess<T>(data: T, message = 'Success', status = 200) {
    return NextResponse.json<ApiResponse<T>>({
        success: true,
        message,
        data,
    }, { status });
}

export function apiError(message: string, status = 400, errors?: any) {
    if (errors instanceof ZodError) {
        return NextResponse.json<ApiResponse>({
            success: false,
            message: 'Validation failed',
            errors: errors.flatten().fieldErrors,
        }, { status: 422 });
    }

    return NextResponse.json<ApiResponse>({
        success: false,
        message,
        errors,
    }, { status });
}

export function apiUnauthorized(message = 'Unauthorized') {
    return apiError(message, 401);
}

export function apiForbidden(message = 'Forbidden') {
    return apiError(message, 403);
}

export function apiNotFound(message = 'Not Found') {
    return apiError(message, 404);
}

export function apiServerError(error: any) {
    console.error('[SERVER_ERROR]', error);
    return apiError(process.env.NODE_ENV === 'production' ? 'Internal Server Error' : error?.message || 'Internal Server Error', 500);
}
