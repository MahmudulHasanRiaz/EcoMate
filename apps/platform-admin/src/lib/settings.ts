export const PAYMENT_METHOD_TYPES = [
  'BKASH',
  'NAGAD',
  'ROCKET',
  'BANK',
  'MANUAL',
] as const;

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  BKASH: 'bKash',
  NAGAD: 'Nagad',
  ROCKET: 'Rocket',
  BANK: 'Bank transfer',
  MANUAL: 'Manual',
};

export function paymentMethodLabel(type: string): string {
  return PAYMENT_METHOD_LABELS[type] ?? type;
}

export function smtpSourceLabel(source: string): string {
  switch (source) {
    case 'env':
      return 'From environment (SMTP_HOST set)';
    case 'setting':
      return 'From platform settings';
    default:
      return 'Not configured';
  }
}
