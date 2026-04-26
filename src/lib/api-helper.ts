/**
 * API Helper Utility
 * Standardizes base URL resolution for SSR/CSR and response destructuring.
 */

export function getBaseUrl() {
    if (typeof window !== 'undefined') {
        return window.location.origin.replace(/\/$/, '');
    }
    // Fallback for SSR
    const envUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (envUrl) {
        const trimmed = envUrl.replace(/\/$/, '');
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) return `http://${trimmed}`;
        return `https://${trimmed}`;
    }

    // Use http for localhost usually
    return 'http://localhost:9002';
}

export class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
        super(message);
        this.name = 'AuthError';
        this.statusCode = statusCode;
    }
}

/**
 * Destructures the standardized ApiResponse structure.
 * Returns the inner 'data' property if success is true.
 */
export async function handleApiResponse<T>(response: Response): Promise<T> {
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new AuthError(json.message || json.error || 'Session expired', response.status);
        }
        throw new Error(json.message || json.error || `HTTP error! status: ${response.status}`);
    }
    // Our standardized response wraps payload in 'data'
    if (json.success && json.data !== undefined) {
        return json.data as T;
    }
    return json as T;
}
