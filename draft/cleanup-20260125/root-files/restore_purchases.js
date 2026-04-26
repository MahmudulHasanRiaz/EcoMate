const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/server/modules/purchases.ts');
const snippetPath = path.join(__dirname, 'src/server/modules/purchases.ts_snippet.ts');

const fileContent = fs.readFileSync(filePath, 'utf8');
const snippetContent = fs.readFileSync(snippetPath, 'utf8');

// The marker where we accidentally cut the file
const marker = 'export async function getPurchaseStats(dateRange?: { from: string; to: string }';
const markerIdx = fileContent.indexOf(marker);

if (markerIdx === -1) {
    console.error('Could not find start of getPurchaseStats to restore');
    process.exit(1);
}

const getPurchaseStatsCode = `export async function getPurchaseStats(dateRange?: { from: string; to: string }) {
    try {
        const where: any = {};
        if (dateRange?.from || dateRange?.to) {
            where.date = {};
            if (dateRange.from) where.date.gte = new Date(dateRange.from);
            if (dateRange.to) where.date.lte = new Date(dateRange.to);
        }

        const purchases = await prisma.purchaseOrder.findMany({
            where,
            select: { id: true, total: true, status: true, items: true }
        });

        const stats = {
            totalCount: 0,
            totalValue: 0,
            totalRunningValue: 0,
            inFabricQty: 0,
            inFabricValue: 0,
            inPrintingQty: 0,
            inPrintingValue: 0,
            inCuttingQty: 0,
            inCuttingValue: 0
        };

        purchases.forEach((po) => {
            stats.totalCount++;
            stats.totalValue += (po.total || 0);

            if (po.status !== 'Received' && po.status !== 'Cancelled') {
                stats.totalRunningValue += (po.total || 0);
            }

            const qty = po.items || 0;
            const val = po.total || 0;

            if (po.status === 'FabricOrdered') {
                stats.inFabricQty += qty;
                stats.inFabricValue += val;
            } else if (po.status === 'Printing') {
                stats.inPrintingQty += qty;
                stats.inPrintingValue += val;
            } else if (po.status === 'Cutting') {
                stats.inCuttingQty += qty;
                stats.inCuttingValue += val;
            }
        });

        return stats;
    } catch (error) {
        console.error('[SERVER_CORE_ERROR:getPurchaseStats]', error);
        throw error;
    }
}
`;

const cleanContent = fileContent.substring(0, markerIdx);
const newContent = cleanContent + getPurchaseStatsCode + '\n' + snippetContent;

fs.writeFileSync(filePath, newContent, 'utf8');
console.log('Restored purchases.ts');
