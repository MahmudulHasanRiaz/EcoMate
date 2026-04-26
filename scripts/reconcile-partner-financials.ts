/**
 * Reconcile partner-related derived financial fields after historical data edits (e.g. inventory/purchase resets).
 *
 * Safe defaults:
 * - DRY-RUN by default (no DB writes)
 * - APPLY requires explicit confirmation flag
 *
 * What this script can do:
 * 1) Recompute `ProductionStep.paidAmount` + `ProductionStep.paymentStatus` from linked `PurchasePayment`
 * 2) Recompute `PurchaseOrder.paymentStatus` from `PurchasePayment` totals
 * 3) (Optional) Recompute `ProductionStep.costAmount` from `PurchaseOrderItem` costs
 *
 * Usage:
 *   DRY RUN (recommended first):
 *     npx tsx scripts/reconcile-partner-financials.ts --partner-name="Piyal Vai"
 *
 *   APPLY:
 *     npx tsx scripts/reconcile-partner-financials.ts --partner-name="Piyal Vai" --apply --confirm=RECONCILE_PARTNER_FINANCIALS
 *
 * Optional flags:
 *   --all                         Process all partners / all purchase orders
 *   --partner-id=<id>             Target a specific Supplier/Vendor id (auto-detects type)
 *   --from-updated=<YYYY-MM-DD>   Only process POs updated on/after this date (inclusive)
 *   --to-updated=<YYYY-MM-DD>     Only process POs updated on/before this date (inclusive)
 *   --batch-size=50               Batch size for PO scan (default: 50)
 *   --fix-step-costs              Also recompute step costAmount from items (PRINTING/CUTTING/FABRIC)
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

// Optional dotenv load for local/dev. In containers, env is injected.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const dotenv = require('dotenv');
  dotenv.config();
} catch {
  // noop
}

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all');
const FIX_STEP_COSTS = args.includes('--fix-step-costs');

const confirmFlag = args.find((a) => a.startsWith('--confirm='));
const confirmValue = confirmFlag?.split('=')[1];

const partnerNameArg = args.find((a) => a.startsWith('--partner-name='));
const partnerName = partnerNameArg ? partnerNameArg.slice('--partner-name='.length) : null;

const partnerIdArg = args.find((a) => a.startsWith('--partner-id='));
const partnerId = partnerIdArg ? partnerIdArg.slice('--partner-id='.length) : null;

const fromUpdatedArg = args.find((a) => a.startsWith('--from-updated='));
const toUpdatedArg = args.find((a) => a.startsWith('--to-updated='));
const fromUpdated = fromUpdatedArg ? fromUpdatedArg.slice('--from-updated='.length) : null;
const toUpdated = toUpdatedArg ? toUpdatedArg.slice('--to-updated='.length) : null;

const batchSizeArg = args.find((a) => a.startsWith('--batch-size='));
const batchSize = batchSizeArg ? Math.max(1, Number(batchSizeArg.slice('--batch-size='.length)) || 50) : 50;

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function safeNumber(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function parseYmd(value: string) {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date: ${value} (expected YYYY-MM-DD)`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Invalid date: ${value} (expected YYYY-MM-DD)`);
  }
  return { year, month, day };
}

function parseDateStart(value: string) {
  const { year, month, day } = parseYmd(value);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function parseDateEnd(value: string) {
  const { year, month, day } = parseYmd(value);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function assertApplyReady() {
  if (!APPLY) return;
  if (confirmValue !== 'RECONCILE_PARTNER_FINANCIALS') {
    throw new Error('Refusing to apply without: --confirm=RECONCILE_PARTNER_FINANCIALS');
  }
}

type Report = {
  startedAt: string;
  mode: 'dry-run' | 'apply';
  scope: {
    all: boolean;
    partnerName?: string | null;
    partnerId?: string | null;
    supplierId?: string | null;
    vendorId?: string | null;
    fromUpdated?: string | null;
    toUpdated?: string | null;
    batchSize: number;
    fixStepCosts: boolean;
  };
  scanned: {
    purchaseOrders: number;
    productionSteps: number;
    payments: number;
  };
  changes: {
    purchaseOrderPaymentStatus: number;
    productionStepPaid: number;
    productionStepStatus: number;
    productionStepCostAmount: number;
  };
  anomalies: Array<{
    poId: string;
    type: string;
    message: string;
    data?: any;
  }>;
};

function computePaymentStatus(total: number, paid: number): 'Unpaid' | 'Partial' | 'Paid' {
  const t = safeNumber(total);
  const p = safeNumber(paid);
  if (t <= 0) return 'Paid';
  if (p <= 0.01) return 'Unpaid';
  if (p >= t - 0.01) return 'Paid';
  return 'Partial';
}

function computeStepPaid(payments: Array<{ cash: number; check: number; checkStatus: string | null }>) {
  return payments.reduce((sum, p) => {
    const passed = p.checkStatus === 'Passed' ? safeNumber(p.check) : 0;
    return sum + safeNumber(p.cash) + passed;
  }, 0);
}

function computeFabricCostFromItem(item: {
  jamaYards: number | null;
  jamaRate: number | null;
  ornaYards: number | null;
  ornaRate: number | null;
  selowarYards: number | null;
  selowarRate: number | null;
  FabricLotUsage?: Array<{ yards: number; unitCost: number }> | null;
}) {
  const usages = Array.isArray(item.FabricLotUsage) ? item.FabricLotUsage : [];
  const usageCost = usages.reduce((sum, u) => sum + safeNumber(u.yards) * safeNumber(u.unitCost), 0);

  const jama = safeNumber(item.jamaYards) * safeNumber(item.jamaRate);
  const orna = safeNumber(item.ornaYards) * safeNumber(item.ornaRate);
  const selowar = safeNumber(item.selowarYards) * safeNumber(item.selowarRate);
  const yardCost = jama + orna + selowar;

  return Math.max(usageCost, yardCost);
}

async function resolvePartnerIds(): Promise<{ supplierId: string | null; vendorId: string | null }> {
  if (ALL) return { supplierId: null, vendorId: null };

  let supplierId: string | null = null;
  let vendorId: string | null = null;

  if (partnerId) {
    const [supplier, vendor] = await Promise.all([
      prisma.supplier.findUnique({ where: { id: partnerId }, select: { id: true } }),
      prisma.vendor.findUnique({ where: { id: partnerId }, select: { id: true } }),
    ]);
    if (supplier?.id) supplierId = supplier.id;
    if (vendor?.id) vendorId = vendor.id;
  }

  if (partnerName) {
    const normalized = partnerName.trim();
    if (normalized) {
      const [supplier, vendor] = await Promise.all([
        prisma.supplier.findFirst({ where: { name: { equals: normalized, mode: 'insensitive' } }, select: { id: true } }),
        prisma.vendor.findFirst({ where: { name: { equals: normalized, mode: 'insensitive' } }, select: { id: true } }),
      ]);
      if (supplier?.id) supplierId = supplier.id;
      if (vendor?.id) vendorId = vendor.id;
    }
  }

  return { supplierId, vendorId };
}

async function main() {
  assertApplyReady();

  const reportId = nowStamp();
  const reportPath = path.join(process.cwd(), 'scripts', `_partner_financial_reconcile_${reportId}.json`);

  const startedAt = new Date();
  const { supplierId, vendorId } = await resolvePartnerIds();

  const report: Report = {
    startedAt: startedAt.toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    scope: {
      all: ALL,
      partnerName,
      partnerId,
      supplierId,
      vendorId,
      fromUpdated,
      toUpdated,
      batchSize,
      fixStepCosts: FIX_STEP_COSTS,
    },
    scanned: { purchaseOrders: 0, productionSteps: 0, payments: 0 },
    changes: {
      purchaseOrderPaymentStatus: 0,
      productionStepPaid: 0,
      productionStepStatus: 0,
      productionStepCostAmount: 0,
    },
    anomalies: [],
  };

  console.log('');
  console.log('=== PARTNER FINANCIAL RECONCILE ===');
  console.log(`Mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (read-only)'}`);
  console.log(`Out:  ${reportPath}`);
  console.log(`Fix:  ${FIX_STEP_COSTS ? 'step costs + paid/status + PO status' : 'paid/status + PO status'}`);
  console.log('');

  if (!ALL && !supplierId && !vendorId) {
    throw new Error('No partner resolved. Provide --partner-name=... or --partner-id=..., or use --all.');
  }

  const where: any = { status: { not: 'Cancelled' } };
  const or: any[] = [];
  if (!ALL) {
    if (supplierId) or.push({ supplierId });
    if (vendorId) {
      or.push({ ProductionStep: { some: { vendorId } } });
      or.push({ PurchasePayment: { some: { vendorId } } });
    }
    where.OR = or;
  }

  if (fromUpdated || toUpdated) {
    where.updatedAt = {};
    if (fromUpdated) where.updatedAt.gte = parseDateStart(fromUpdated);
    if (toUpdated) where.updatedAt.lte = parseDateEnd(toUpdated);
  }

  let cursor: string | null = null;

  while (true) {
    const pos: any[] = await prisma.purchaseOrder.findMany({
      where,
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        PurchasePayment: {
          select: {
            id: true,
            poId: true,
            vendorId: true,
            productionStepId: true,
            cash: true,
            check: true,
            checkStatus: true,
          },
        },
        ProductionStep: {
          select: {
            id: true,
            poId: true,
            stepType: true,
            vendorId: true,
            costAmount: true,
            paidAmount: true,
            paymentStatus: true,
          },
          orderBy: { stepType: 'asc' },
        },
        PurchaseOrderItem: {
          select: {
            id: true,
            quantity: true,
            printingCost: true,
            cuttingCost: true,
            jamaYards: true,
            jamaRate: true,
            ornaYards: true,
            ornaRate: true,
            selowarYards: true,
            selowarRate: true,
            FabricLotUsage: FIX_STEP_COSTS
              ? { select: { yards: true, unitCost: true } }
              : false,
          } as any,
        },
      },
    }) as any;

    if (pos.length === 0) break;

    report.scanned.purchaseOrders += pos.length;
    report.scanned.productionSteps += pos.reduce((sum: number, po: any) => sum + (po.ProductionStep?.length || 0), 0);
    report.scanned.payments += pos.reduce((sum: number, po: any) => sum + (po.PurchasePayment?.length || 0), 0);

    for (const po of pos) {
      const poPayments: any[] = Array.isArray(po.PurchasePayment) ? po.PurchasePayment : [];
      const totalPaid = computeStepPaid(poPayments);

      const nextPoStatus = computePaymentStatus(po.total, totalPaid);
      if (String(po.paymentStatus) !== String(nextPoStatus)) {
        report.changes.purchaseOrderPaymentStatus += 1;
      }

      // Optional: recompute step costs from items
      const costByStepType = new Map<string, number>();
      if (FIX_STEP_COSTS) {
        const items: any[] = Array.isArray(po.PurchaseOrderItem) ? po.PurchaseOrderItem : [];
        const fabricTotal = items.reduce((sum, it) => sum + computeFabricCostFromItem(it), 0);
        const printingTotal = items.reduce((sum, it) => sum + safeNumber(it.printingCost), 0);
        const cuttingTotal = items.reduce((sum, it) => sum + safeNumber(it.cuttingCost), 0);
        costByStepType.set('FABRIC', round2(fabricTotal));
        costByStepType.set('PRINTING', round2(printingTotal));
        costByStepType.set('CUTTING', round2(cuttingTotal));
      }

      const stepPaymentsByStepId = new Map<string, any[]>();
      for (const p of poPayments) {
        if (!p.productionStepId) continue;
        const list = stepPaymentsByStepId.get(String(p.productionStepId)) || [];
        list.push(p);
        stepPaymentsByStepId.set(String(p.productionStepId), list);
      }

      for (const step of (po.ProductionStep || [])) {
        const payments = stepPaymentsByStepId.get(String(step.id)) || [];
        const paidAmount = round2(computeStepPaid(payments));

        const nextCostAmount = FIX_STEP_COSTS
          ? (costByStepType.get(String(step.stepType)) ?? round2(safeNumber(step.costAmount)))
          : round2(safeNumber(step.costAmount));

        const nextStepStatus = computePaymentStatus(nextCostAmount, paidAmount);

        if (Math.abs(safeNumber(step.paidAmount) - paidAmount) > 0.01) {
          report.changes.productionStepPaid += 1;
        }
        if (String(step.paymentStatus) !== String(nextStepStatus)) {
          report.changes.productionStepStatus += 1;
        }
        if (FIX_STEP_COSTS && Math.abs(safeNumber(step.costAmount) - nextCostAmount) > 0.01) {
          report.changes.productionStepCostAmount += 1;
        }

        // Light anomaly reporting (only for significant mismatches)
        if (FIX_STEP_COSTS && Math.abs(safeNumber(step.costAmount) - nextCostAmount) > 10) {
          report.anomalies.push({
            poId: String(po.id),
            type: 'STEP_COST_DRIFT',
            message: `Step ${step.stepType} costAmount drift detected.`,
            data: { stepId: step.id, before: step.costAmount, after: nextCostAmount },
          });
        }
      }

      if (APPLY) {
        await prisma.$transaction(async (tx) => {
          // PO payment status
          if (String(po.paymentStatus) !== String(nextPoStatus)) {
            await tx.purchaseOrder.update({
              where: { id: po.id },
              data: { paymentStatus: nextPoStatus },
            });
          }

          // Steps
          for (const step of (po.ProductionStep || [])) {
            const payments = stepPaymentsByStepId.get(String(step.id)) || [];
            const paidAmount = round2(computeStepPaid(payments));

            const nextCostAmount = FIX_STEP_COSTS
              ? (costByStepType.get(String(step.stepType)) ?? round2(safeNumber(step.costAmount)))
              : round2(safeNumber(step.costAmount));
            const nextStepStatus = computePaymentStatus(nextCostAmount, paidAmount);

            const updateData: any = {};
            if (Math.abs(safeNumber(step.paidAmount) - paidAmount) > 0.01) updateData.paidAmount = paidAmount;
            if (String(step.paymentStatus) !== String(nextStepStatus)) updateData.paymentStatus = nextStepStatus;
            if (FIX_STEP_COSTS && Math.abs(safeNumber(step.costAmount) - nextCostAmount) > 0.01) updateData.costAmount = nextCostAmount;

            if (Object.keys(updateData).length > 0) {
              await tx.productionStep.update({
                where: { id: step.id },
                data: updateData,
              });
            }
          }
        });
      }
    }

    cursor = pos[pos.length - 1].id;
    if (report.scanned.purchaseOrders % 500 === 0) {
      console.log(`[PROGRESS] purchaseOrders=${report.scanned.purchaseOrders}`);
    }
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('');
  console.log('Done.');
  console.log(`Report: ${reportPath}`);
  console.log('');

  if (!APPLY) {
    console.log('Dry-run complete. No changes were made.');
    console.log('To apply:');
    console.log('  npx tsx scripts/reconcile-partner-financials.ts --apply --confirm=RECONCILE_PARTNER_FINANCIALS ...');
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error('Fatal error:', err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
