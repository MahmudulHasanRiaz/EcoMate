import prisma from '@/lib/prisma';
import { NotificationIcon } from '@prisma/client';
import { enqueueNotificationJob } from '@/server/queues/notifications';

export type CreateNotificationParams = {
    staffId: string;
    title: string;
    description: string;
    href: string;
    icon?: NotificationIcon;
};

/**
 * Internal helper to create a notification record.
 */
export async function createNotification({
    staffId,
    title,
    description,
    href,
    icon = 'Bell'
}: CreateNotificationParams) {
    try {
        return await prisma.notification.create({
            data: {
                staffId,
                title,
                description,
                href,
                icon,
            },
        });
    } catch (error) {
        console.error('[SERVER_NOTIFICATION_ERROR]', error);
    }
}

async function queueOrCreateNotification(params: CreateNotificationParams) {
    const queued = await enqueueNotificationJob({
        staffId: params.staffId,
        title: params.title,
        description: params.description,
        href: params.href,
        icon: params.icon,
        key: params.staffId ? `${params.staffId}:${params.title}` : undefined,
    });
    if (queued.queued) return { queued: true };

    console.warn('[NOTIFY_QUEUE_UNAVAILABLE] Falling back to DB-only creation');
    return createNotification(params);
}

/**
 * Notify a specific staff member.
 */
export async function notifyStaffMember(
    staffId: string,
    title: string,
    description: string,
    href: string,
    icon: NotificationIcon = 'Bell'
) {
    return queueOrCreateNotification({ staffId, title, description, href, icon });
}

/**
 * Notify all staff members with 'Admin' or 'Manager' roles.
 */
export async function notifyAdmins(
    title: string,
    description: string,
    href: string,
    icon: NotificationIcon = 'Bell'
) {
    try {
        const admins = await prisma.staffMember.findMany({
            where: {
                role: { in: ['Admin', 'Manager'] }
            },
            select: { id: true }
        });

        const createPromises = admins.map((admin) =>
            queueOrCreateNotification({ staffId: admin.id, title, description, href, icon })
        );

        await Promise.all(createPromises);
    } catch (error) {
        console.error('[NOTIFY_ADMINS_ERROR]', error);
    }
}
