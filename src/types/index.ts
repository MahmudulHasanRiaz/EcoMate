import type { LucideIcon } from 'lucide-react';

export type ScannedItem = {
    id: string;
    orderNumber?: string | null;
    currentStatus: OrderStatus;
    scannedAt: Date;
};

export type Notification = {
    id: string;
    icon: string; // Stored as name (e.g., 'Bell', 'ShoppingCart')
    title: string;
    description: string;
    time: string; // ISO string
    read: boolean;
    href: string;
};

export type Category = {
    id: string;
    name: string;
    parentId?: string | null;
};

export type BrandType = 'Self' | 'Out';

export type Brand = {
    id: string;
    name: string;
    slug: string;
    type: BrandType;
    logoUrl?: string | null;
    description?: string | null;
    isActive: boolean;
    createdAt?: string;
    updatedAt?: string;
};

export type BrandCreateInput = {
    name: string;
    slug: string;
    type: BrandType;
    logoUrl?: string | null;
    description?: string | null;
    isActive?: boolean;
};

export type BrandUpdateInput = Partial<BrandCreateInput>;

export type ExpenseCategory = {
    id: string;
    name: string;
    expenseAccountId?: string | null;
};

export type ExpenseApprovalStatus = 'Submitted' | 'Approved' | 'Rejected';

export type ProductVariant = {
    id: string;
    name: string; // e.g., "Small, Red"
    sku?: string | null;
    price?: number | null;
    salePrice?: number | null;
    image?: string | null;
    inventory: number;
    attributes: Record<string, string>;
    wholesalePrice?: number | null;
    wholesaleMinQuantity?: number | null;
    wholesalePackQuantity?: number | null;
};

export type ProductType = 'simple' | 'variable' | 'combo' | 'three_piece';

export type ProductLog = {
    id: string;
    productId: string;
    timestamp: string;
    user: string;
    action: string;
    details?: string;
};

export type ProductImage = {
    id: string;
    url: string;
}

export type ComboItem = {
    childId: string;
    childProduct: {
        id: string;
        name: string;
        sku: string | null;
        productType?: string;
    };
    variantId?: string;
    variantName?: string;
    variantSku?: string;
    variantImage?: string;
    available?: number;
};

export type ProductAttribute = {
    id?: string;
    name: string;
    options: string[];
};

export type Product = {
    id: string;
    name: string;
    slug?: string | null;
    description?: string | null;
    shortDescription?: string | null;
    price: number;
    salePrice?: number | null;
    inventory: number;
    reservedQuantity: number;
    sku?: string | null;
    image: string | null; // This will now represent the primary image URL for convenience
    images: ProductImage[]; // This holds all images
    categoryId?: string | null;
    categoryIds?: string[];
    tags?: string | null;
    attributes?: ProductAttribute[];

    // Dimensions
    weight?: number | null;
    length?: number | null;
    width?: number | null;
    height?: number | null;

    // Fabric
    ornaFabric?: number | null;
    jamaFabric?: number | null;
    selowarFabric?: number | null;

    // Relations
    productType: ProductType;
    variants: ProductVariant[];
    isPublished?: boolean | null;
    logs?: ProductLog[];
    comboItems?: ComboItem[];

    // Wholesale
    wholesaleEnabled?: boolean | null;
    wholesaleVisible?: boolean | null;
    wholesalePrice?: number | null;
    wholesaleMinQuantity?: number | null;
    wholesalePackQuantity?: number | null;
    wholesaleUnitLabel?: string | null;
    wholesaleNote?: string | null;

    brandId?: string | null;
    brand?: Brand | null;

    // Video
    videoUrl?: string | null;
};

export type OrderStatus =
    | 'Draft'
    | 'New'
    | 'Confirmed'
    | 'Confirmed_Waiting'
    | 'Packing_Hold'
    | 'Canceled'
    | 'C2C'
    | 'Hold'
    | 'No_Response'
    | 'In_Courier'
    | 'RTS__Ready_to_Ship_'
    | 'Shipped'
    | 'Delivered'
    | 'Return_Pending'
    | 'Returned'
    | 'Paid_Return'
    | 'Partial'
    | 'Incomplete'
    | 'Incomplete_Cancelled'
    | 'Damaged'
    | 'Packing Hold' // Keep these for compatibility with legacy data/UI if needed
    | 'In-Courier'
    | 'RTS (Ready to Ship)'
    | 'Return Pending'
    | 'Paid Return'
    | 'Incomplete-Cancelled'
    | 'No Response'
    | 'Confirmed Waiting';

export type OrderPlatform = 'TikTok' | 'Messenger' | 'Facebook' | 'Instagram' | 'Website' | 'Call';

export type OrderChannel = 'Retail' | 'Wholesale';

export type CustomerType = 'Retail' | 'Wholesaler';

export type WholesaleApprovalStatus = 'Pending' | 'Approved' | 'Rejected' | 'EditedApproved';

export type OrderSourcePlatform =
    | 'Manual'
    | 'POS'
    | 'Woo'
    | 'Messenger'
    | 'Facebook'
    | 'WhatsApp'
    | 'TikTok'
    | 'Instagram'
    | 'Website'
    | 'Call'
    | 'SR'
    | 'WholesalerPortal'
    | 'Other';
export type PaymentMethod =
    | 'Cash on Delivery'
    | 'Paid Shipping COD'
    | 'Partial (Paid & COD)'
    | 'Cash'
    | 'Bank'
    | 'bKash'
    | 'Nagad'
    | 'Rocket';

export type CourierChargesSource = 'Config' | 'Invoice';
export type CourierService = 'Pathao' | 'RedX' | 'Steadfast' | 'Carrybee';

export type CourierInvoiceItem = {
    id: string;
    invoiceId: string;
    orderId?: string | null;
    orderNumber?: string | null;
    consignmentId?: string | null;
    collectableAmount?: number | null;
    collectedAmount?: number | null;
    codFee?: number | null;
    deliveryFee?: number | null;
    additionalCharge?: number | null;
    discount?: number | null;
    totalFee?: number | null;
    billingAmount?: number | null;
    deliveryStatus?: string | null;
    paymentStatus?: string | null;
    payoutMethod?: string | null;
    createdDate?: string | null;
    deliveredDate?: string | null;
    invoicedDate?: string | null;
    mismatchReason?: string | null;
    dueMismatchAmount?: number | null;
    billingMismatchAmount?: number | null;
    raw?: any;
};

export type CourierInvoice = {
    id: string;
    courierService: string;
    invoiceNumber: string;
    invoiceDate?: string | null;
    businessId?: string | null;
    totalRows: number;
    matchedRows: number;
    mismatchRows: number;
    totalCollected: number;
    totalFee: number;
    totalBilled: number;
    importedBy: string;
    importedAt: string;
    items?: CourierInvoiceItem[];
};

export type Business = {
    id: string;
    name: string;
    logo: string;
    phone?: string | null;
    address?: string | null;
};

export type OrderProduct = {
    productId: string;
    name: string;
    sku?: string;
    variantId?: string;
    variantName?: string;
    variantSku?: string;
    variantImage?: string;
    variantAttributes?: Record<string, string>;
    isCombo?: boolean;
    componentBreakdown?: any;
    image: {
        imageUrl: string;
        imageHint: string;
    };
    quantity: number;
    price: number;
    siteDiscount?: number;
    stock?: number;
    productType?: 'simple' | 'variable' | 'combo' | 'piece' | string;
};



export type Order = {
    id: string;
    type?: 'REGULAR' | 'PARTIAL_RETURN' | 'EXCHANGE';
    isExchange?: boolean;
    parentOrderId?: string | null;
    exchangeSourceOrderId?: string | null;
    orderNumber?: string | null;
    customerName: string;
    customerEmail?: string;
    customerPhone: string;
    platform?: OrderPlatform | string;
    source?: string;
    channel: OrderChannel;
    sourcePlatform?: OrderSourcePlatform | string | null;
    salesRepresentativeId?: string | null;
    date: string;
    status: OrderStatus;
    total: number;
    shipping: number;
    discount?: number;
    products: OrderProduct[];
    logs: OrderLog[];
    customerNote: string;
    officeNote: string;
    createdBy: string;
    confirmedBy: string;
    assignedTo?: string;
    assignedToId?: string;
    businessId: string;
    businessName?: string;
    businessLogo?: string;
    businessAddress?: string;
    businessPhone?: string;
    shippingAddress: {
        address: string;
        city?: string;
        district: string;
        cityName?: string;
        zoneName?: string;
        carrybeeCityId?: number | string;
        carrybeeZoneId?: number | string;
        pathaoCityId?: number | string;
        pathaoZoneId?: number | string;
        zone?: string;
        area?: string;
        postalCode?: string;
        country: string;
    };
    courierService?: CourierService;
    courierStatus?: string;
    courierTrackingCode?: string;
    courierConsignmentId?: string;
    courierDispatchedAt?: string;
    courierMeta?: any;
    actualCodAmount?: number;
    courierCodCharge?: number;
    courierDeliveryCharge?: number;
    courierNetPayable?: number;
    courierChargesSource?: CourierChargesSource;
    chargesLastUpdated?: string;
    chargesUpdatedBy?: string;
    paymentMethod: PaymentMethod;
    paidAmount: number;
    paidFromAccountId?: string | null;
    shippingPaid?: boolean;
    shippingPaidAmount?: number;
    shippingPaidAccountId?: string | null;
    rawPayload?: any;
    integrationId?: string | null;
    statusUpdatedAt?: string | Date | null;
    shipmentStale?: boolean;
    allocatedSubtotal?: number | null;
    allocatedShipping?: number | null;
    allocatedDiscount?: number | null;
    isStockReserved?: boolean;
    externalOrderId?: string | null;
    isComboOnly?: boolean;
    createdAt?: string | Date;
    wholesaleApprovalStatus?: WholesaleApprovalStatus | null;
    wholesaleDetectedAt?: string | Date | null;
    wholesaleDetectedByRuleId?: string | null;
    wholesaleReviewNote?: string | null;
    wholesaleReviewedAt?: string | Date | null;
    wholesaleReviewedById?: string | null;
    WholesaleRule?: { id: string; name: string } | null;
    WholesaleReviewedBy?: { name: string } | null;
    Customer?: {
        id: string;
        phone: string;
        name: string;
    };
    updatedAt: string | Date;
};

export type OrderOpenLock = {
    orderId: string;
    token: string;
    staffId: string;
    staffName: string;
    staffCode?: string | null;
    openedAt: string; // ISO
    lastSeenAt: string; // ISO
};

export type OrderOpenLockAcquireResult =
    | { success: true; acquired: true; overridden?: boolean; previousLock?: OrderOpenLock; lock: OrderOpenLock }
    | { success: false; acquired: false; lock: OrderOpenLock };

export type OrderUpdateInput = Partial<Omit<Order, 'logs' | 'shippingAddress' | 'products'>> & {
    shippingAddress?: Partial<Order['shippingAddress']>;
    products?: OrderProduct[];
    items?: OrderProduct[];
    paidFromAccountId?: string | null;
    refundAccountId?: string | null;
    expectedUpdatedAt?: string;
    lockToken?: string;
};


export type Customer = {
    id: string;
    name: string;
    email?: string;
    phone: string;
    ip?: string | null;
    totalOrders: number;
    totalSpent: number;
    joinDate: string;
    createdAt?: string;
    address: string;
    district: string;
    country: string;
    type: CustomerType;
};

export type CustomerCreateInput = Omit<Customer, 'id' | 'totalOrders' | 'totalSpent' | 'joinDate'>;
export type CustomerUpdateInput = Partial<Omit<Customer, 'id' | 'totalOrders' | 'totalSpent' | 'joinDate'>>;


export type StockLocation = {
    id: string;
    name: string;
};

export type InventoryMovementType = 'Received' | 'Sold' | 'Adjusted' | 'Returned' | 'Transfer';

export type StockTransfer = {
    id: string;
    fromLocationId: string;
    toLocationId: string;
    notes?: string;
    user: string;
};

export type InventoryMovement = {
    id: string;
    date: string;
    type: InventoryMovementType;
    quantityChange: number; // Positive for additions, negative for subtractions
    balance: number;
    notes: string;
    user: string;
    reference: string; // e.g., Order ID, PO ID, Transfer ID
    fromLocationId?: string;
    toLocationId?: string;
    // Expanded fields from server
    variantName?: string;
    productName?: string;
    sku?: string;
    locationName?: string;
    lotNumber?: string;
};


export type InventoryItem = {
    id: string;
    productId: string;
    productName: string;
    variantName?: string;
    sku: string;
    quantity: number;
    reservedQuantity: number;
    unitCost?: number;
    avgUnitCost?: number;
    totalCost?: number;
    locationId: string;
    locationName: string;
    lotNumber: string;
    receivedDate: string;
    variantId?: string;
    sourceItemIds?: string[];
    productSku?: string;
    variantSku?: string;
    productImage?: string;
    variantImage?: string;
    variantAttributes?: Record<string, string>;
};

export type PurchaseOrderStatus = 'Draft' | 'Fabric Ordered' | 'Printing' | 'Cutting' | 'Received' | 'Cancelled';
export type PaymentStatus = 'Unpaid' | 'Partial' | 'Paid';
export type PurchaseType = 'three-piece' | 'general';
export type ProductionStepType = 'FABRIC' | 'PRINTING' | 'CUTTING' | 'FINISHING';
export type ProductionCurrentStep = 'PLANNING' | 'FABRIC' | 'PRINTING' | 'CUTTING' | 'COMPLETED';
export type FabricPart = 'JAMA' | 'ORNA' | 'SELOWAR';

export type ProductionStep = {
    id: string;
    poId: string;
    stepType: ProductionStepType;
    vendorId?: string | null;
    fabricInventoryId?: string | null;
    vendor?: Vendor;
    costAmount: number;
    paidAmount: number;
    inputQty: number;
    outputQty: number;
    damagedQty: number;
    wastageQty: number;
    pindiOfFab?: number | null;
    invoiceUrl?: string | null;
    generatedInvoiceNumber?: string | null;
    isApproved: boolean;
    cuttingType?: string | null;
    assignedStaffId?: string | null;
    note?: string | null;
};

export type PurchaseOrderLog = {
    status: PurchaseOrderStatus;
    timestamp: string;
    description: string;
    user: string;
};

export type CheckStatus = 'Pending' | 'Passed' | 'Bounced' | 'Cancelled';

export type Payment = {
    id?: string;
    cash: number;
    check: number;
    checkDate: string;
    checkStatus?: CheckStatus;
    checkNo?: string;
    physicalInvoiceUrl?: string;
    productionStepId?: string;
    vendorId?: string | null;
    paymentFor?: string;
    paidFromAccountId?: string | null;
    paymentMethod?: string | null;
    date?: string;
};

export type FabricLotUsage = {
    id: string;
    poId: string;
    itemId: string;
    part: FabricPart;
    inventoryItemId: string;
    yards: number;
    unitCost: number;
    lotNumber?: string;
    locationName?: string;
    productName?: string;
    sku?: string;
};

export type PurchaseOrder = {
    id: string;
    supplier: string;
    supplierId?: string;
    date: string;
    status: PurchaseOrderStatus;
    paymentStatus: PaymentStatus;
    total: number;
    items: number;
    type: PurchaseType;
    currentStep: ProductionCurrentStep;
    offlineInvoiceUrl?: string | null;
    productionSteps: ProductionStep[];
    productionPayments?: Partial<Record<ProductionStepType, Payment>>;
    logs: PurchaseOrderLog[];
    payment?: Payment; // For general purchases or aggregated fallback
    payments?: Payment[]; // Full payment list
    purchaseItems?: {
        id: string;
        productId: string;
        productName: string;
        variantId?: string | null;
        variantName?: string | null;
        sku?: string | null;
        quantity: number; // planned qty
        finalQty?: number | null; // final received qty
        receivedQty?: number; // cumulative received qty
        generalWastageQty?: number; // cumulative wastage qty
        unitCost: number;

        // Fabric (per variant/product)
        jamaYards: number;
        jamaRate: number;
        ornaYards: number;
        ornaRate: number;
        selowarYards: number;
        selowarRate: number;
        fabricCost: number;

        // Pinda
        pindaCount?: number;
        pindaBreakdown?: number[];

        // Step costs (total per line)
        printingCost: number;
        printingDamagedQty: number;
        cuttingCost: number;
        cuttingDamagedQty: number;
        finishingWastageQty: number;
        totalCost: number; // fabric + printing + cutting
        fabricLotUsages?: FabricLotUsage[];
        imageUrl?: string | null;
    }[];
    // Legacy/compatibility fields (to be replaced by productionSteps-driven UI)
    fabricPayment?: Payment;
    printingPayment?: Payment;
    printingVendorId?: string;
    printingVendor?: string;
    printingVendorPhone?: string;
    cuttingPayment?: Payment;
    cuttingVendorId?: string;
    cuttingVendor?: string;
    cuttingVendorPhone?: string;
    fabricSentQty?: number;
    fabricDamagedQty?: number;
    printingReceivedQty?: number;
    printingDamagedQty?: number;
    printingSentQty?: number;
    cuttingReceivedQty?: number;
    cuttingDamagedQty?: number;
    finalReceivedQty?: number;
    finalDamagedQty?: number;
    businessId?: string;
    businessName?: string;
    businessLogo?: string;
    lineItems?: {
        productName: string;
        sku?: string | null;
        quantity: number;
        unitCost: number;
        lineTotal: number;
        pindaCount?: number;
        pindaBreakdown?: number[]; // Added for invoice
        receivedQty?: number;
    }[];
    hasInternalFabric?: boolean;
};

export type ThreePieceOrderItem = {
    id: string;
    productId: string;
    variantId?: string;
    quantity: number; // final pieces to produce (planned)

    // Fabric breakdown per item (yards + rate per yard)
    jamaYards: number;
    jamaRate: number;
    ornaYards: number;
    ornaRate: number;
    selowarYards: number;
    selowarRate: number;

    // Derived total fabric cost for this line
    lineTotal: number;

    // Optional/Extended fields used in draft/production
    printingCost?: number;
    cuttingCost?: number;
    lotAllocations?: any;
    receivedQty?: number;
};

export type GeneralOrderItem = {
    id: string;
    productId: string;
    variantId?: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
    pindaCount?: number;
    pindaQuantities?: number[];
    receivedQty?: number;
};

export type PaymentDetails = { // Legacy
    cash: number;
    check: number;
    checkDate: string;
    paidFromAccountId?: string | null;
    paymentMethod?: string | null;
};

export type PurchasePaymentItem = {
    accountId: string;
    method: string;
    amount: number;
    checkNo?: string;
    checkDate?: string;
    physicalInvoiceUrl?: string;
};


export type StaffIncome = {
    date: string;
    orderId: string;
    orderNumber?: string | null;
    action: 'Created' | 'Confirmed' | 'Packed' | 'Salary' | 'Cutting';
    amount: number;
    notes?: string | null;
    referenceDate?: string | null;
    createdAt?: string | null;
};

export type StaffPayment = {
    id?: string;
    date: string;
    amount: number;
    notes: string;
    check?: number;
    checkDate?: string | null;
    checkStatus?: CheckStatus;
    checkNo?: string;
    paidFromAccountId?: string | null;
    paidAt?: string | null;
};

export type AttendanceEditLog = {
    id: string;
    attendanceId: string;
    editedById?: string;
    editorName?: string;
    editedByName?: string; // from API mapping
    reason: string;
    oldCheckIn?: string | null;
    newCheckIn?: string | null;
    oldCheckOut?: string | null;
    newCheckOut?: string | null;
    oldStatus?: string | null;
    newStatus?: string | null;
    oldInactiveDuration?: number | null;
    newInactiveDuration?: number | null;
    oldOvertimeMinutes?: number | null;
    newOvertimeMinutes?: number | null;
    createdAt: string;
    oldData?: any; // for generic fallback in UI
    newData?: any;
};

export type StaffFine = {
    id: string;
    staffId: string;
    date: string;
    amount: number;
    reason: string;
    notes?: string | null;
    status: 'Active' | 'Voided';
    createdByName?: string | null;
    voidedAt?: string | null;
    voidedByName?: string | null;
};

export type Permission = {
    create: boolean;
    read: boolean;
    update: boolean;
    delete: boolean;
};

export type StaffRole =
    | 'SuperAdmin'
    | 'Admin'
    | 'Manager'
    | 'Project Manager'
    | 'Office Assistant'
    | 'Packing Assistant'
    | 'Moderator'
    | 'Seller'
    | 'Call Assistant'
    | 'Call Centre Manager'
    | 'Courier Manager'
    | 'Courier Call Assistant'
    | 'Vendor/Supplier'
    | 'Partner'
    | 'Cutting Master'
    | 'Marketer'
    | 'Finance Manager'
    | 'Modarator Manager'
    | 'Sales Representative'
    | 'Custom';

export type StaffWorkType = 'Office' | 'Remote';

export type StaffMemberUI = {
    id: string;
    clerkId: string;
    staffCode: string;
    status: string;
    avatarUrl?: string | null;
    name: string;
    email: string;
    phone: string;
    role: StaffRole;
    workType: StaffWorkType;
    designation?: string | null;
    accessibleBusinessIds?: string[];
    accessibleBusinesses?: { id: string; name: string; }[];
    weekendDays?: number[] | null;
    lastLogin: string;
    createdAt: string;
    paymentType: 'Salary' | 'Commission' | 'Both';
    salaryDetails?: {
        amount: number;
        frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';
    };
    commissionDetails?: {
        onOrderCreate?: number;
        onOrderConfirm?: number;
        onOrderPacked?: number;
        onOrderConvert?: number;
        targetEnabled?: boolean;
        targetPeriod?: 'Daily' | 'Weekly' | 'Monthly';
        targetCount?: number;
    };
    overtimeEligible?: boolean;
    overtimeBonusPercent?: number;
    performance: {
        ordersCreated: number;
        ordersConfirmed: number;
        ordersWorked?: number;
        totalOrderActions?: number;
        incompleteWorked?: number;
        incompleteConverted?: number;
        incompleteConversionRate?: number;
        statusBreakdown: Partial<Record<OrderStatus, number>>;
        createdStatusBreakdown?: Record<string, number>;
        confirmedStatusBreakdown?: Record<string, number>;
    };
    financials: {
        totalEarned: number;
        totalPaid: number;
        totalFines: number;
        dueAmount: number;
    };
    paymentHistory: StaffPayment[];
    fineHistory?: StaffFine[];
    incomeHistory: StaffIncome[];
    shiftOverride?: {
        startTime: string;
        endTime: string;
        lateGraceMinutes: number;
        earlyLeaveGraceMinutes: number;
    } | null;
    permissions: {
        orders: Permission | boolean;
        packingOrders: Permission | boolean;
        products: Permission | boolean;
        inventory: Permission | boolean;
        customers: Permission | boolean;
        purchases: Permission | boolean;
        expenses: Permission | boolean;
        checkPassing: Permission | boolean;
        partners: Permission | boolean;
        courierReport: Permission | boolean;
        courierManagement: Permission | boolean;
        staff: Permission | boolean;
        settings: Permission | boolean;
        analytics: Permission | boolean;
        issues: Permission | boolean;
        attendance: Permission | boolean;
        accounting: Permission | boolean;
        marketing: Permission | boolean;
        tasks: Permission | boolean;
        integrations: Permission | boolean;
        wholesaleManagement: Permission | boolean;
        pageAccess?: Record<string, boolean>;
    };
    // Job dates
    jobStartDate?: string | null;
    jobEndDate?: string | null;
    // Invitation metadata
    invitedName?: string | null;
    invitedEmail?: string | null;
    invitedPhone?: string | null;
};

export type WebhookFailure = {
    id: string;
    source: string;
    integrationId?: string | null;
    externalOrderId?: string | null;
    orderId?: string | null;
    error: string;
    status: 'Open' | 'Resolved' | 'Ignored';
    createdAt: string;
    lastSeenAt: string;
    occurrences: number;
    payload?: any;
    meta?: any;
};

export type StaffMember = StaffMemberUI;

export type Supplier = {
    id: string;
    name: string;
    contactPerson: string;
    email: string;
    phone: string;
    address: string;
    creditBalance?: number;
};

export type OrderLog = {
    id: string;
    orderId: string;
    title: string;
    description: string;
    user: string;
    userId?: string | null;
    meta?: any;
    timestamp: string;
    staff?: StaffMemberUI | null;
};

export type Vendor = {
    id: string;
    name: string;
    type: string;
    contactPerson: string;
    email: string;
    phone: string;
    creditBalance?: number;
};

export type Expense = {
    id: string;
    date: string;
    category: string;
    categoryId?: string;
    amount: number;
    notes?: string;
    notesDisplay?: string;
    staffName?: string;
    staffCode?: string;
    staffId?: string;
    isAdExpense: boolean;
    isPaid?: boolean;
    paidFromAccountId?: string | null;
    payableAccountId?: string | null;
    check?: number;
    checkDate?: string | null;
    checkStatus?: CheckStatus;
    checkNo?: string;
    paidAt?: string | null;
    businessId?: string;
    business?: string;
    platform?: OrderPlatform;
    approvalStatus: ExpenseApprovalStatus;
    submittedById?: string | null;
    submittedByName?: string | null;
    submittedAt?: string | null;
    approvedById?: string | null;
    approvedByName?: string | null;
    approvedAt?: string | null;
    rejectedById?: string | null;
    rejectedByName?: string | null;
    rejectedAt?: string | null;
    rejectionNote?: string | null;
    paidById?: string | null;
    paidByName?: string | null;
    branchId?: string | null;
    branchName?: string | null;
};

export type Branch = {
    id: string;
    name: string;
    code?: string | null;
    isActive: boolean;
    createdAt?: string;
    updatedAt?: string;
};

export type WooCommerceIntegration = {
    id: string;
    storeName: string;
    storeUrl: string;
    consumerKey: string;
    consumerSecret: string;
    status: 'Active' | 'Inactive';
    businessId: string;
    businessName: string;
    apiKey?: string;
    settings?: any;
    autoSyncEnabled?: boolean;
    incompleteEnabled?: boolean;
    restrictionEnabled?: boolean;
    restrictionScope?: string;
    restrictionDurationType?: string;
    restrictionDurationValue?: number;
    restrictionMessage?: string | null;
    restrictionSupportPhone?: string | null;
    dedupeMinutes?: number;
    debounceMs?: number;
    retrySeconds?: number;
    webhookUrl?: string;
    webhookSecret?: string;
};

export type PathaoCredentials = {
    clientId: string;
    clientSecret: string;
    username: string;
    password?: string;
    storeId: string;
    defaultWeight?: number;
    defaultCityId?: number;
    defaultZoneId?: number;
    defaultAreaId?: number;
    specialInstruction?: string;
    webhookSecret?: string;
    webhookIntegrationSecret?: string;
    rateConfig?: CourierRateConfig;
    debugLogging?: boolean;
};

export type SteadfastCredentials = {
    apiKey: string;
    secretKey: string;
    webhookToken?: string;
    rateConfig?: CourierRateConfig;
};

export type RedXCredentials = {
    accessToken: string;
};

export type CourierRateConfig = {
    codChargePercent?: number;
    insideCharge?: number;
    subCharge?: number;
    outsideCharge?: number;
    zoneMap?: {
        insideCityIds?: number[];
        subCityIds?: number[];
        subZoneIds?: number[];
        insideZoneIds?: number[];
    };
};

export type CarrybeeCredentials = {
    baseUrl?: string;
    clientId: string;
    clientSecret: string;
    clientContext: string;
    storeId?: string;
    defaultCityId?: number;
    defaultZoneId?: number;
    defaultAreaId?: number;
    defaultWeightGrams?: number;
    specialInstruction?: string;
    webhookSecret?: string;
    webhookIntegrationHeaderValue?: string;
    deliveryType?: number; // 1 Normal, 2 Express
    productType?: number; // 1 Parcel, 2 Book, 3 Document
    rateConfig?: CourierRateConfig;
    debugLogging?: boolean;
};

export type CourierIntegration = {
    id: string;
    businessId: string;
    businessName: string;
    courierName: CourierService;
    status: 'Active' | 'Inactive';
    credentials: PathaoCredentials | SteadfastCredentials | RedXCredentials | CarrybeeCredentials;
    deliveryType?: 48 | 12; // For Pathao: 48 for Normal, 12 for On Demand
    itemType?: 1 | 2; // For Pathao: 1 for Document, 2 for Parcel
};

export type CourierPayment = {
    id: string;
    courierService: string;
    businessId: string;
    businessName?: string;
    direction?: 'Received' | 'Paid';
    amount: number;
    paymentDate: string;
    referenceNo?: string | null;
    note?: string | null;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    receivedAccountId?: string | null;
};

export type CourierMetrics = {
    totalParcels: number;
    totalCodSent: number;
    totalCharges: number;
    expectedPayment: number;
    receivedPayment: number;
    pendingPayment: number;
    returnPendingCount: number;
    returnPendingCod: number;
    returnCharges: number;
};

export type ReturnPendingOrder = {
    id: string;
    orderNumber?: string | null;
    customerName?: string;
    businessId?: string | null;
    businessName?: string | null;
    courierService?: string | null;
    courierStatus?: string | null;
    courierDispatchedAt?: string | null;
    actualCodAmount?: number | null;
    courierDeliveryCharge?: number | null;
};

// Issue Management Types
export type IssueStatus = 'Open' | 'In Progress' | 'Resolved' | 'Closed';
export type IssuePriority = 'Low' | 'Medium' | 'High';

export type IssueLog = {
    id: string;
    timestamp: string;
    user: string;
    action: string;
};

export type Issue = {
    id: string;
    orderId?: string;
    orderNumber?: string | null;
    title: string;
    description: string;
    status: IssueStatus;
    priority: IssuePriority;
    createdBy: string;
    assignedTo?: string;
    createdAt: string;
    resolvedAt?: string;
    logs: IssueLog[];
};

// Attendance Management Types
export type BreakRecord = {
    id: string;
    startTime: string;
    endTime: string | null;
};

export type AttendanceInactiveRecord = {
    id: string;
    startTime: string;
    endTime: string | null;
};

export type AttendanceStatus = 'Present' | 'Absent' | 'On Leave' | 'Late' | 'Not Due' | 'Not Arrived' | 'Off Day';

export type AttendanceRecord = {
    id: string;
    staffId: string;
    staffName: string;
    staffRole: StaffRole;
    staffAvatar: string;
    staffWorkType: StaffWorkType;
    staffDesignation?: string | null;
    date: string;
    status: AttendanceStatus;
    checkInTime: string | null;
    checkOutTime: string | null;
    totalWorkDuration: number | null; // in minutes
    totalBreakDuration: number | null; // in minutes
    totalInactiveDuration?: number | null; // in minutes
    breaks: BreakRecord[];
    inactiveRecords?: AttendanceInactiveRecord[];
    isWeekend?: boolean;
    isHoliday?: boolean;
    expectedMinutes?: number | null;
    overtimeMinutes?: number | null;
    leaveType?: string;
    overtimeBonusAmount?: number | null;
    shiftStartTime?: string | null;
    lateGraceMinutes?: number | null;
};

// Leave Types
export type LeaveRequestStatus = 'Pending' | 'ManagerApproved' | 'AdminApproved' | 'Rejected' | 'Cancelled';

export type LeaveTypeUI = {
    id: string;
    name: string;
    isPaid: boolean;
    annualAllocation: number;
    maxCarryForward: number;
    isActive: boolean;
};

export type LeaveBalanceUI = {
    leaveTypeId: string;
    leaveTypeName: string;
    isPaid: boolean;
    allocated: number;
    used: number;
    carried: number;
    remaining: number;
};

export type LeaveRequestUI = {
    id: string;
    staffId: string;
    staffName: string;
    staffRole?: string;
    leaveTypeId: string;
    leaveTypeName: string;
    isPaid: boolean;
    fromDate: string;
    toDate: string;
    days: number;
    reason?: string | null;
    status: LeaveRequestStatus;
    managerApprovedAt?: string | null;
    adminApprovedAt?: string | null;
    rejectedAt?: string | null;
    createdAt: string;
};

// Shift Types
export type ShiftTemplateUI = {
    id: string;
    name: string;
    role?: string | null;
    startTime: string;
    endTime: string;
    lateGraceMinutes: number;
    earlyLeaveGraceMinutes: number;
    isActive: boolean;
};

export type StaffShiftOverrideUI = {
    id: string;
    staffId: string;
    startTime: string;
    endTime: string;
    lateGraceMinutes: number;
    earlyLeaveGraceMinutes: number;
    isActive: boolean;
};

// Attendance Edit Log
export type AttendanceEditLogUI = {
    id: string;
    attendanceId: string;
    editedByName: string;
    reason: string;
    oldCheckIn?: string | null;
    newCheckIn?: string | null;
    oldCheckOut?: string | null;
    newCheckOut?: string | null;
    oldStatus?: string | null;
    newStatus?: string | null;
    oldOvertimeMinutes?: number | null;
    newOvertimeMinutes?: number | null;
    oldInactiveDuration?: number | null;
    newInactiveDuration?: number | null;
    createdAt: string;
};

// --- Accounting Module Types ---

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Revenue' | 'Expense';

export type Account = {
    id: string;
    name: string;
    type: AccountType;
    group?: string | null;
};

export type LedgerEntry = {
    id: string;
    date: string;
    entryNumber?: string | null;
    description: string;
    sourceTransactionId: string; // e.g. ORD-2024-001 or EXP-001
    sourceLabel?: string | null;
    accountId: string;
    businessId?: string | null;
    snapshotId?: string | null;
    postingGroup?: string | null;
    debit: number;
    credit: number;
};

export type LedgerEntryPage = {
    entries: LedgerEntry[];
    nextCursor: string | null;
};

export type OrderFinancialSnapshot = {
    id: string;
    orderId: string;
    businessId?: string | null;
    statusAtSnapshot: string;
    revenue: number;
    cogs: number;
    courierExpense: number;
    courierReceivable: number;
    courierPayable: number;
    cashReceived: number;
    returnFeeRevenue: number;
    netProfit: number;
    cogsEstimated: boolean;
    computedAt: string;
};

export type OrderStockAllocation = {
    id: string;
    orderId: string;
    inventoryItemId: string;
    productId: string;
    variantId?: string | null;
    quantity: number;
    unitCost: number;
    totalCost: number;
    action: string;
    createdAt: string;
};

export type OrderPaymentEvent = {
    id: string;
    orderId: string;
    businessId?: string | null;
    eventType: string;
    amount: number;
    accountId?: string | null;
    createdAt: string;
};

export type BalanceSheetCategory = {
    accounts: {
        id: string;
        name: string;
        balance: number;
    }[];
    total: number;
};

export type BalanceSheet = {
    asOf: string;
    assets: BalanceSheetCategory;
    liabilities: BalanceSheetCategory;
    equity: BalanceSheetCategory;
};

// --- Marketing Types ---

export type MarketingCampaign = {
    id: string;
    name: string;
    businessId?: string | null;
    marketerId?: string | null;
    trackedProductIds?: string[];
    trackedProducts?: {
        id: string;
        name: string;
        sku?: string | null;
    }[];
    channel?: string | null;
    objective?: string | null;
    status?: string | null;
    budget: number;
    targetCpr?: number | null;
    maxCpr?: number | null;
    startDate?: string | null;
    endDate?: string | null;
    notes?: string | null;
    createdAt: string;
    updatedAt: string;
    spent: number;
    attributedOrders: number;
    attributedRevenue: number;
    profit: number;
    cpr: number;
    roas: number;
    // CPR performance metrics (marketer view)
    actualCpr?: number;
    profitScore?: number;
    performanceStatus?: 'Excellent' | 'OK' | 'Loss';
    // Admin-only
    adminRevenue?: number;
    adminCogs?: number;
    adminCourierExpense?: number;
    adminRealProfit?: number;
    revenueWithoutShipping?: number;
    courierExpense?: number;
    businessName?: string;
    marketerName?: string;
};

export type MarketingSpend = {
    id: string;
    campaignId: string;
    campaignName?: string;
    businessId?: string | null;
    date: string;
    amount: number;
    notes?: string | null;
    createdById?: string | null;
    createdByName?: string;
    createdAt: string;
};

export type MarketingAttribution = {
    id: string;
    campaignId: string;
    orderId: string;
    orderNumber?: string;
    orderTotal?: number;
    attributedAt: string;
};

export type MarketingOverview = {
    totalSpend: number;
    attributedOrders: number;
    attributedRevenue: number;
    totalProfit: number;
    overallCPR: number;
    overallROAS: number;
    perMarketer: {
        marketerId: string;
        marketerName: string;
        spend: number;
        orders: number;
        revenue: number;
        profit: number;
        cpr: number;
        roas: number;
    }[];
    recentCampaigns: MarketingCampaign[];
    // Admin-only fields
    totalRevenue?: number;
    totalRevenueWithoutShipping?: number;
    totalCOGS?: number;
    totalCourierExpense?: number;
    adminRealProfit?: number;
};

