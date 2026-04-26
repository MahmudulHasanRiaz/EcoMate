export type BadgeRule = {
  id: string;
  label: string;
  min: number;
  color: string;
  description?: string;
};

export type BadgeRules = {
  customerOrders: BadgeRule[];
  staffOrdersCreated: BadgeRule[];
  staffOrdersConfirmed: BadgeRule[];
  staffDeliverySuccess: BadgeRule[];
};

export const BADGE_COLOR_OPTIONS = [
  { value: "bg-slate-100 text-slate-700 border-slate-200", label: "Slate" },
  { value: "bg-emerald-100 text-emerald-700 border-emerald-200", label: "Emerald" },
  { value: "bg-blue-100 text-blue-700 border-blue-200", label: "Blue" },
  { value: "bg-purple-100 text-purple-700 border-purple-200", label: "Purple" },
  { value: "bg-amber-100 text-amber-700 border-amber-200", label: "Amber" },
  { value: "bg-rose-100 text-rose-700 border-rose-200", label: "Rose" },
];

export const defaultBadgeRules: BadgeRules = {
  customerOrders: [
    { id: "cust-bronze", label: "Bronze Buyer", min: 1, color: "bg-amber-100 text-amber-700 border-amber-200" },
    { id: "cust-silver", label: "Silver Buyer", min: 5, color: "bg-slate-100 text-slate-700 border-slate-200" },
    { id: "cust-gold", label: "Gold Buyer", min: 15, color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
    { id: "cust-vip", label: "VIP Buyer", min: 30, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  ],
  staffOrdersCreated: [
    { id: "staff-create-1", label: "Creator", min: 10, color: "bg-blue-100 text-blue-700 border-blue-200" },
    { id: "staff-create-2", label: "Pro Creator", min: 50, color: "bg-indigo-100 text-indigo-700 border-indigo-200" },
    { id: "staff-create-3", label: "Elite Creator", min: 120, color: "bg-purple-100 text-purple-700 border-purple-200" },
    { id: "staff-create-4", label: "Legend Creator", min: 250, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  ],
  staffOrdersConfirmed: [
    { id: "staff-confirm-1", label: "Closer", min: 10, color: "bg-amber-100 text-amber-700 border-amber-200" },
    { id: "staff-confirm-2", label: "Top Closer", min: 40, color: "bg-orange-100 text-orange-700 border-orange-200" },
    { id: "staff-confirm-3", label: "Ace Closer", min: 100, color: "bg-rose-100 text-rose-700 border-rose-200" },
    { id: "staff-confirm-4", label: "Master Closer", min: 200, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  ],
  staffDeliverySuccess: [
    { id: "staff-dlv-1", label: "Reliable", min: 70, color: "bg-sky-100 text-sky-700 border-sky-200" },
    { id: "staff-dlv-2", label: "Trusted", min: 80, color: "bg-blue-100 text-blue-700 border-blue-200" },
    { id: "staff-dlv-3", label: "Excellent", min: 90, color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    { id: "staff-dlv-4", label: "Perfect", min: 97, color: "bg-purple-100 text-purple-700 border-purple-200" },
  ],
};

const normalizeRule = (rule: any, fallback: BadgeRule): BadgeRule => {
  const label = typeof rule?.label === "string" && rule.label.trim() ? rule.label : fallback.label;
  const min = typeof rule?.min === "number" && Number.isFinite(rule.min) ? rule.min : fallback.min;
  const color = typeof rule?.color === "string" && rule.color.trim() ? rule.color : fallback.color;
  const id = typeof rule?.id === "string" && rule.id.trim() ? rule.id : fallback.id;
  const description = typeof rule?.description === "string" ? rule.description : fallback.description;
  return { id, label, min, color, description };
};

const normalizeGroup = (input: any, fallback: BadgeRule[]) => {
  if (!Array.isArray(input)) return fallback;
  const normalized = input.map((rule, idx) => normalizeRule(rule, fallback[idx] || fallback[fallback.length - 1]));
  return normalized.length ? normalized : fallback;
};

export const normalizeBadgeRules = (input: any, fallback: BadgeRules = defaultBadgeRules): BadgeRules => {
  if (!input || typeof input !== "object") return fallback;
  return {
    customerOrders: normalizeGroup((input as any).customerOrders, fallback.customerOrders),
    staffOrdersCreated: normalizeGroup((input as any).staffOrdersCreated, fallback.staffOrdersCreated),
    staffOrdersConfirmed: normalizeGroup((input as any).staffOrdersConfirmed, fallback.staffOrdersConfirmed),
    staffDeliverySuccess: normalizeGroup((input as any).staffDeliverySuccess, fallback.staffDeliverySuccess),
  };
};

export const getBadgeForValue = (rules: BadgeRule[] | undefined, value: number) => {
  if (!rules || rules.length === 0) return null;
  const sorted = [...rules].sort((a, b) => b.min - a.min);
  return sorted.find((rule) => value >= rule.min) || null;
};

export const getDeliverySuccessRate = (delivered: number, returned: number) => {
  const total = delivered + returned;
  if (total <= 0) return 0;
  return Math.round((delivered / total) * 100);
};
