
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

const execPromise = promisify(exec);

/**
 * Database Backup Script
 * 
 * Usage: npx tsx scripts/backup.ts
 * 
 * Requirements:
 * - pg_dump must be installed and in the system PATH.
 * - DATABASE_URL must be defined in the .env file.
 */
async function runBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(process.cwd(), 'backups');
    const filename = `backup-${timestamp}.sql`;
    const filepath = path.join(backupDir, filename);

    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
        console.log(`Creating backup directory: ${backupDir}`);
        fs.mkdirSync(backupDir, { recursive: true });
    }

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('ERROR: DATABASE_URL is not defined in .env file.');
        process.exit(1);
    }

    console.log('--------------------------------------------------');
    console.log('🚀 Starting Enterprise Database Backup');
    console.log(`📂 Destination: ${filepath}`);
    console.log('--------------------------------------------------');

    try {
        // Run pg_dump command
        // Use quotes around dbUrl to handle special characters in password/host
        await execPromise(`pg_dump -d "${dbUrl}" -f "${filepath}"`);

        console.log('✅ Backup successful!');

        // Optional: Log file size
        const stats = fs.statSync(filepath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`📊 File Size: ${fileSizeMB} MB`);

    } catch (error: any) {
        console.error('❌ Backup failed!');
        console.error('Error Details:', error.message);

        if (error.message.includes('not recognized as an internal or external command')) {
            console.error('\nTIP: Make sure pg_dump is installed and added to your system PATH.');
            console.error('Download PostgreSQL Tools: https://www.postgresql.org/download/windows/');
        }
    }
    console.log('--------------------------------------------------');
}

runBackup();
