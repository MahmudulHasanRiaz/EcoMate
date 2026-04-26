import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export function formatLabel(label: string | undefined | null) {
  if (!label) return '';
  const statusLabelMap: Record<string, string> = {
    Packing_Hold: 'Packing Hold',
    In_Courier: 'In-Courier',
    RTS__Ready_to_Ship_: 'RTS (Ready to Ship)',
    Return_Pending: 'Return Pending',
    Paid_Return: 'Paid Return',
    Incomplete_Cancelled: 'Incomplete-Cancelled',
  };
  if (statusLabelMap[label]) return statusLabelMap[label];
  // Convert CamelCase or PascalCase to "Camel Case"
  return label
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^./, (str) => str.toUpperCase());
}

export function formatPrice(price: number | string | undefined | null) {
  const p = Number(price || 0);
  return p.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCurrency(amount: number | string | undefined | null) {
  const a = Number(amount || 0);
  return '৳' + a.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
