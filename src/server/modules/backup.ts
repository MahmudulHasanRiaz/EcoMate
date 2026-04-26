import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { getBackupSettings } from "../utils/app-settings";
import prisma from "@/lib/prisma";

const execAsync = promisify(exec);
const BACKUP_DIR = "/tmp/erp-backups";

function getS3Client(settings: any) {
    // Normalize endpoint: must not end with slash or bucket name
    let endpoint = settings.r2Endpoint;
    if (endpoint.endsWith('/')) endpoint = endpoint.slice(0, -1);
    
    // If user accidentally put the bucket name in the endpoint URL, strip it
    if (settings.r2BucketName && endpoint.endsWith(`/${settings.r2BucketName}`)) {
        endpoint = endpoint.replace(`/${settings.r2BucketName}`, '');
    }

    console.log(`[BACKUP] Initializing S3 Client with endpoint: ${endpoint}`);

    return new S3Client({
        region: "auto",
        endpoint: endpoint,
        forcePathStyle: false, // R2 prefers virtual-hosted style
        credentials: {
            accessKeyId: settings.r2AccessKeyId,
            secretAccessKey: settings.r2SecretAccessKey,
        },
    });
}

export async function runBackup() {
    const settings = await getBackupSettings();
    if (!settings.r2AccessKeyId || !settings.r2SecretAccessKey || !settings.r2Endpoint || !settings.r2BucketName) {
        throw new Error("Backup settings are incomplete.");
    }

    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `backup-${timestamp}.sql.gz`;
    const filepath = path.join(BACKUP_DIR, filename);

    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL is not set.");

    // Strip only Prisma-specific params (schema), keep sslmode etc.
    const parsedUrl = new URL(dbUrl);
    parsedUrl.searchParams.delete('schema');
    const cleanDbUrl = parsedUrl.toString();

    try {
        console.log(`[BACKUP] Starting backup sequence for ${filename}...`);

        // Preflight: verify pg_dump is available
        try {
            const { stdout: pgVer } = await execAsync('pg_dump --version');
            console.log(`[BACKUP] pg_dump found: ${pgVer.trim()}`);
        } catch {
            throw new Error('pg_dump not found in PATH. Ensure postgresql-client is installed in the container.');
        }
        
        const isWindows = process.platform === 'win32';
        // Try to find pg_dump path on Windows
        let pgDump = 'pg_dump';
        if (isWindows) {
            const commonPaths = [
                'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
                'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
                'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
            ];
            for (const p of commonPaths) {
                if (fs.existsSync(p)) {
                    pgDump = `"${p}"`;
                    break;
                }
            }
        }

        console.log(`[BACKUP] Using pg_dump: ${pgDump}`);

        // Use pg_dump and compress. On Windows we use tar for compression if gzip isn't found.
        if (isWindows) {
            // On Windows, pipe to tar for compression
            const tempSql = filepath.replace('.gz', '');
            await execAsync(`${pgDump} -c --if-exists "${cleanDbUrl}" > "${tempSql}"`);
            await execAsync(`tar -czf "${filepath}" -C "${BACKUP_DIR}" "${path.basename(tempSql)}"`);
            if (fs.existsSync(tempSql)) fs.unlinkSync(tempSql);
        } else {
            await execAsync(`${pgDump} -c --if-exists "${cleanDbUrl}" | gzip > "${filepath}"`);
        }

        console.log(`[BACKUP] Local backup created: ${filename}. Size: ${fs.statSync(filepath).size} bytes.`);

        const s3 = getS3Client(settings);
        const fileBuffer = fs.readFileSync(filepath);
        
        await s3.send(new PutObjectCommand({
            Bucket: settings.r2BucketName,
            Key: `backups/${filename}`,
            Body: fileBuffer,
            ContentType: "application/gzip",
        }));

        console.log(`[BACKUP] Uploaded ${filename} to R2.`);

        fs.unlinkSync(filepath);
        return { filename, size: fileBuffer.length };
    } catch (error: any) {
        console.error(`[BACKUP] Process failed:`, error.message);
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        throw error;
    }
}

export async function listBackups() {
    const settings = await getBackupSettings();
    if (!settings.r2BucketName) return [];

    try {
        const s3 = getS3Client(settings);
        const result = await s3.send(new ListObjectsV2Command({
            Bucket: settings.r2BucketName,
            Prefix: "backups/",
        }));

        return (result.Contents || [])
            .map(item => ({
                key: item.Key!,
                filename: item.Key!.replace("backups/", ""),
                size: item.Size || 0,
                lastModified: item.LastModified,
            }))
            .sort((a, b) => (b.lastModified?.getTime() || 0) - (a.lastModified?.getTime() || 0));
    } catch (error: any) {
        console.error(`[BACKUP] Failed to list backups from R2:`, error.message);
        throw error;
    }
}

export async function deleteBackup(key: string) {
    const settings = await getBackupSettings();
    try {
        const s3 = getS3Client(settings);
        await s3.send(new DeleteObjectCommand({
            Bucket: settings.r2BucketName,
            Key: key,
        }));
    } catch (error: any) {
        console.error(`[BACKUP] Failed to delete backup ${key}:`, error.message);
        throw error;
    }
}

export async function cleanupOldBackups() {
    const settings = await getBackupSettings();
    if (!settings.enabled || settings.retentionCount <= 0) return;

    const backups = await listBackups();
    if (backups.length <= settings.retentionCount) return;

    // listBackups is already sorted by date descending (newest first)
    // We keep the first N backups and delete the rest
    const toKeep = backups.slice(0, settings.retentionCount);
    const toDelete = backups.slice(settings.retentionCount);

    console.log(`[BACKUP] Keeping ${toKeep.length} recent backups, deleting ${toDelete.length} old ones.`);

    for (const backup of toDelete) {
        await deleteBackup(backup.key);
        console.log(`[BACKUP] Deleted old backup: ${backup.key}`);
    }
}

export async function restoreBackup(key: string) {
    const settings = await getBackupSettings();
    const s3 = getS3Client(settings);

    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const filename = key.replace("backups/", "");
    const filepath = path.join(BACKUP_DIR, filename);
    const sqlFile = filepath.replace(".gz", "");

    try {
        // 1. Set maintenance mode
        await prisma.appSetting.upsert({
            where: { key: 'maintenance' },
            create: { key: 'maintenance', value: { enabled: true } as any },
            update: { value: { enabled: true } as any },
        });

        // 2. Download
        const response = await s3.send(new GetObjectCommand({
            Bucket: settings.r2BucketName,
            Key: key,
        }));
        
        const stream = response.Body as any;
        const fileStream = fs.createWriteStream(filepath);
        await new Promise((resolve, reject) => {
            stream.pipe(fileStream).on('finish', resolve).on('error', reject);
        });

        const isWindows = process.platform === 'win32';
        
        // 3. Decompress
        console.log(`[BACKUP] Decompressing ${filepath}...`);
        if (isWindows) {
            await execAsync(`tar -xzf "${filepath}" -C "${BACKUP_DIR}"`);
        } else {
            await execAsync(`gunzip -f "${filepath}"`);
        }

        // 4. Restore
        console.log(`[BACKUP] Extract complete. Starting SQL restore...`);
        const dbUrl = process.env.DATABASE_URL;
        if (!dbUrl) throw new Error("DATABASE_URL is not set.");
        const restoreParsedUrl = new URL(dbUrl);
        restoreParsedUrl.searchParams.delete('schema');
        const cleanDbUrl = restoreParsedUrl.toString();
        
        let psql = 'psql';
        if (isWindows) {
            const commonPaths = [
                'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
                'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
                'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
            ];
            for (const p of commonPaths) {
                if (fs.existsSync(p)) {
                    psql = `"${p}"`;
                    break;
                }
            }
        }

        console.log(`[BACKUP] Starting restore using ${psql}...`);
        
        // 4.1 Clear existing schema to ensure a clean slate (essential for older backups without --clean)
        console.log(`[BACKUP] Clearing public schema...`);
        try {
            await execAsync(`${psql} "${cleanDbUrl}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`);
        } catch (schemaErr: any) {
            console.warn(`[BACKUP] Schema clear warning (ignoring):`, schemaErr.message);
        }

        // Use psql for restore. 
        // We use ON_ERROR_STOP to ensure we don't report success if SQL fails.
        await execAsync(`${psql} "${cleanDbUrl}" --set ON_ERROR_STOP=1 -f "${sqlFile}"`);

        console.log(`[BACKUP] Restore successful for ${key}.`);

        // 5. Cleanup
        if (fs.existsSync(sqlFile)) fs.unlinkSync(sqlFile);
        
        // 6. Disable maintenance mode
        await prisma.appSetting.upsert({
            where: { key: 'maintenance' },
            create: { key: 'maintenance', value: { enabled: false } as any },
            update: { value: { enabled: false } as any },
        });

        return { success: true };
    } catch (error: any) {
        console.error(`[BACKUP_RESTORE] Process failed:`, error.message);
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        if (fs.existsSync(sqlFile)) fs.unlinkSync(sqlFile);
        
        // Ensure maintenance mode is off even on error
        await prisma.appSetting.upsert({
            where: { key: 'maintenance' },
            create: { key: 'maintenance', value: { enabled: false } as any },
            update: { value: { enabled: false } as any },
        });
        
        throw error;
    }
}
