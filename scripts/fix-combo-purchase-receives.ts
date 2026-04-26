import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

// Optional dotenv load for local/dev usage. In containers, env is already injected.
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dotenv = require('dotenv');
    dotenv.config();
} catch {
    // noop
}

const prisma = new PrismaClient();

async function main() {
    const args = process.argv.slice(2);
    const applyArg = args.find((a) => a.startsWith('--apply'));
    const confirmArg = args.find((a) => a.startsWith('--confirm='));
    const isApply = applyArg && confirmArg === '--confirm=FIX_COMBO_RECEIVES';
    const poFilter = args.find((a) => a.startsWith('--po='))?.split('=')[1];
    const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1];
    const limit = limitArg ? parseInt(limitArg, 10) : undefined;
    const includeAllTypes = args.includes('--all-types');
    
    console.log(`[Combo Receive Backfill] Mode: ${isApply ? 'APPLY' : 'DRY RUN'}`);
    if (poFilter) console.log(`[Combo Receive Backfill] Filter PO: ${poFilter}`);

    const stats = {
        processed: 0,
        fixed: 0,
        skipped: 0,
    };

    const poItems = await prisma.purchaseOrderItem.findMany({
        where: {
            receivedQty: { gt: 0 },
            ...(includeAllTypes ? {} : { product: { is: { productType: 'combo' as any } } }),
            ...(poFilter ? { poId: poFilter } : {}),
        },
        include: {
            product: { include: { comboItems: true } },
            PurchaseOrder: true,
        },
        orderBy: { poId: 'asc' },
        ...(limit ? { take: limit } : {}),
    });

    console.log(`Found ${poItems.length} combo PO items with receivedQty > 0.`);

    for (const poItem of poItems) {
        stats.processed++;
            const poId = poItem.poId;
            const parentId = poItem.productId;
            const isFullyReceived = poItem.PurchaseOrder.status === 'Received';
            const breakdown = Array.isArray((poItem as any).pindaBreakdown)
                ? (poItem as any).pindaBreakdown.map((n: any) => Number(n) || 0).filter((n: number) => n > 0)
                : [];

            if (!isFullyReceived) {
                stats.skipped++;
                console.log(`[Skipped] PO Item ${poItem.id} (PO ${poId}): PO_NOT_RECEIVED`);
                continue;
            }
            
            try {
                await prisma.$transaction(async (tx) => {
                const children = (poItem.product as any).comboItems || [];
                if (children.length === 0) {
                    throw new Error('NO_CHILDREN_DEFINED_ON_COMBO');
                }

                const childTargets = children.map((c: any) => ({
                    productId: c.childId,
                    variantId: c.variantId || null,
                }));
                const unitCostPerChild = children.length > 0
                    ? (Number(poItem.unitCost) || 0) / children.length
                    : (Number(poItem.unitCost) || 0);

                const poPrefix = `PO-${poId}`;
                const findChildLotsForTarget = async (target: { productId: string; variantId: string | null }) => {
                    const byLot = await tx.inventoryItem.findMany({
                        where: {
                            productId: target.productId,
                            variantId: target.variantId ?? null,
                            OR: [
                                { lotNumber: { startsWith: poPrefix } },
                                { lotNumber: poId }
                            ],
                        },
                    });
                    if (byLot.length > 0) return byLot;

                    const moves = await tx.inventoryMovement.findMany({
                        where: {
                            type: 'Received',
                            notes: { contains: `PO #${poId}` },
                            InventoryItem: {
                                productId: target.productId,
                                variantId: target.variantId ?? null,
                            }
                        },
                        include: { InventoryItem: true }
                    });
                    return moves.map((m) => m.InventoryItem);
                };

                const childLots: { id: string; unitCost: number | null }[] = [];
                for (const target of childTargets) {
                    const lots = await findChildLotsForTarget(target);
                    for (const lot of lots) {
                        childLots.push({ id: lot.id, unitCost: lot.unitCost });
                    }
                }
                const uniqueChildLots = Array.from(new Map(childLots.map((l) => [l.id, l])).values());

                if (uniqueChildLots.length > 0) {
                    if (isApply) {
                        for (const lot of uniqueChildLots) {
                            if (lot.unitCost === unitCostPerChild) continue;
                            await tx.inventoryItem.update({
                                where: { id: lot.id },
                                data: { unitCost: unitCostPerChild },
                            });
                        }
                    } else {
                        console.log(`[DryRun] Would update ${uniqueChildLots.length} child lots with unitCost=${unitCostPerChild} (PO ${poId}).`);
                    }
                    stats.fixed++;
                    return;
                }

                // Find parent lots (fallback to movement notes if lotNumber mismatch)
                let lots = await tx.inventoryItem.findMany({
                    where: {
                        productId: parentId,
                        variantId: poItem.variantId ?? null,
                        OR: [
                            { lotNumber: { startsWith: poPrefix } },
                            { lotNumber: poId }
                        ],
                        quantity: { gt: 0 } // only bother with lots that haven't been zeroed
                    }
                });

                if (lots.length === 0) {
                    const parentMoves = await tx.inventoryMovement.findMany({
                        where: {
                            type: 'Received',
                            notes: { contains: `PO #${poId}` },
                            InventoryItem: {
                                productId: parentId,
                                variantId: poItem.variantId ?? null,
                            }
                        },
                        include: { InventoryItem: true }
                    });
                    lots = parentMoves.map((m) => m.InventoryItem).filter((l) => l.quantity > 0);
                }

                if (lots.length === 0) {
                    throw new Error('NO_VALID_PARENT_LOT_FOUND');
                }

                // Global roll index helper for this explicit execution context
                const canonicalLotPrefix = `PO-${poId}-R`;
                const existingRolls = await tx.inventoryItem.findMany({
                    where: { lotNumber: { startsWith: canonicalLotPrefix } },
                    select: { lotNumber: true }
                });
                let maxRollIdx = 0;
                const existingRollNums = new Set<string>();
                for (const roll of existingRolls) {
                    if (roll.lotNumber) existingRollNums.add(roll.lotNumber);
                    const match = roll.lotNumber?.match(/-R(\d+)$/);
                    if (match) {
                        const idx = parseInt(match[1], 10);
                        if (idx > maxRollIdx) maxRollIdx = idx;
                    }
                }
                let nextRollIdx = maxRollIdx + 1;
                const reserveNextRollNumber = () => {
                    let rollNum = `${canonicalLotPrefix}${nextRollIdx}`;
                    while (existingRollNums.has(rollNum)) {
                        nextRollIdx += 1;
                        rollNum = `${canonicalLotPrefix}${nextRollIdx}`;
                    }
                    existingRollNums.add(rollNum);
                    nextRollIdx += 1;
                    return rollNum;
                };

                    for (const lot of lots) {
                    if (lot.reservedQuantity > 0) {
                        throw new Error(`PARENT_RESERVED (${lot.reservedQuantity} reserved)`);
                    }

                    if (isApply) {
                        // 1. Zero out parent lot 
                        const prevQty = lot.quantity;
                        await tx.inventoryItem.update({
                            where: { id: lot.id },
                            data: { quantity: 0 }
                        });
                        
                        await tx.inventoryMovement.create({
                            data: {
                                inventoryItemId: lot.id,
                                type: 'Adjusted',
                                quantityChange: -prevQty,
                                balance: 0,
                                notes: '(Backfill) Combo parent rolled out to children.',
                                user: 'System (Backfill)',
                            }
                        });

                        // 2. Distribute to children
                        const useBreakdown = breakdown.length > 0 && breakdown.reduce((a: number, b: number) => a + b, 0) === prevQty;
                        const rollPlan = useBreakdown ? breakdown : [prevQty];
                        const unitCostPerChild = children.length > 0
                            ? (Number(poItem.unitCost) || Number(lot.unitCost) || 0) / children.length
                            : (Number(poItem.unitCost) || Number(lot.unitCost) || 0);

                        for (const child of children) {
                            for (const qty of rollPlan) {
                                const newLotNum = reserveNextRollNumber();
                                const newRoll = await tx.inventoryItem.create({
                                    data: {
                                        id: `cm${randomBytes(11).toString('hex')}`,
                                        productId: child.childId,
                                        locationId: lot.locationId,
                                        variantId: child.variantId || null,
                                        quantity: qty, // Assign per-roll qty
                                        unitCost: unitCostPerChild, // Equal split unitCost
                                        lotNumber: newLotNum,
                                        receivedDate: lot.receivedDate || new Date(),
                                        updatedAt: new Date(),
                                    }
                                });
                                
                                await tx.inventoryMovement.create({
                                    data: {
                                        inventoryItemId: newRoll.id,
                                        type: 'Received',
                                        quantityChange: qty,
                                        balance: newRoll.quantity,
                                        notes: `(Backfill) Combo child receive from PO #${poId}`,
                                        user: 'System (Backfill)'
                                    }
                                });
                            }
                        }
                    } else {
                        // Validate dry run
                        const rollCount = (breakdown.length > 0 && breakdown.reduce((a: number, b: number) => a + b, 0) === lot.quantity)
                            ? breakdown.length
                            : 1;
                        console.log(`[DryRun] Would zero parent lot ${lot.lotNumber} (${lot.quantity} qty) and distribute to ${children.length} children with ${rollCount} roll(s) each.`);
                    }
                }
            });
            stats.fixed++;
            if (!isApply) console.log(`[DryRun] Can fix: PO ${poId}`);
        } catch (e: any) {
            stats.skipped++;
            console.log(`[Skipped] PO Item ${poItem.id} (PO ${poId}): ${e.message}`);
        }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Processed: ${stats.processed}`);
    console.log(`Fixed: ${stats.fixed}`);
    console.log(`Skipped: ${stats.skipped}`);
}

main().catch(console.error);
