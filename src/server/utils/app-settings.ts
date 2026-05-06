import prisma from '@/lib/prisma';
import { unstable_cache, revalidateTag } from 'next/cache';
import { defaultBadgeRules, normalizeBadgeRules, type BadgeRules } from '@/lib/badges';

export type BrandingSettings = {
    standardLogoUrl: string;
    iconLogoUrl: string;
    darkLogoUrl: string;
    appIconUrl: string;
};

export type GeneralSettings = {
    storeName: string;
    storeAddress: string;
    currency: string;
    timezone: string;
    weightUnit: string;
    dimensionUnit: string;
    lowStockThreshold: number;
    weekendDays: number[];
    holidays: string[];
    theme?: 'light' | 'dark' | 'system';
    badgeRules: BadgeRules;
    stockSyncMode?: 'inventory' | 'publish';
    lateGraceMinutes: number;
    workStartTime: string;
    overtimeRate: number;
    overtimeMaxHours: number;
    defaultLeaveAllocation: Record<string, number>;
    allowAutoManagerApproval: boolean;
};

const brandingDefaults: BrandingSettings = {
    standardLogoUrl: '/logo-full.svg',
    iconLogoUrl: '/logo-icon.svg',
    darkLogoUrl: '/logo-white.svg',
    appIconUrl: '/icons/icon-512x512.png',
};

const generalDefaults: GeneralSettings = {
    storeName: 'EcoMate',
    storeAddress: '',
    currency: 'BDT',
    timezone: 'Asia/Dhaka',
    weightUnit: 'kg',
    dimensionUnit: 'cm',
    lowStockThreshold: 5,
    weekendDays: [5, 6],
    holidays: [],
    theme: 'system',
    badgeRules: defaultBadgeRules,
    stockSyncMode: 'inventory',
    lateGraceMinutes: 0,
    workStartTime: '09:00',
    overtimeRate: 1.0,
    overtimeMaxHours: 0,
    defaultLeaveAllocation: {},
    allowAutoManagerApproval: false,
};

const normalizeString = (val: unknown, fallback: string) => {
    if (typeof val === 'string' && val.trim().length > 0) return val;
    return fallback;
};

const normalizeNumberArray = (val: unknown, fallback: number[]) => {
    if (!Array.isArray(val)) return fallback;
    const normalized = val
        .map((item) => (typeof item === 'string' ? Number(item) : item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);
    return Array.from(new Set(normalized));
};

const normalizeHolidayArray = (val: unknown, fallback: string[]) => {
    if (!Array.isArray(val)) return fallback;
    const normalized = val
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
    return Array.from(new Set(normalized));
};

const normalizeTheme = (val: unknown, fallback: GeneralSettings['theme']) => {
    if (val === 'light' || val === 'dark' || val === 'system') return val;
    return fallback;
};

const normalizeNumber = (val: unknown, fallback: number) => {
    const num = typeof val === 'string' ? Number(val) : val;
    return Number.isFinite(num as number) ? Number(num) : fallback;
};

const readBrandingSettingsFromDb = async (): Promise<BrandingSettings> => {
    const record = await prisma.appSetting.findUnique({ where: { key: 'branding' } });
    const value = (record?.value as Partial<BrandingSettings> | undefined) || {};
    return {
        standardLogoUrl: normalizeString(value.standardLogoUrl, brandingDefaults.standardLogoUrl),
        iconLogoUrl: normalizeString(value.iconLogoUrl, brandingDefaults.iconLogoUrl),
        darkLogoUrl: normalizeString(value.darkLogoUrl, brandingDefaults.darkLogoUrl),
        appIconUrl: normalizeString(value.appIconUrl, brandingDefaults.appIconUrl),
    };
};

const cachedBrandingSettings = unstable_cache(
    readBrandingSettingsFromDb,
    ['settings', 'branding'],
    { tags: ['settings', 'branding'], revalidate: 3600 }
);

export const getBrandingSettings = async (): Promise<BrandingSettings> => {
    try {
        return await cachedBrandingSettings();
    } catch (e: any) {
        if (e?.message?.includes('incrementalCache missing in unstable_cache')) {
            return await readBrandingSettingsFromDb();
        }
        throw e;
    }
};

const readGeneralSettingsFromDb = async (): Promise<GeneralSettings> => {
    const record = await prisma.appSetting.findUnique({ where: { key: 'general' } });
    const value = (record?.value as Partial<GeneralSettings> | undefined) || {};
    return {
        storeName: normalizeString(value.storeName, generalDefaults.storeName),
        storeAddress: normalizeString(value.storeAddress, generalDefaults.storeAddress),
        currency: normalizeString(value.currency, generalDefaults.currency),
        timezone: normalizeString(value.timezone, generalDefaults.timezone),
        weightUnit: normalizeString(value.weightUnit, generalDefaults.weightUnit),
        dimensionUnit: normalizeString(value.dimensionUnit, generalDefaults.dimensionUnit),
        lowStockThreshold: normalizeNumber(value.lowStockThreshold, generalDefaults.lowStockThreshold),
        weekendDays: normalizeNumberArray(value.weekendDays, generalDefaults.weekendDays),
        holidays: normalizeHolidayArray(value.holidays, generalDefaults.holidays),
        theme: normalizeTheme(value.theme, generalDefaults.theme),
        badgeRules: normalizeBadgeRules(value.badgeRules, generalDefaults.badgeRules),
        stockSyncMode: value.stockSyncMode === 'publish' ? 'publish' : 'inventory',
        lateGraceMinutes: normalizeNumber(value.lateGraceMinutes, generalDefaults.lateGraceMinutes),
        workStartTime: normalizeString(value.workStartTime, generalDefaults.workStartTime),
        overtimeRate: normalizeNumber(value.overtimeRate, generalDefaults.overtimeRate),
        overtimeMaxHours: normalizeNumber(value.overtimeMaxHours, generalDefaults.overtimeMaxHours),
        defaultLeaveAllocation: (typeof value.defaultLeaveAllocation === 'object' && value.defaultLeaveAllocation !== null && !Array.isArray(value.defaultLeaveAllocation)) ? value.defaultLeaveAllocation : generalDefaults.defaultLeaveAllocation,
        allowAutoManagerApproval: typeof value.allowAutoManagerApproval === 'boolean' ? value.allowAutoManagerApproval : generalDefaults.allowAutoManagerApproval,
    };
};

const cachedGeneralSettings = unstable_cache(
    readGeneralSettingsFromDb,
    ['settings', 'general'],
    { tags: ['settings', 'general'], revalidate: 3600 }
);

export const getGeneralSettings = async (): Promise<GeneralSettings> => {
    try {
        return await cachedGeneralSettings();
    } catch (e: any) {
        if (e?.message?.includes('incrementalCache missing in unstable_cache')) {
            return await readGeneralSettingsFromDb();
        }
        throw e;
    }
};
export type BackupSettings = {
    enabled: boolean;
    r2AccessKeyId: string;
    r2SecretAccessKey: string;
    r2Endpoint: string;
    r2BucketName: string;
    r2PublicUrl?: string;
    retentionCount: number;
    frequency: 'hourly' | 'daily' | 'weekly';
    interval: number;
    scheduleCron?: string; // Kept for internal queue sync
};

const backupDefaults: BackupSettings = {
    enabled: false,
    r2AccessKeyId: '',
    r2SecretAccessKey: '',
    r2Endpoint: '',
    r2BucketName: '',
    r2PublicUrl: '',
    retentionCount: 10,
    frequency: 'daily',
    interval: 1,
};

const readBackupSettingsFromDb = async (): Promise<BackupSettings> => {
    const record = await prisma.appSetting.findUnique({ where: { key: 'backup' } });
    const value = (record?.value as Partial<BackupSettings> | undefined) || {};
    return {
        enabled: !!value.enabled,
        r2AccessKeyId: normalizeString(value.r2AccessKeyId, backupDefaults.r2AccessKeyId),
        r2SecretAccessKey: normalizeString(value.r2SecretAccessKey, backupDefaults.r2SecretAccessKey),
        r2Endpoint: normalizeString(value.r2Endpoint, backupDefaults.r2Endpoint),
        r2BucketName: normalizeString(value.r2BucketName, backupDefaults.r2BucketName),
        r2PublicUrl: value.r2PublicUrl || '',
        retentionCount: normalizeNumber(value.retentionCount, backupDefaults.retentionCount),
        frequency: (value.frequency === 'hourly' || value.frequency === 'daily' || value.frequency === 'weekly') ? value.frequency : backupDefaults.frequency,
        interval: normalizeNumber(value.interval, backupDefaults.interval),
        scheduleCron: value.scheduleCron,
    };
};

const cachedBackupSettings = unstable_cache(
    readBackupSettingsFromDb,
    ['settings', 'backup'],
    { tags: ['settings', 'backup'], revalidate: 3600 }
);

export const getBackupSettings = async (): Promise<BackupSettings> => {
    try {
        return await cachedBackupSettings();
    } catch (e: any) {
        if (e?.message?.includes('incrementalCache missing in unstable_cache')) {
            return await readBackupSettingsFromDb();
        }
        throw e;
    }
};

export const getMaintenanceMode = async (): Promise<boolean> => {
    try {
        const record = await prisma.appSetting.findUnique({ where: { key: 'maintenance' } });
        return (record?.value as any)?.enabled === true;
    } catch {
        return false;
    }
};

export const updateBackupSettings = async (data: Partial<BackupSettings>) => {
    const current = await readBackupSettingsFromDb();
    const updated = { ...current, ...data };
    await prisma.appSetting.upsert({
        where: { key: 'backup' },
        create: { key: 'backup', value: updated as any },
        update: { value: updated as any },
    });
    
    // Revalidate cache after update
    revalidateTag('settings', 'page');
    revalidateTag('backup', 'page');
};
