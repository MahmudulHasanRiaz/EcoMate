import { z } from 'zod';

export const createCustomerSchema = z.object({
    name: z.string().min(2, "Name is required"),
    phone: z.string().min(11, "Valid phone number is required"),
    email: z.string().email().optional().nullable().or(z.literal('')),
    address: z.string().min(1, "Address is required"),
    district: z.string().default('Dhaka'),
    country: z.string().default('Bangladesh'),
    type: z.enum(['Retail', 'Wholesaler']).default('Retail'),
});

export const updateCustomerSchema = createCustomerSchema.partial();
