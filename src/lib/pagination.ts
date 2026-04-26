import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export interface PaginatedResult<T> {
    data: T[];
    meta: {
        total?: number;
        page?: number;
        pageSize: number;
        hasMore: boolean;
        nextCursor?: string;
    };
}

export const paginationSchema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional().default(DEFAULT_PAGE_SIZE),
    cursor: z.string().optional(),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

type PaginationConfig = {
    maxPageSize?: number;
    defaultPageSize?: number;
};

/**
 * Helper to normalize pagination parameters.
 * Enforces strict upper bounds on pageSize.
 */
export function getPaginationParams(
    params: { page?: string | number; pageSize?: string | number; cursor?: string },
    config?: PaginationConfig
): PaginationParams {
    const maxPageSize = config?.maxPageSize ?? MAX_PAGE_SIZE;
    const defaultPageSize = config?.defaultPageSize ?? DEFAULT_PAGE_SIZE;
    const page = Math.max(1, parseInt(String(params.page || 1)) || 1);
    let pageSize = parseInt(String(params.pageSize || defaultPageSize)) || defaultPageSize;

    // Clamp instead of invalidate
    if (pageSize > maxPageSize) {
        pageSize = maxPageSize;
    } else if (pageSize < 1) {
        pageSize = defaultPageSize;
    }

    const cursor = params.cursor || undefined;

    return {
        page,
        pageSize,
        cursor,
    };
}

/**
 * Generic helper to construct a cursor-based query object for Prisma.
 * @param cursor The cursor string (usually an ID)
 * @param pageSize Number of items to take
 */
export function buildCursorQuery(cursor: string | undefined, pageSize: number) {
    if (!cursor) {
        return {
            take: pageSize + 1, // Fetch one extra to determine hasMore
        };
    }

    return {
        take: pageSize + 1,
        skip: 1, // Skip the cursor itself
        cursor: {
            id: cursor,
        },
    };
}

/**
 * Transforms raw Prisma results into a standardized PaginatedResult.
 * Handles removing the extra item check for 'hasMore'.
 */
export function createPaginatedResponse<T extends { id: string }>(
    items: T[],
    pageSize: number,
    page?: number,
    total?: number
): PaginatedResult<T> {
    const hasMore = items.length > pageSize;
    const data = hasMore ? items.slice(0, pageSize) : items;
    const nextCursor = hasMore ? data[data.length - 1].id : undefined;

    return {
        data,
        meta: {
            total,
            page,
            pageSize,
            hasMore,
            nextCursor,
        },
    };
}
