/**
 * The billing engine (design §4) — ONE pure function, no DB access.
 *
 * All money math lives here: input = effective pricing + usage + period,
 * output = invoice lines + a computation trace. Jobs, previews and tests
 * all call the same function, so the console preview can never disagree
 * with the invoice.
 *
 * Formula (per period, metered component):
 *   billableUnits = max(0, usage[metric] - included)
 *   meteredCharge = billableUnits × ratePerUnit
 *   meteredTotal  = max(minimumMonthly ?? 0, meteredCharge)
 * Total = baseFee + Σ add-on fees + meteredTotal.
 *
 * Rounding: each line round2 (the existing rule); the total is the sum of
 * the lines. Unused `included` units do NOT roll over.
 */
import {
  MeteringConfig,
  PricingDocument,
  isMeterKey,
  parsePricingDocument,
} from './pricing-document';

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** A value in the trace, with the source that produced it. */
export interface TraceValue {
  value: number | null;
  /** 'plan' | 'override' | 'purchase:<feeKey>' | 'addon:<name>'. */
  source: string;
}

export interface AddOnTrace {
  name: string;
  baseFee: number;
  usage?: number;
  ratePerUnit?: TraceValue;
  minimumMonthly?: TraceValue;
  meteredCharge?: number;
}

export interface PricingTrace {
  planName: string;
  period: { start: string; end: string };
  baseFee: TraceValue;
  billingCycle?: string;
  ratePerUnit?: TraceValue;
  minimumMonthly?: TraceValue;
  minimumApplied?: number;
  /** 0..1 when the minimum was pro-rated (mid-period close-out, §4.5). */
  minimumProrationFactor?: number;
  included?: number;
  usage?: Record<string, number>;
  billableUnits?: number;
  meteredCharge?: number;
  addOns?: AddOnTrace[];
  /** Included units are per-period and never roll over (§4.2). */
  includedUnitsRollover: false;
}

export interface EngineLine {
  description: string;
  /** Always 1: the line amount is the engine's round2'd charge, so the
   * invoice total can never drift from the computed total by unit-price
   * rounding (a 4dp rate × quantity would round twice). The description
   * carries the rate and the unit count for transparency. */
  quantity: 1;
  unitPrice: number;
}

export interface PricingEngineOutput {
  lines: EngineLine[];
  total: number;
  trace: PricingTrace;
}

/** An active add-on with its resolved pricing (engine input). */
export interface ResolvedAddOn {
  name: string;
  baseFee: number;
  metering?: MeteringConfig;
}

export interface PricingEngineInput {
  /** Effective pricing (§4.1): version pricing with overrides + purchase
   * effects already applied. Use resolveEffectivePricing to build it. */
  pricing: PricingDocument;
  /** Sources for the traced values (from resolveEffectivePricing). */
  sources?: {
    baseFee?: string;
    ratePerUnit?: string;
    minimumMonthly?: string;
  };
  addOns: ResolvedAddOn[];
  /** Meter readings for the period, keyed by meter key. */
  usage: Record<string, number>;
  period: { start: Date; end: Date };
  planName: string;
  /** 'monthly' | 'yearly' | '7-day' — the invoice line label. */
  intervalLabel: string;
  /** Pre-formatted period range for the line descriptions. */
  periodLabel: string;
  /**
   * 0..1 factor scaling the minimum (mid-period plan-change close-out,
   * §4.5: minimum × usedDays / totalDays). 1 (or omitted) = full minimum.
   */
  minimumProrationFactor?: number;
}

function formatRate(rate: number): string {
  // 10 -> "10", 1.5 -> "1.5", 0.5 -> "0.5" (no trailing zeros).
  return String(rate);
}

/**
 * Metered lines for one metering config (plan or add-on). Returns the
 * lines + the metered total + trace fragments. Throws when the usage
 * reading for the metric is missing — a metered invoice is never created
 * from a guessed number (§4.4).
 */
function meteredComponent(input: {
  metering: MeteringConfig;
  usage: Record<string, number>;
  /** Line prefix: 'Orders' for the plan, '<Add-on> — orders' for add-ons. */
  label: string;
  rateSource: string;
  minimumSource: string;
  minimumProrationFactor?: number;
}): {
  lines: EngineLine[];
  meteredTotal: number;
  billableUnits: number;
  meteredCharge: number;
  minimumApplied: number;
  used: number;
} {
  const { metering, usage } = input;
  if (!isMeterKey(metering.metric)) {
    throw new Error(`Unknown meter key "${metering.metric}"`);
  }
  const used = usage[metering.metric];
  if (used === undefined || !Number.isFinite(used) || used < 0) {
    throw new Error(
      `No usage reading for meter "${metering.metric}" — refusing to bill from a guessed number`,
    );
  }
  const billableUnits = Math.max(0, Math.floor(used) - metering.included);
  const meteredCharge = round2(billableUnits * metering.ratePerUnit);
  const fullMinimum = metering.minimumMonthly ?? 0;
  const factor = input.minimumProrationFactor ?? 1;
  const minimumApplied = round2(fullMinimum * factor);
  const meteredTotal = Math.max(minimumApplied, meteredCharge);

  const lines: EngineLine[] = [];
  if (meteredCharge > 0) {
    lines.push({
      description: `${input.label}: ${Math.floor(used)} × ৳${formatRate(metering.ratePerUnit)} (${metering.included} included)`,
      quantity: 1,
      unitPrice: meteredCharge,
    });
  }
  if (meteredTotal > meteredCharge) {
    lines.push({
      description: input.label.startsWith('Orders')
        ? 'Minimum monthly billing adjustment'
        : `${input.label} — minimum billing adjustment`,
      quantity: 1,
      unitPrice: round2(meteredTotal - meteredCharge),
    });
  }
  return {
    lines,
    meteredTotal,
    billableUnits,
    meteredCharge,
    minimumApplied,
    used: Math.floor(used),
  };
}

export class PricingEngine {
  static compute(input: PricingEngineInput): PricingEngineOutput {
    const pricing = parsePricingDocument(input.pricing);
    const lines: EngineLine[] = [];
    const trace: PricingTrace = {
      planName: input.planName,
      period: {
        start: input.period.start.toISOString(),
        end: input.period.end.toISOString(),
      },
      baseFee: {
        value: pricing.baseFee?.amount ?? 0,
        source: input.sources?.baseFee ?? 'plan',
      },
      billingCycle: pricing.billingCycle,
      includedUnitsRollover: false,
    };
    if (input.minimumProrationFactor !== undefined) {
      trace.minimumProrationFactor = input.minimumProrationFactor;
    }

    const baseFee = pricing.baseFee?.amount ?? 0;
    if (baseFee > 0) {
      lines.push({
        description: `${input.planName} subscription — ${input.intervalLabel} (${input.periodLabel})`,
        quantity: 1,
        unitPrice: round2(baseFee),
      });
    }

    if (pricing.metering) {
      const component = meteredComponent({
        metering: pricing.metering,
        usage: input.usage,
        label: 'Orders',
        rateSource: input.sources?.ratePerUnit ?? 'plan',
        minimumSource: input.sources?.minimumMonthly ?? 'plan',
        minimumProrationFactor: input.minimumProrationFactor,
      });
      lines.push(...component.lines);
      trace.ratePerUnit = {
        value: pricing.metering.ratePerUnit,
        source: input.sources?.ratePerUnit ?? 'plan',
      };
      trace.minimumMonthly = {
        value: pricing.metering.minimumMonthly,
        source: input.sources?.minimumMonthly ?? 'plan',
      };
      trace.minimumApplied = component.minimumApplied;
      trace.included = pricing.metering.included;
      trace.usage = { [pricing.metering.metric]: component.used };
      trace.billableUnits = component.billableUnits;
      trace.meteredCharge = component.meteredCharge;
    }

    const addOnTraces: AddOnTrace[] = [];
    for (const addOn of input.addOns) {
      const addOnTrace: AddOnTrace = {
        name: addOn.name,
        baseFee: round2(addOn.baseFee),
      };
      if (addOn.baseFee > 0) {
        lines.push({
          description: `${addOn.name} — ${input.intervalLabel} (${input.periodLabel})`,
          quantity: 1,
          unitPrice: round2(addOn.baseFee),
        });
      }
      if (addOn.metering) {
        const component = meteredComponent({
          metering: addOn.metering,
          usage: input.usage,
          label: `${addOn.name} — orders`,
          rateSource: `addon:${addOn.name}`,
          minimumSource: `addon:${addOn.name}`,
          minimumProrationFactor: input.minimumProrationFactor,
        });
        lines.push(...component.lines);
        addOnTrace.usage = component.used;
        addOnTrace.ratePerUnit = {
          value: addOn.metering.ratePerUnit,
          source: `addon:${addOn.name}`,
        };
        addOnTrace.minimumMonthly = {
          value: addOn.metering.minimumMonthly,
          source: `addon:${addOn.name}`,
        };
        addOnTrace.meteredCharge = component.meteredCharge;
      }
      addOnTraces.push(addOnTrace);
    }
    if (addOnTraces.length > 0) trace.addOns = addOnTraces;

    const total = round2(
      lines.reduce((sum, line) => sum + line.unitPrice, 0),
    );
    return { lines, total, trace };
  }
}

/**
 * Resolution order (§4.1): override > purchase > plan.
 *
 * 1. Start from the subscription's PlanVersion.pricing.
 * 2. Apply active one-time purchase effects: a rate_tier purchase
 *    replaces metering.ratePerUnit.
 * 3. Apply TenantPricingOverride rows: per_order_rate replaces
 *    metering.ratePerUnit; minimum_monthly replaces
 *    metering.minimumMonthly. An override of 0 for the minimum means
 *    "no floor" (the engine treats 0 and null identically).
 *
 * Returns the resolved document + the source of each traced value.
 */
export function resolveEffectivePricing(input: {
  versionPricing: unknown;
  overrides: Array<{ key: string; value: number | string }>;
  /** APPLIED rate-tier purchases, oldest first (latest wins). */
  rateTierPurchases: Array<{ feeKey: string; perOrderRate: number }>;
}): {
  pricing: PricingDocument;
  sources: { baseFee: string; ratePerUnit: string; minimumMonthly: string };
} {
  const pricing = parsePricingDocument(input.versionPricing);
  const sources = {
    baseFee: 'plan',
    ratePerUnit: 'plan',
    minimumMonthly: 'plan',
  };

  for (const purchase of input.rateTierPurchases) {
    if (!pricing.metering) continue;
    pricing.metering = {
      ...pricing.metering,
      ratePerUnit: purchase.perOrderRate,
    };
    sources.ratePerUnit = `purchase:${purchase.feeKey}`;
  }

  for (const override of input.overrides) {
    const value = Number(override.value);
    if (!Number.isFinite(value) || value < 0) continue;
    if (override.key === 'per_order_rate' && pricing.metering) {
      pricing.metering = { ...pricing.metering, ratePerUnit: value };
      sources.ratePerUnit = 'override';
    }
    if (override.key === 'minimum_monthly' && pricing.metering) {
      pricing.metering = { ...pricing.metering, minimumMonthly: value };
      sources.minimumMonthly = 'override';
    }
  }

  return { pricing, sources };
}
