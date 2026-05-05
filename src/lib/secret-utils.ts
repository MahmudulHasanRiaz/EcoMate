/**
 * Masks a sensitive string by showing only the last 4 characters.
 * If the string is shorter than 4 characters, it returns it as is or a fixed mask.
 */
export function maskSecret(secret?: string | null): string {
    if (!secret) return "";
    if (secret.length <= 4) return "••••";
    return `••••${secret.slice(-4)}`;
}

/**
 * Recursively masks sensitive keys in an object.
 */
export function maskSensitiveFields(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(maskSensitiveFields);

    const sensitiveKeys = ['key', 'secret', 'token', 'password', 'apiKey', 'api_key', 'api_secret', 'app_secret'];
    const result: any = {};

    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase())) && typeof val === 'string') {
            result[key] = maskSecret(val);
        } else if (typeof val === 'object') {
            result[key] = maskSensitiveFields(val);
        } else {
            result[key] = val;
        }
    }
    return result;
}

/**
 * Checks if a string is a masked secret (starts with ••••).
 */
export function isMaskedSecret(val?: string | null): boolean {
    return typeof val === 'string' && val.startsWith('••••');
}
