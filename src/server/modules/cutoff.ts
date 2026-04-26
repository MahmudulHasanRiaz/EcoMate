import prisma from '@/lib/prisma';
import type { CutoffStatus, Prisma } from '@prisma/client';
import { revalidateTags } from '@/server/utils/revalidate';

// ─── Types ──────────────────────────────────────────────────────────

type StaffContext = { id: string; name: string };

type ValidationCheck = {
    id: string;
    label: string;
    severity: 'ERROR' | 'WARNING';
    passed: boolean;
    detail?: string;
};

type ValidationReport = {
    checks: ValidationCheck[];
    passed: boolean;
    errorCount: number;
    warningCount: number;
};

// ─── Helpers ────────────────────────────────────────────────────────

async function auditLog(
    revisionId: string,
    action: string,
    staff?: StaffContext | null,
    detail?: Record<string, unknown>
) {
    await prisma.cutoffAuditLog.create({
        data: {
            revisionId,
            action,
            detail: (detail ?? undefined) as Prisma.InputJsonValue | undefined,
            performedById: staff?.id ?? null,
            performedByName: staff?.name ?? null,
        },
    });
}

// ─── Read ───────────────────────────────────────────────────────────

/** Returns the latest APPLIED revision, or null if none exists. */
export async function getActiveCutoff() {
    return prisma.cutoffRevision.findFirst({
        where: { status: 'APPLIED' },
        orderBy: { appliedAt: 'desc' },
    });
}

/** Returns all cutoff revisions ordered newest-first. */
export async function listCutoffRevisions() {
    return prisma.cutoffRevision.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
            _count: {
                select: {
                    OpeningBalance: true,
                    OpeningInventorySnapshot: true,
                    OpeningWipEntry: true,
                },
            },
        },
    });
}

/** Returns a single revision with all related data. */
export async function getCutoffRevision(id: string) {
    return prisma.cutoffRevision.findUnique({
        where: { id },
        include: {
            OpeningBalance: { orderBy: [{ entityType: 'asc' }, { entityName: 'asc' }] },
            OpeningInventorySnapshot: {
                include: { Lots: true },
                orderBy: { productId: 'asc' },
            },
            OpeningWipEntry: { orderBy: { productId: 'asc' } },
            AuditLog: { orderBy: { createdAt: 'desc' }, take: 50 },
        },
    });
}

// ─── Create ─────────────────────────────────────────────────────────

export async function createCutoffRevision(
    cutoffDate: Date,
    staff: StaffContext,
    notes?: string
) {
    // Determine revision number
    const count = await prisma.cutoffRevision.count();
    const revisionNumber = count + 1;

    const revision = await prisma.cutoffRevision.create({
        data: {
            cutoffDate,
            revisionNumber,
            notes: notes ?? null,
            createdById: staff.id,
            createdByName: staff.name,
        },
    });

    await auditLog(revision.id, 'CREATED', staff, { cutoffDate: cutoffDate.toISOString() });
    return revision;
}

// ─── Suggest Opening Balances ───────────────────────────────────────

export async function suggestOpeningBalances(revisionId: string, staff?: StaffContext) {
    const revision = await prisma.cutoffRevision.findUnique({ where: { id: revisionId } });
    if (!revision) throw new Error('Revision not found');
    if (revision.status !== 'DRAFT') throw new Error('Can only edit DRAFT revisions');

    const cutoffDate = revision.cutoffDate;

    // ── Suppliers ──
    const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true, creditBalance: true } });

    for (const s of suppliers) {
        // Compute suggested due from POs before cutoff
        const poStats = await prisma.purchaseOrder.aggregate({
            _sum: { total: true },
            where: {
                supplierId: s.id,
                date: { lte: cutoffDate },
                status: { not: 'Cancelled' },
            },
        });
        const totalBusiness = Number(poStats._sum.total || 0);

        const payments = await prisma.purchasePayment.findMany({
            where: {
                PurchaseOrder: { supplierId: s.id, date: { lte: cutoffDate } },
            },
            select: { cash: true, check: true, checkStatus: true },
        });
        const totalPaid = payments.reduce((sum, p) => {
            const passedCheck = p.checkStatus === 'Passed' ? (p.check || 0) : 0;
            return sum + (p.cash || 0) + passedCheck;
        }, 0);

        const suggestedDue = Math.max(totalBusiness - totalPaid, 0);

        await prisma.openingBalance.upsert({
            where: {
                revisionId_entityType_entityId: {
                    revisionId,
                    entityType: 'supplier',
                    entityId: s.id,
                },
            },
            update: { suggestedAmount: suggestedDue, entityName: s.name },
            create: {
                revisionId,
                entityType: 'supplier',
                entityId: s.id,
                entityName: s.name,
                suggestedAmount: suggestedDue,
                finalAmount: suggestedDue,
            },
        });
    }

    // ── Vendors ──
    const vendors = await prisma.vendor.findMany({ select: { id: true, name: true, creditBalance: true } });

    for (const v of vendors) {
        const stepStats = await prisma.productionStep.aggregate({
            _sum: { costAmount: true },
            where: {
                vendorId: v.id,
                PurchaseOrder: { date: { lte: cutoffDate }, status: { not: 'Cancelled' } },
            },
        });
        const totalBusiness = Number(stepStats._sum.costAmount || 0);

        const payments = await prisma.purchasePayment.findMany({
            where: {
                vendorId: v.id,
                PurchaseOrder: { date: { lte: cutoffDate } },
            },
            select: { cash: true, check: true, checkStatus: true },
        });
        const totalPaid = payments.reduce((sum, p) => {
            const passedCheck = p.checkStatus === 'Passed' ? (p.check || 0) : 0;
            return sum + (p.cash || 0) + passedCheck;
        }, 0);

        const suggestedDue = Math.max(totalBusiness - totalPaid, 0);

        await prisma.openingBalance.upsert({
            where: {
                revisionId_entityType_entityId: {
                    revisionId,
                    entityType: 'vendor',
                    entityId: v.id,
                },
            },
            update: { suggestedAmount: suggestedDue, entityName: v.name },
            create: {
                revisionId,
                entityType: 'vendor',
                entityId: v.id,
                entityName: v.name,
                suggestedAmount: suggestedDue,
                finalAmount: suggestedDue,
            },
        });
    }

    // ── Customers ──
    const customers = await prisma.customer.findMany({ select: { id: true, name: true } });
    for (const c of customers) {
        await prisma.openingBalance.upsert({
            where: { revisionId_entityType_entityId: { revisionId, entityType: 'customer', entityId: c.id } },
            update: { suggestedAmount: 0, entityName: c.name },
            create: { revisionId, entityType: 'customer', entityId: c.id, entityName: c.name, suggestedAmount: 0, finalAmount: 0 },
        });
    }

    // ── Staff ──
    const staffMembers = await prisma.staffMember.findMany({ select: { id: true, name: true } });
    for (const st of staffMembers) {
        await prisma.openingBalance.upsert({
            where: { revisionId_entityType_entityId: { revisionId, entityType: 'staff', entityId: st.id } },
            update: { suggestedAmount: 0, entityName: st.name },
            create: { revisionId, entityType: 'staff', entityId: st.id, entityName: st.name, suggestedAmount: 0, finalAmount: 0 },
        });
    }

    // ── Expense Categories ──
    const expenseCategories = await prisma.expenseCategory.findMany({ select: { id: true, name: true } });
    for (const ec of expenseCategories) {
        await prisma.openingBalance.upsert({
            where: { revisionId_entityType_entityId: { revisionId, entityType: 'expense', entityId: ec.id } },
            update: { suggestedAmount: 0, entityName: ec.name },
            create: { revisionId, entityType: 'expense', entityId: ec.id, entityName: ec.name, suggestedAmount: 0, finalAmount: 0 },
        });
    }

    // ── Liquid accounts ──
    const liquidAccounts = await prisma.account.findMany({
        where: { group: 'LIQUID' },
        select: { id: true, name: true },
    });

    for (const a of liquidAccounts) {
        const agg = await prisma.ledgerEntry.aggregate({
            _sum: { debit: true, credit: true },
            where: { accountId: a.id, date: { lte: cutoffDate } },
        });
        const balance = Number(agg._sum.debit || 0) - Number(agg._sum.credit || 0);

        await prisma.openingBalance.upsert({
            where: {
                revisionId_entityType_entityId: {
                    revisionId,
                    entityType: 'account',
                    entityId: a.id,
                },
            },
            update: { suggestedAmount: balance, entityName: a.name },
            create: {
                revisionId,
                entityType: 'account',
                entityId: a.id,
                entityName: a.name,
                suggestedAmount: balance,
                finalAmount: balance,
            },
        });
    }

    if (staff) {
        await auditLog(revisionId, 'BALANCES_SUGGESTED', staff);
    }

    return { success: true };
}

// ─── Override Balance ───────────────────────────────────────────────

export async function overrideOpeningBalance(
    balanceId: string,
    finalAmount: number,
    reason: string,
    staff: StaffContext
) {
    const balance = await prisma.openingBalance.findUnique({
        where: { id: balanceId },
        include: { CutoffRevision: { select: { status: true, id: true } } },
    });
    if (!balance) throw new Error('Opening balance not found');
    if (balance.CutoffRevision.status !== 'DRAFT') {
        throw new Error('Can only edit DRAFT revisions');
    }

    const updated = await prisma.openingBalance.update({
        where: { id: balanceId },
        data: {
            finalAmount,
            isOverridden: true,
            overrideReason: reason,
        },
    });

    await auditLog(balance.CutoffRevision.id, 'BALANCE_OVERRIDDEN', staff, {
        balanceId,
        entityType: balance.entityType,
        entityName: balance.entityName,
        oldAmount: balance.finalAmount,
        newAmount: finalAmount,
        reason,
    });

    return updated;
}

// ─── Suggest Inventory ──────────────────────────────────────────────

export async function suggestOpeningInventoryFromCurrent(revisionId: string, staff?: StaffContext) {
    const revision = await prisma.cutoffRevision.findUnique({ where: { id: revisionId } });
    if (!revision) throw new Error('Revision not found');
    if (revision.status !== 'DRAFT') throw new Error('Can only edit DRAFT revisions');

    // Group inventory by product+variant
    const items = await prisma.inventoryItem.findMany({
        where: { quantity: { gt: 0 } },
        select: {
            productId: true,
            variantId: true,
            quantity: true,
            unitCost: true,
            lotNumber: true,
        },
    });

    type AggKey = string;
    const agg = new Map<AggKey, {
        productId: string;
        variantId: string | null;
        totalQty: number;
        totalValue: number;
        lots: { lotNumber: string; qty: number; unitCost: number }[];
    }>();

    for (const item of items) {
        const key = `${item.productId}:${item.variantId ?? ''}`;
        let entry = agg.get(key);
        if (!entry) {
            entry = {
                productId: item.productId,
                variantId: item.variantId ?? null,
                totalQty: 0,
                totalValue: 0,
                lots: [],
            };
            agg.set(key, entry);
        }
        const qty = Number(item.quantity || 0);
        const cost = Number(item.unitCost || 0);
        entry.totalQty += qty;
        entry.totalValue += qty * cost;
        entry.lots.push({
            lotNumber: item.lotNumber || `LOT-${entry.lots.length + 1}`,
            qty,
            unitCost: cost,
        });
    }

    // Upsert snapshots with their lots
    for (const entry of agg.values()) {
        const snapshot = await prisma.openingInventorySnapshot.upsert({
            where: {
                revisionId_productId_variantId: {
                    revisionId,
                    productId: entry.productId,
                    variantId: entry.variantId ?? '',
                },
            },
            update: {
                totalQuantity: entry.totalQty,
                totalValue: entry.totalValue,
                lotCount: entry.lots.length,
            },
            create: {
                revisionId,
                productId: entry.productId,
                variantId: entry.variantId,
                totalQuantity: entry.totalQty,
                totalValue: entry.totalValue,
                lotCount: entry.lots.length,
            },
        });

        // Delete existing lots and recreate
        await prisma.openingInventoryLot.deleteMany({ where: { snapshotId: snapshot.id } });
        await prisma.openingInventoryLot.createMany({
            data: entry.lots.map((lot) => ({
                snapshotId: snapshot.id,
                lotNumber: lot.lotNumber,
                quantity: lot.qty,
                unitCost: lot.unitCost,
            })),
        });
    }

    if (staff) {
        await auditLog(revisionId, 'INVENTORY_SUGGESTED', staff);
    }

    return { 
        success: true, 
        isEstimate: true, 
        message: 'Current-state estimate (not historical reconstruction)' 
    };
}

export async function upsertOpeningInventory(revisionId: string, payload: { productId: string; variantId?: string | null; totalQuantity: number; totalValue: number; lotCount: number }) {
    return prisma.openingInventorySnapshot.upsert({
        where: {
            revisionId_productId_variantId: {
                revisionId,
                productId: payload.productId,
                variantId: payload.variantId ?? '',
            },
        },
        update: { totalQuantity: payload.totalQuantity, totalValue: payload.totalValue, lotCount: payload.lotCount },
        create: {
            revisionId,
            productId: payload.productId,
            variantId: payload.variantId ?? '',
            totalQuantity: payload.totalQuantity,
            totalValue: payload.totalValue,
            lotCount: payload.lotCount,
        },
    });
}

export async function updateOpeningInventoryLots(snapshotId: string, lots: { lotNumber: string; quantity: number; unitCost: number }[]) {
    return prisma.$transaction(async (tx) => {
        await tx.openingInventoryLot.deleteMany({ where: { snapshotId } });
        if (lots.length > 0) {
            await tx.openingInventoryLot.createMany({
                data: lots.map(l => ({ ...l, snapshotId })),
            });
        }
    });
}

export async function upsertOpeningWipEntry(revisionId: string, payload: { id?: string; productId: string; variantId?: string | null; currentStep: string; quantity: number; estimatedCost: number; notes?: string }) {
    if (payload.id) {
        return prisma.openingWipEntry.update({
            where: { id: payload.id },
            data: {
                productId: payload.productId,
                variantId: payload.variantId ?? '',
                currentStep: payload.currentStep,
                quantity: payload.quantity,
                estimatedCost: payload.estimatedCost,
                notes: payload.notes,
            },
        });
    }
    return prisma.openingWipEntry.create({
        data: {
            revisionId,
            productId: payload.productId,
            variantId: payload.variantId ?? '',
            currentStep: payload.currentStep,
            quantity: payload.quantity,
            estimatedCost: payload.estimatedCost,
            notes: payload.notes,
        },
    });
}

export async function deleteOpeningWipEntry(id: string) {
    return prisma.openingWipEntry.delete({ where: { id } });
}

// ─── Validation ─────────────────────────────────────────────────────

export async function validateCutoffRevision(revisionId: string, staff?: StaffContext) {
    const revision = await prisma.cutoffRevision.findUnique({
        where: { id: revisionId },
        include: {
            OpeningBalance: true,
            OpeningInventorySnapshot: { include: { Lots: true } },
            OpeningWipEntry: true,
        },
    });
    if (!revision) throw new Error('Revision not found');
    if (revision.status !== 'DRAFT' && revision.status !== 'VALIDATED') {
        throw new Error('Can only validate DRAFT or VALIDATED revisions');
    }

    const checks: ValidationCheck[] = [];

    // 1. No other APPLIED revision
    const existingApplied = await prisma.cutoffRevision.findFirst({
        where: { status: 'APPLIED', id: { not: revisionId } },
    });
    checks.push({
        id: 'no_other_applied',
        label: 'No other active cutoff exists (will be superseded on apply)',
        severity: 'WARNING',
        passed: !existingApplied,
        detail: existingApplied ? `Existing applied revision #${existingApplied.revisionNumber} will be superseded` : undefined,
    });

    // 2. Partners have balances
    const supplierCount = await prisma.supplier.count();
    const vendorCount = await prisma.vendor.count();
    const supplierBalances = revision.OpeningBalance.filter((b) => b.entityType === 'supplier').length;
    const vendorBalances = revision.OpeningBalance.filter((b) => b.entityType === 'vendor').length;
    checks.push({
        id: 'all_suppliers_have_balances',
        label: 'All suppliers have opening balances',
        severity: 'WARNING',
        passed: supplierBalances >= supplierCount,
        detail: `${supplierBalances}/${supplierCount} suppliers have balances`,
    });
    checks.push({
        id: 'all_vendors_have_balances',
        label: 'All vendors have opening balances',
        severity: 'WARNING',
        passed: vendorBalances >= vendorCount,
        detail: `${vendorBalances}/${vendorCount} vendors have balances`,
    });

    // 3. Lot quantities match snapshot totals
    for (const snapshot of revision.OpeningInventorySnapshot) {
        const lotQtySum = snapshot.Lots.reduce((sum, lot) => sum + lot.quantity, 0);
        checks.push({
            id: `lot_qty_match_${snapshot.id}`,
            label: `Inventory lot qty matches total for product ${snapshot.productId}`,
            severity: 'ERROR',
            passed: lotQtySum === snapshot.totalQuantity,
            detail: lotQtySum !== snapshot.totalQuantity
                ? `Lot sum: ${lotQtySum}, Expected: ${snapshot.totalQuantity}`
                : undefined,
        });
    }

    // 4. WIP entries valid
    const invalidWip = revision.OpeningWipEntry.filter(w => w.quantity <= 0 || !['PLANNING', 'FABRIC', 'PRINTING', 'CUTTING'].includes(w.currentStep));
    checks.push({
        id: 'wip_entries_valid',
        label: 'All WIP entries have valid qty and step',
        severity: 'ERROR',
        passed: invalidWip.length === 0,
        detail: invalidWip.length > 0 ? `${invalidWip.length} invalid WIP entries found` : undefined,
    });

    // 5. Liquid accounts classified
    const unclassifiedLiquid = await prisma.account.count({
        where: { name: { in: ['cash', 'bank', 'bkash', 'nagad', 'rocket'], mode: 'insensitive' }, group: null }
    });
    checks.push({
        id: 'liquid_accounts_classified',
        label: 'All standard liquid accounts are grouped as LIQUID',
        severity: 'WARNING',
        passed: unclassifiedLiquid === 0,
        detail: unclassifiedLiquid > 0 ? `${unclassifiedLiquid} liquid accounts missing LIQUID group` : undefined,
    });

    // 6. No negative opening balances
    const negativeBalances = revision.OpeningBalance.filter((b) => b.finalAmount < 0);
    checks.push({
        id: 'no_negative_balances',
        label: 'No negative opening balance amounts',
        severity: 'ERROR',
        passed: negativeBalances.length === 0,
        detail: negativeBalances.length > 0
            ? `${negativeBalances.length} negative balances: ${negativeBalances.map((b) => b.entityName).join(', ')}`
            : undefined,
    });

    // 5. Override reasons present
    const overridesWithoutReason = revision.OpeningBalance.filter(
        (b) => b.isOverridden && (!b.overrideReason || !b.overrideReason.trim())
    );
    checks.push({
        id: 'override_reasons_present',
        label: 'All overridden balances have reasons',
        severity: 'WARNING',
        passed: overridesWithoutReason.length === 0,
        detail: overridesWithoutReason.length > 0
            ? `${overridesWithoutReason.length} overrides missing reasons`
            : undefined,
    });

    const errorCount = checks.filter((c) => !c.passed && c.severity === 'ERROR').length;
    const warningCount = checks.filter((c) => !c.passed && c.severity === 'WARNING').length;
    const passed = errorCount === 0;

    const report: ValidationReport = { checks, passed, errorCount, warningCount };

    // Update revision status and store report
    await prisma.cutoffRevision.update({
        where: { id: revisionId },
        data: {
            status: passed ? 'VALIDATED' : 'DRAFT',
            validatedAt: passed ? new Date() : null,
            validationReport: report as unknown as Prisma.InputJsonValue,
        },
    });

    if (staff) {
        await auditLog(revisionId, 'VALIDATED', staff, { passed, errorCount, warningCount });
    }

    return report;
}

// ─── Apply ──────────────────────────────────────────────────────────

export async function applyCutoffRevision(revisionId: string, staff: StaffContext) {
    return prisma.$transaction(async (tx) => {
        const revision = await tx.cutoffRevision.findUnique({ where: { id: revisionId } });
        if (!revision) throw new Error('Revision not found');
        if (revision.status !== 'VALIDATED') {
            throw new Error('Only VALIDATED revisions can be applied. Run validation first.');
        }

        // Supersede any previously applied revision
        const previousApplied = await tx.cutoffRevision.findFirst({
            where: { status: 'APPLIED', id: { not: revisionId } },
        });
        if (previousApplied) {
            await tx.cutoffRevision.update({
                where: { id: previousApplied.id },
                data: {
                    status: 'SUPERSEDED',
                    supersededAt: new Date(),
                    supersededById: staff.id,
                    supersededByRevisionId: revisionId,
                },
            });
        }

        // Apply current revision
        const applied = await tx.cutoffRevision.update({
            where: { id: revisionId },
            data: {
                status: 'APPLIED',
                appliedAt: new Date(),
                appliedById: staff.id,
                appliedByName: staff.name,
            },
        });

        // Tag LIQUID accounts if not yet tagged
        const liquidNames = ['cash', 'bank', 'bkash', 'nagad', 'rocket'];
        await tx.account.updateMany({
            where: {
                group: null,
                name: { in: liquidNames, mode: 'insensitive' },
            },
            data: { group: 'LIQUID' },
        });

        return { applied, supersededId: previousApplied?.id };
    }).then(async ({ applied, supersededId }) => {
        await auditLog(revisionId, 'APPLIED', staff);
        if (supersededId) {
            await auditLog(supersededId, 'SUPERSEDED', staff, { byRevisionId: revisionId });
        }
        await revalidateTags(['accounting', 'partners', 'cutoff']);
        return applied;
    });
}

// ─── Pre-Cutoff Guard ───────────────────────────────────────────────

/**
 * Checks if a record date is before the active cutoff date.
 * Throws a user-friendly error if it is.
 */
export async function assertNotPreCutoff(recordDate: Date | string) {
    const cutoff = await getActiveCutoff();
    if (!cutoff) return; // No cutoff applied, allow everything

    const date = typeof recordDate === 'string' ? new Date(recordDate) : recordDate;
    if (date < cutoff.cutoffDate) {
        throw new Error(
            'এই রেকর্ড কাটঅফ তারিখের আগের, পরিবর্তন করা যাবে না। (This record is before the cutoff date and cannot be modified.)'
        );
    }
}

/**
 * Returns opening balance for a specific entity from the active cutoff.
 * Returns 0 if no cutoff is active or no balance exists.
 */
export async function getOpeningBalanceForEntity(entityType: string, entityId: string): Promise<number> {
    const cutoff = await getActiveCutoff();
    if (!cutoff) return 0;

    const balance = await prisma.openingBalance.findUnique({
        where: {
            revisionId_entityType_entityId: {
                revisionId: cutoff.id,
                entityType,
                entityId,
            },
        },
    });

    return balance?.finalAmount ?? 0;
}

// ─── Audit Log ──────────────────────────────────────────────────────

export async function getCutoffAuditLog(revisionId: string) {
    return prisma.cutoffAuditLog.findMany({
        where: { revisionId },
        orderBy: { createdAt: 'desc' },
    });
}

// ─── Cutoff Settlement ──────────────────────────────────────────────

export async function updateCutoffSettlementCheckStatus(
    settlementId: string,
    status: 'Pending' | 'Passed' | 'Bounced' | 'Cancelled',
    tx: Prisma.TransactionClient
) {
    const settlement = await tx.cutoffSettlement.update({
        where: { id: settlementId },
        data: {
            checkStatus: status,
        },
    });

    if (!settlement.check || settlement.check <= 0) return;

    const { ensureDefaultAccounts, resolveLedgerEntryNumber, ACCOUNT_LABELS } = await import('./accounting');
    await ensureDefaultAccounts();
    const accounts = await tx.account.findMany({ select: { id: true, name: true } });
    const accountIndex = new Map(accounts.map((acc) => [acc.name.toLowerCase(), acc.id]));
    const apId = accountIndex.get(ACCOUNT_LABELS.accountsPayable.toLowerCase());
    const advanceId = accountIndex.get(ACCOUNT_LABELS.supplierAdvance.toLowerCase());
    const sourceAccountId = settlement.paidFromAccountId;

    if (!apId || !advanceId || !sourceAccountId) return;

    const postingGroup = `obSettlement:${settlementId}`;
    
    await tx.ledgerEntry.deleteMany({ where: { postingGroup } });

    const entryNumber = await resolveLedgerEntryNumber(tx as any, { date: new Date(), postingGroup });
    const ledgerDescription = `Opening Balance Settlement for ${settlement.entityType.toUpperCase()}`;

    const ledgerEntries: any[] = [];
    
    // 1. Cash Part (if any)
    if (settlement.cash && settlement.cash > 0) {
        ledgerEntries.push({ date: new Date(), entryNumber, description: ledgerDescription, postingGroup, accountId: apId, debit: settlement.cash, credit: 0, sourceTransactionId: settlement.id });
        ledgerEntries.push({ date: new Date(), entryNumber, description: ledgerDescription, postingGroup, accountId: sourceAccountId, debit: 0, credit: settlement.cash, sourceTransactionId: settlement.id });
    }

    // 2. Check Part based on new status
    if (settlement.check && settlement.check > 0) {
        const stagedDate = settlement.createdAt || new Date();
        
        // Always recreate the initial staged entry (Pending)
        ledgerEntries.push({ date: stagedDate, entryNumber, description: ledgerDescription + ' (Staged)', postingGroup, accountId: advanceId, debit: settlement.check, credit: 0, sourceTransactionId: settlement.id });
        ledgerEntries.push({ date: stagedDate, entryNumber, description: ledgerDescription + ' (Staged)', postingGroup, accountId: sourceAccountId, debit: 0, credit: settlement.check, sourceTransactionId: settlement.id });

        if (status === 'Passed') {
            // Passed: move value from Supplier Advance to AP
            ledgerEntries.push({ date: new Date(), entryNumber, description: ledgerDescription + ' (Passed)', postingGroup, accountId: apId, debit: settlement.check, credit: 0, sourceTransactionId: settlement.id });
            ledgerEntries.push({ date: new Date(), entryNumber, description: ledgerDescription + ' (Passed)', postingGroup, accountId: advanceId, debit: 0, credit: settlement.check, sourceTransactionId: settlement.id });
        } else if (status === 'Bounced' || status === 'Cancelled') {
            // Bounced/Cancelled: reverse the staging
            ledgerEntries.push({ date: new Date(), entryNumber, description: ledgerDescription + ` (${status})`, postingGroup, accountId: sourceAccountId, debit: settlement.check, credit: 0, sourceTransactionId: settlement.id });
            ledgerEntries.push({ date: new Date(), entryNumber, description: ledgerDescription + ` (${status})`, postingGroup, accountId: advanceId, debit: 0, credit: settlement.check, sourceTransactionId: settlement.id });
        }
    }

    if (ledgerEntries.length > 0) {
        await tx.ledgerEntry.createMany({ data: ledgerEntries });
    }
}
