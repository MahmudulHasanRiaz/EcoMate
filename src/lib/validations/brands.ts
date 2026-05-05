import { z } from 'zod';

export const createBrandSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    slug: z.string().min(1, 'Slug is required').regex(/^[a-z0-9-]+$/, 'Slug must be alphanumeric and hyphenated'),
    type: z.enum(['Self', 'Out']),
    logoUrl: z.string().url('Invalid logo URL').optional().or(z.literal('')),
    description: z.string().optional(),
    isActive: z.boolean().optional(),
});

export const updateBrandSchema = createBrandSchema.partial();
