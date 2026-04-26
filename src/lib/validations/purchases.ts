import { z } from "zod";

export const purchaseStatusSchema = z.enum([
    'Draft',
    'FabricOrdered',
    'Printing',
    'Cutting',
    'Received',
    'Cancelled'
]);

export const purchaseTypeSchema = z.enum([
    'general',
    'three_piece'
]);

export const updatePurchaseStatusSchema = z.object({
    status: purchaseStatusSchema
});

export const purchaseOrderSchema = z.object({
    supplierId: z.string().min(1, "Supplier is required"),
    date: z.string().or(z.date()),
    type: purchaseTypeSchema,
    status: purchaseStatusSchema.default('Draft'),
    notes: z.string().optional(),
    // Add other fields as necessary
});
