import { headers } from 'next/headers';

/**
 * Capture request headers during SSR to pass auth context to internal API calls.
 * This file MUST ONLY be imported in Server Components or Server Actions.
 */
export async function getSsrHeaders(): Promise<Record<string, string>> {
    if (typeof window !== 'undefined') return {};
    try {
        const headerList = await headers();
        const cookie = headerList.get('cookie');
        return cookie ? { cookie } : {};
    } catch (e) {
        // Not in a request context
        return {};
    }
}

export async function getServerBaseUrl(): Promise<string> {
    if (typeof window !== 'undefined') return '';
    try {
        const headerList = await headers();
        const host = headerList.get('x-forwarded-host') ?? headerList.get('host');
        const proto = headerList.get('x-forwarded-proto') ?? 'http';
        if (host) return `${proto}://${host}`;
    } catch (e) {
        // Not in a request context
    }
    const envUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (envUrl) {
        const trimmed = envUrl.replace(/\/$/, '');
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) return `http://${trimmed}`;
        return `https://${trimmed}`;
    }
    return 'http://localhost:9002';
}
