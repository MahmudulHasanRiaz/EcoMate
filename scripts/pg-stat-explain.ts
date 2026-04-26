
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function runExplain(label: string, query: string, params: any[] = []) {
    try {
        const explainResult: any = await prisma.$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS) ${query}`, ...params);
        return `--- ${label} ---\n${explainResult.map((r: any) => r['QUERY PLAN']).join('\n')}\n`;
    } catch (e: any) {
        return `--- ${label} ERROR ---\n${e.message}\n`;
    }
}

async function main() {
    let analysis = '';

    // 1. SELECT StaffMember by clerkId (Top Read)
    analysis += await runExplain('SELECT StaffMember by clerkId',
        'SELECT "id" FROM "public"."StaffMember" WHERE "clerkId" = \'user_real_clerk_id_placeholder\' LIMIT 1');

    // 2. Aggregate OrderFinancialSnapshot
    analysis += await runExplain('Aggregate OrderFinancialSnapshot',
        'SELECT SUM("revenue") FROM "public"."OrderFinancialSnapshot" WHERE "businessId" = \'business_id_placeholder\'');

    // 3. SELECT CheckPassingItem
    analysis += await runExplain('SELECT CheckPassingItem',
        'SELECT * FROM "public"."CheckPassingItem" ORDER BY "passingDate" ASC LIMIT 20');

    const draftDir = path.join(process.cwd(), 'draft');
    if (!fs.existsSync(draftDir)) fs.mkdirSync(draftDir);

    fs.writeFileSync(path.join(draftDir, 'pg-stat-explain.txt'), analysis);
    console.log('EXPLAIN report saved to draft/pg-stat-explain.txt');
    await prisma.$disconnect();
}

main();
