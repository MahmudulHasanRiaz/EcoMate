import { ORDER_STATUSES } from './order-statuses';

export const PURCHASE_STATUSES = [
  'Draft',
  'FabricOrdered',
  'Printing',
  'Cutting',
  'Received',
  'Cancelled',
] as const;

export type NotificationTemplate = {
  enabled: boolean;
  smsEnabled: boolean;
  smsBody: string;
  emailEnabled: boolean;
  emailBody: string;
};

export type NotificationSettings = {
  orders: Record<string, NotificationTemplate>;
  purchases: Record<string, NotificationTemplate>;
  staff: {
    paymentCleared: NotificationTemplate;
    fineRecorded: NotificationTemplate;
  };
  partners: {
    paymentReceived: NotificationTemplate;
    billCreated: NotificationTemplate;
  };
};

export const ORDER_VARIABLES = [
  { name: 'Customer Name', value: '{{customerName}}' },
  { name: 'Order ID', value: '{{orderId}}' },
  { name: 'Order Total', value: '{{orderTotal}}' },
  { name: 'Order Date', value: '{{orderDate}}' },
  { name: 'Shipping Address', value: '{{shippingAddress}}' },
  { name: 'Status', value: '{{status}}' },
  { name: 'Store Name', value: '{{storeName}}' },
];

export const PURCHASE_VARIABLES = [
  { name: 'PO Number', value: '{{poNumber}}' },
  { name: 'Supplier Name', value: '{{supplierName}}' },
  { name: 'Vendor Name', value: '{{vendorName}}' },
  { name: 'PO Total', value: '{{poTotal}}' },
  { name: 'Bill Amount (Step)', value: '{{billAmount}}' },
  { name: 'PO Date', value: '{{poDate}}' },
  { name: 'Status', value: '{{status}}' },
  { name: 'Store Name', value: '{{storeName}}' },
];

export const STAFF_VARIABLES = [
  { name: 'Staff Name', value: '{{staffName}}' },
  { name: 'Payment Amount', value: '{{paymentAmount}}' },
  { name: 'Payment Date', value: '{{paymentDate}}' },
  { name: 'Due Amount', value: '{{dueAmount}}' },
  { name: 'Store Name', value: '{{storeName}}' },
];

export const STAFF_FINE_VARIABLES = [
  { name: 'Staff Name', value: '{{staffName}}' },
  { name: 'Fine Amount', value: '{{fineAmount}}' },
  { name: 'Fine Reason', value: '{{fineReason}}' },
  { name: 'Fine Date', value: '{{fineDate}}' },
  { name: 'Due Amount', value: '{{dueAmount}}' },
  { name: 'Store Name', value: '{{storeName}}' },
];

export const PARTNER_VARIABLES = [
  { name: 'Partner Name', value: '{{partnerName}}' },
  { name: 'Partner Type', value: '{{partnerType}}' },
  { name: 'Payment Amount', value: '{{paymentAmount}}' },
  { name: 'Bill Amount', value: '{{billAmount}}' },
  { name: 'Previous Due', value: '{{previousDue}}' },
  { name: 'Next Due', value: '{{nextDue}}' },
  { name: 'Store Name', value: '{{storeName}}' },
];

const baseTemplate = (smsBody: string, emailBody: string): NotificationTemplate => ({
  enabled: true,
  smsEnabled: true,
  smsBody,
  emailEnabled: false,
  emailBody,
});

const orderTemplateForStatus = (status: string) =>
  baseTemplate(
    `Your order {{orderId}} is now ${status}.`,
    `Hi {{customerName}}, your order {{orderId}} is now ${status}.`
  );

const purchaseTemplateForStatus = (status: string) =>
  baseTemplate(
    `PO {{poNumber}} is now ${status}. Bill: {{billAmount}}.`,
    `PO {{poNumber}} is now ${status}. Bill: {{billAmount}}.`
  );

const staffPaymentTemplate = () =>
  baseTemplate(
    `Payment received: {{paymentAmount}} for {{staffName}}. Due: {{dueAmount}}.`,
    `Payment received: {{paymentAmount}} for {{staffName}}. Due: {{dueAmount}}.`
  );

const staffFineTemplate = () =>
  baseTemplate(
    `Fine recorded: {{fineAmount}} for {{staffName}}. Reason: {{fineReason}}. Due: {{dueAmount}}.`,
    `Fine recorded: {{fineAmount}} for {{staffName}}. Reason: {{fineReason}}. Due: {{dueAmount}}.`
  );

const partnerPaymentTemplate = () =>
  baseTemplate(
    `Payment received: {{paymentAmount}} for {{partnerName}}. Next due: {{nextDue}}.`,
    `Payment received: {{paymentAmount}} for {{partnerName}}. Next due: {{nextDue}}.`
  );

const partnerBillTemplate = () =>
  baseTemplate(
    `Bill created for {{partnerName}}: {{billAmount}}. Prev due: {{previousDue}}. Current due: {{nextDue}}.`,
    `Bill created for {{partnerName}}: {{billAmount}}. Prev due: {{previousDue}}. Current due: {{nextDue}}.`
  );

export function getDefaultNotificationSettings(): NotificationSettings {
  const orders: Record<string, NotificationTemplate> = {};
  ORDER_STATUSES.forEach((status) => {
    orders[status] = orderTemplateForStatus(status);
  });

  const purchases: Record<string, NotificationTemplate> = {};
  PURCHASE_STATUSES.forEach((status) => {
    purchases[status] = purchaseTemplateForStatus(status);
  });

  return {
    orders,
    purchases,
    staff: {
      paymentCleared: staffPaymentTemplate(),
      fineRecorded: staffFineTemplate(),
    },
    partners: {
      paymentReceived: partnerPaymentTemplate(),
      billCreated: partnerBillTemplate(),
    },
  };
}

function normalizeTemplate(
  input: Partial<NotificationTemplate> | null | undefined,
  fallback: NotificationTemplate
): NotificationTemplate {
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : fallback.enabled,
    smsEnabled: typeof input?.smsEnabled === 'boolean' ? input.smsEnabled : fallback.smsEnabled,
    smsBody: typeof input?.smsBody === 'string' && input.smsBody.trim().length
      ? input.smsBody
      : fallback.smsBody,
    emailEnabled: typeof input?.emailEnabled === 'boolean' ? input.emailEnabled : fallback.emailEnabled,
    emailBody: typeof input?.emailBody === 'string' && input.emailBody.trim().length
      ? input.emailBody
      : fallback.emailBody,
  };
}

export function normalizeNotificationSettings(
  value?: Partial<NotificationSettings> | null
): NotificationSettings {
  const defaults = getDefaultNotificationSettings();
  const output: NotificationSettings = {
    orders: {},
    purchases: {},
    staff: {
      paymentCleared: defaults.staff.paymentCleared,
      fineRecorded: defaults.staff.fineRecorded,
    },
    partners: {
      paymentReceived: defaults.partners.paymentReceived,
      billCreated: defaults.partners.billCreated,
    },
  };

  const orderInput = (value?.orders ?? {}) as Record<string, Partial<NotificationTemplate>>;
  Object.keys(defaults.orders).forEach((status) => {
    output.orders[status] = normalizeTemplate(orderInput[status], defaults.orders[status]);
  });

  const purchaseInput = (value?.purchases ?? {}) as Record<string, Partial<NotificationTemplate>>;
  Object.keys(defaults.purchases).forEach((status) => {
    output.purchases[status] = normalizeTemplate(purchaseInput[status], defaults.purchases[status]);
  });

  const staffInput = value?.staff;
  output.staff.paymentCleared = normalizeTemplate(staffInput?.paymentCleared, defaults.staff.paymentCleared);
  output.staff.fineRecorded = normalizeTemplate(staffInput?.fineRecorded, defaults.staff.fineRecorded);

  const partnersInput = value?.partners;
  output.partners.paymentReceived = normalizeTemplate(partnersInput?.paymentReceived, defaults.partners.paymentReceived);
  output.partners.billCreated = normalizeTemplate(partnersInput?.billCreated, defaults.partners.billCreated);

  return output;
}
