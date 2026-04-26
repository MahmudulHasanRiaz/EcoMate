import { z, ZodTypeAny } from 'zod';

/**
 * Central place for AppSetting JSON validation.
 * Extend the map with new keys + schemas as settings are added.
 */
export const appSettingSchemaMap = {
    featureFlags: z.record(z.string(), z.boolean()),
    permissions: z.record(z.string(), z.boolean()),
    uiPreferences: z.object({
        theme: z.enum(['light', 'dark']).optional(),
        density: z.enum(['comfortable', 'compact']).optional(),
        language: z.string().optional(),
    }),
    billing: z.object({
        currency: z.string().default('BDT'),
        taxRate: z.number().min(0).max(1).default(0),
    }),
} satisfies Record<string, ZodTypeAny>;

const fallbackSchema = z.unknown();

export type AppSettingKey = keyof typeof appSettingSchemaMap | (string & {});

export type AppSettingValue<K extends AppSettingKey = AppSettingKey> =
    K extends keyof typeof appSettingSchemaMap
        ? z.infer<(typeof appSettingSchemaMap)[K]>
        : unknown;

export function getAppSettingSchema(key: AppSettingKey): ZodTypeAny {
    return (appSettingSchemaMap as Record<string, ZodTypeAny>)[key] ?? fallbackSchema;
}

export function parseAppSettingValue<K extends AppSettingKey>(
    key: K,
    value: unknown
): AppSettingValue<K> {
    const schema = getAppSettingSchema(key);
    return schema.parse(value) as AppSettingValue<K>;
}
