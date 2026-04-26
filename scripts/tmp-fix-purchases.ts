import fs from 'fs';

const filePath = 'src/server/modules/purchases.ts';
let content = fs.readFileSync(filePath, 'utf8');

const regex = /\/\/ We only want to generate inventory for children if Combo[\s\S]*?\/\/ Check if ALL items are fully covered/;

const replacement = `// We only want to generate inventory for children if Combo
                    const targets = isCombo && (poItem as any).product?.comboItems?.length > 0
                        ? (poItem as any).product.comboItems.map((ci: any) => ({
                            productId: ci.childId,
                            variantId: ci.variantId || null,
                        }))
                        : [{ productId: poItem.productId, variantId: poItem.variantId ?? null }];

                    if (effectiveBreakdown.length > 0) {
                        for (const target of targets) {
                            for (const pindaQty of effectiveBreakdown) {
                                if (pindaQty <= 0) continue;
                                const rollLotNum = reserveNextRollNumber();
                                const beforeTotal = await getAvailableQtyTx(tx, target.productId, target.variantId ?? null);
                                const createdItem = await tx.inventoryItem.create({
                                    data: {
                                        id: \`cm\${randomBytes(11).toString('hex')}\`,
                                        productId: target.productId,
                                        locationId: locationId,
                                        variantId: target.variantId ?? null,
                                        quantity: pindaQty,
                                        unitCost: poItem.unitCost || 0,
                                        lotNumber: rollLotNum,
                                        receivedDate: new Date(),
                                        updatedAt: new Date()
                                    }
                                });
                                const nextAvailable = calculateAvailableQty(createdItem.quantity, createdItem.reservedQuantity);
                                const afterTotal = Math.max(beforeTotal + nextAvailable, 0);
                                await maybeTriggerStockStatusSyncByTotals(target.productId, target.variantId ?? null, beforeTotal, afterTotal);
                                await tx.inventoryMovement.create({
                                    data: {
                                        inventoryItemId: createdItem.id,
                                        type: 'Received',
                                        quantityChange: pindaQty,
                                        balance: createdItem.quantity,
                                        notes: \`Roll \${rollLotNum} from PO #\${purchaseOrderId}\${isCombo ? ' (Combo child)' : ''}\`,
                                        user: user || 'System',
                                    }
                                });
                            }
                        }
                    } else {
                        // No pinda breakdown: create exactly one roll for this product in this receive action
                        for (const target of targets) {
                            const rollLotNum = reserveNextRollNumber();
                            const beforeTotal = await getAvailableQtyTx(tx, target.productId, target.variantId ?? null);
                            const createdItem = await tx.inventoryItem.create({
                                data: {
                                    id: \`cm\${randomBytes(11).toString('hex')}\`,
                                    productId: target.productId,
                                    locationId: locationId,
                                    variantId: target.variantId ?? null,
                                    quantity: qtyToReceive,
                                    unitCost: poItem.unitCost || 0,
                                    lotNumber: rollLotNum,
                                    receivedDate: new Date(),
                                    updatedAt: new Date()
                                }
                            });
                            const nextAvailable = calculateAvailableQty(createdItem.quantity, createdItem.reservedQuantity);
                            const afterTotal = Math.max(beforeTotal + nextAvailable, 0);
                            await maybeTriggerStockStatusSyncByTotals(
                                target.productId,
                                target.variantId ?? null,
                                beforeTotal,
                                afterTotal
                            );
                            await tx.inventoryMovement.create({
                                data: {
                                    inventoryItemId: createdItem.id,
                                    type: 'Received',
                                    quantityChange: qtyToReceive,
                                    balance: createdItem.quantity,
                                    notes: \`Roll \${rollLotNum} from PO #\${purchaseOrderId}\${isCombo ? ' (Combo child)' : ''}\`,
                                    user: user || 'System',
                                }
                            });
                        }
                    }
                }
            }

            // Check if ALL items are fully covered`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Successfully replaced block via regex!');
} else {
    console.error('Regex not matched.');
}
