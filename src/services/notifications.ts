import type { Notification } from '@/types';

export async function getNotifications(): Promise<Notification[]> {
    try {
        const res = await fetch('/api/notifications', { cache: 'no-store' });
        if (!res.ok) return [];
        const data = await res.json();
        return data.data || [];
    } catch (err) {
        console.error('[SERVICE_ERROR:getNotifications]', err);
        return [];
    }
}

export async function markAllAsRead(): Promise<void> {
    try {
        await fetch('/api/notifications', { method: 'PATCH' });
    } catch (err) {
        console.error('[SERVICE_ERROR:markAllAsRead]', err);
    }
}

export async function markAsRead(id: string): Promise<void> {
    try {
        await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    } catch (err) {
        console.error('[SERVICE_ERROR:markAsRead]', err);
    }
}
