
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
    try {
        const libs: any = await prisma.$queryRawUnsafe('SHOW shared_preload_libraries;');
        console.log('Preload Libraries:', JSON.stringify(libs, null, 2));

        try {
            await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_stat_statements;');
            console.log('Extension pg_stat_statements ensured.');
        } catch (e: any) {
            console.error('Error creating extension:', e.message);
        }

        const report: any = await prisma.$queryRawUnsafe(`
      SELECT now() AS captured_at,
             calls,
             total_exec_time,
             mean_exec_time,
             rows,
             query
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY total_exec_time DESC
      LIMIT 20;
    `);
        const reportJson = JSON.stringify(report, (key, value) =>
            typeof value === 'bigint'
                ? value.toString()
                : value
            , 2);

        const timestamp = new Date().toISOString();
        const finalReport = `TIMESTAMP: ${timestamp}\n\n${reportJson}`;

        const draftDir = path.join(process.cwd(), 'draft');
        if (!fs.existsSync(draftDir)) {
            fs.mkdirSync(draftDir);
        }

        fs.writeFileSync(path.join(draftDir, 'pg-stat-report.txt'), finalReport);
        console.log('PG_STAT_REPORT_SAVED: draft/pg-stat-report.txt');

    } catch (error: any) {
        console.error('Database Error:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();
