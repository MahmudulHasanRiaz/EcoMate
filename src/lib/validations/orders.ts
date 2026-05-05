import { z } from 'zod';

export const orderStatusSchema = z.enum([
    // Display Labels
    'Draft', 'New', 'Confirmed', 'Confirmed Waiting', 'Packing Hold', 'Canceled', 'C2C', 'Hold',
    'In-Courier', 'RTS (Ready to Ship)', 'Shipped', 'Delivered',
    'Return Pending', 'Paid Return', 'Returned', 'Partial', 'Damaged', 'Incomplete', 'Incomplete-Cancelled', 'No Response',
    // Internal Enum Names
    'Packing_Hold', 'In_Courier', 'RTS__Ready_to_Ship_', 'Return_Pending', 'Paid_Return', 'Incomplete_Cancelled', 'No_Response', 'Confirmed_Waiting'
]);

export const orderPlatformSchema = z.enum(['TikTok', 'Messenger', 'Facebook', 'Instagram', 'Website', 'Call']);
export const orderChannelSchema = z.enum(['Retail', 'Wholesale']);
export const orderSourcePlatformSchema = z.enum(['Manual', 'POS', 'Woo', 'Messenger', 'Facebook', 'WhatsApp', 'TikTok', 'Instagram', 'Website', 'Call', 'SR', 'WholesalerPortal', 'Other']);
export const paymentMethodSchema = z.enum([
    'CashOnDelivery',
    'PaidShippingCOD',
    'PartialPaidCOD',
    'Cash',
    'Bank',
    'bKash',
    'Nagad',
    'Rocket',
]);
export const courierServiceSchema = z.enum(['Pathao', 'RedX', 'Steadfast', 'Carrybee']);

export const orderItemSchema = z.object({
    productId: z.string().cuid().optional().or(z.string()), // Support cuid or other IDs
    variantId: z.string().optional().nullable(),
    sku: z.string().optional().nullable(),
    quantity: z.number().int().positive(),
    price: z.number().nonnegative(),
    siteDiscount: z.number().nonnegative().optional().default(0),
    name: z.string().optional(),
});

export const shippingAddressSchema = z.object({
    address: z.string().min(1, "Address is required"),
    city: z.string().optional().nullable(),
    district: z.string().optional().nullable(),
    cityName: z.string().optional().nullable(),
    zoneName: z.string().optional().nullable(),
    carrybeeCityId: z.union([z.string(), z.number()]).optional().nullable(),
    carrybeeZoneId: z.union([z.string(), z.number()]).optional().nullable(),
    pathaoCityId: z.union([z.string(), z.number()]).optional().nullable(),
    pathaoZoneId: z.union([z.string(), z.number()]).optional().nullable(),
    zone: z.string().optional().nullable(),
    area: z.string().optional().nullable(),
    postalCode: z.string().optional().nullable(),
    country: z.string().default('Bangladesh'),
});

export const createOrderSchemaBase = z.object({
    customerName: z.string().optional().nullable(),
    customerPhone: z.string().min(11, "Valid phone number is required").optional().nullable(),
    customerEmail: z.string().email().optional().nullable().or(z.literal('')),
    leadId: z.string().optional().nullable(),
    status: orderStatusSchema.default('New'),
    channel: orderChannelSchema.default('Retail').optional(),
    sourcePlatform: orderSourcePlatformSchema.optional().nullable(),
    salesRepresentativeId: z.string().optional().nullable(),
    platform: orderPlatformSchema.optional().nullable(),
    source: z.string().optional().nullable(),
    date: z.string().datetime().or(z.date()).optional(),
    items: z.array(orderItemSchema).min(1, "At least one item is required").optional(),
    products: z.array(orderItemSchema).min(1, "At least one item is required").optional(),
    shipping: z.number().nonnegative().default(0),
    discount: z.number().nonnegative().default(0),
    customerNote: z.string().optional().nullable(),
    officeNote: z.string().optional().nullable(),
    businessId: z.string().optional().nullable(),
    paymentMethod: paymentMethodSchema.default('CashOnDelivery'),
    transactionId: z.string().optional().nullable(),
    senderPhone: z.string().optional().nullable(),
    paidAmount: z.number().nonnegative().default(0),
    paidFromAccountId: z.string().optional().nullable(),
    shippingPaid: z.boolean().optional().default(false),
    shippingPaidAmount: z.number().nonnegative().optional().default(0),
    shippingPaidAccountId: z.string().optional().nullable(),
    shippingAddress: shippingAddressSchema.optional().nullable(),
});

export const createOrderSchema = createOrderSchemaBase.superRefine((data, ctx) => {
    const source = (data.source || 'Manual').toLowerCase();
    const isMobilePOS = source === 'mobile-create';

    // Ensure items or products is present
    const hasItems = (data.items && data.items.length > 0) || (data.products && data.products.length > 0);
    if (!hasItems) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "At least one item is required",
            path: ["items"]
        });
    }

    // Customer Phone is ALWAYS required (min 11 chars)
    if (!data.customerPhone || data.customerPhone.length < 11) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Valid phone number is required",
            path: ["customerPhone"]
        });
    }

    if (!isMobilePOS) {
        // Strict checks for regular orders
        if (!data.customerName || data.customerName.trim().length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Customer name is required",
                path: ["customerName"]
            });
        }

        if (!data.shippingAddress || !data.shippingAddress.address || data.shippingAddress.address.trim().length === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Shipping address is required",
                path: ["shippingAddress", "address"]
            });
        }

        // Manual order name length check
        if (source === 'manual') {
            const len = (data.customerName || '').trim().length;
            if (len < 3 || len > 22) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Customer name must be 3-22 characters",
                    path: ["customerName"]
                });
            }
        }
    }

    // Account constraints for liquid methods and paid amounts
    const liquidMethods = ['Cash'];
    const isLiquid = data.paymentMethod && liquidMethods.includes(data.paymentMethod);
    
    if (isLiquid && (!data.paidFromAccountId || data.paidFromAccountId.trim().length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Account selection is required for liquid payment methods",
            path: ["paidFromAccountId"]
        });
    } else if (!['Bank', 'bKash', 'Nagad', 'Rocket'].includes(data.paymentMethod || '') && data.paidAmount > 0 && (!data.paidFromAccountId || data.paidFromAccountId.trim().length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Account selection is required when an advance payment is provided",
            path: ["paidFromAccountId"]
        });
    }

    const needsTransactionRef = ['Bank', 'bKash', 'Nagad', 'Rocket'].includes(data.paymentMethod || '') 
        || data.paymentMethod === 'PaidShippingCOD' 
        || data.paymentMethod === 'PartialPaidCOD';

    if (needsTransactionRef && (!data.transactionId || data.transactionId.trim().length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Transaction Reference (ID / Phone / Bank Ac) is required for verification",
            path: ["transactionId"]
        });
    }

    if (data.shippingPaid && data.shippingPaidAmount > 0 && (!data.shippingPaidAccountId || data.shippingPaidAccountId.trim().length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Account selection is required for paid shipping",
            path: ["shippingPaidAccountId"]
        });
    }

    // Prevent negative totals (discount exceeding subtotal + shipping)
    const items = (data.items && data.items.length > 0)
        ? data.items
        : (data.products && data.products.length > 0 ? data.products : []);
    const subtotal = items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
    const siteDiscountTotal = items.reduce((sum, item) => sum + Number(item.siteDiscount || 0), 0);
    const shipping = Number(data.shipping || 0);
    const discount = Number(data.discount || 0);
    const total = subtotal + shipping - discount - siteDiscountTotal;
    if (total < 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Discount is too high for the order total",
            path: ["discount"]
        });
    }
});


const partialShippingAddressSchema = shippingAddressSchema.partial();

export const updateOrderSchema = createOrderSchemaBase.partial().extend({
    assignedToId: z.string().optional().nullable(),
    courierService: courierServiceSchema.optional().nullable(),
    courierTrackingCode: z.string().optional().nullable(),
    shippingAddress: partialShippingAddressSchema.optional().nullable(),
    products: z.array(orderItemSchema).min(1).optional(),
    refundAccountId: z.string().optional().nullable(),
    expectedUpdatedAt: z.string().optional(),
    lockToken: z.string().optional(),
}).refine((data) => {
    // We only validate if both source is manual and customerName is provided
    if (data.source?.toLowerCase() === 'manual' && data.customerName !== undefined) {
        const len = (data.customerName || '').trim().length;
        return len >= 3 && len <= 22;
    }
    return true;
}, {
    message: "Customer name must be 3-22 characters",
    path: ["customerName"]
});
