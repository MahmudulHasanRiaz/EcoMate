'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatLabel } from '@/lib/utils';
import { getNotifications, markAllAsRead, markAsRead } from '@/services/notifications';
import type { Notification } from '@/types';
import { formatDistanceToNow } from "date-fns";
import { NotificationIcon } from "@/components/notification-icon";
import * as React from 'react';


function NotificationItem({ notification, onRead }: { notification: Notification, onRead: (id: string) => void }) {
    return (
        <Link href={notification.href} className="block" onClick={() => onRead(notification.id)}>
            <div className={cn("flex items-start gap-4 p-4 border-b hover:bg-muted/50 transition-colors", !notification.read && "bg-blue-500/5")}>
                <div className={cn("p-2 rounded-full", !notification.read ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>
                    <NotificationIcon name={notification.icon} className="h-6 w-6" />
                </div>
                <div className="flex-1 grid gap-1">
                    <p className="font-semibold">{notification.title}</p>
                    <p className="text-sm text-muted-foreground">{notification.description}</p>
                    <time className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(notification.time), { addSuffix: true })}
                    </time>
                </div>
                {!notification.read && (
                    <div className="flex items-center h-full">
                        <div className="h-2 w-2 rounded-full bg-primary animate-pulse"></div>
                    </div>
                )}
            </div>
        </Link>
    );
}


export default function NotificationsPage() {
    const [notifications, setNotifications] = React.useState<Notification[]>([]);

    React.useEffect(() => {
        getNotifications().then(setNotifications);
    }, []);

    const unreadNotifications = notifications.filter(n => !n.read);
    const readNotifications = notifications.filter(n => n.read);

    const handleMarkAllAsRead = async () => {
        await markAllAsRead();
        setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    }

    const handleMarkAsRead = async (id: string) => {
        const n = notifications.find(x => x.id === id);
        if (n && !n.read) {
            await markAsRead(id);
            setNotifications(prev => prev.map(x => x.id === id ? { ...x, read: true } : x));
        }
    }

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-headline text-2xl font-bold">Notifications</h1>
                    <p className="text-muted-foreground hidden sm:block">View and manage all your notifications.</p>
                </div>
                <Button variant="outline" size="sm" onClick={handleMarkAllAsRead}>Mark all as read</Button>
            </div>
            <Card>
                <CardHeader className="p-0">
                    <Tabs defaultValue="all">
                        <TabsList className="grid w-full grid-cols-3 rounded-t-lg rounded-b-none">
                            <TabsTrigger value="all">All</TabsTrigger>
                            <TabsTrigger value="unread">
                                <div className="flex items-center gap-2">
                                    <span>Unread</span>
                                    {unreadNotifications.length > 0 && <Badge>{unreadNotifications.length}</Badge>}
                                </div>
                            </TabsTrigger>
                            <TabsTrigger value="archived">Archived</TabsTrigger>
                        </TabsList>
                        <TabsContent value="all" className="m-0">
                            {notifications.map(n => <NotificationItem key={n.id} notification={n} onRead={handleMarkAsRead} />)}
                        </TabsContent>
                        <TabsContent value="unread" className="m-0">
                            {unreadNotifications.length > 0 ? (
                                unreadNotifications.map(n => <NotificationItem key={n.id} notification={n} onRead={handleMarkAsRead} />)
                            ) : (
                                <div className="p-8 text-center text-muted-foreground">No unread notifications.</div>
                            )}
                        </TabsContent>
                        <TabsContent value="archived" className="m-0">
                            {readNotifications.map(n => <NotificationItem key={n.id} notification={n} onRead={handleMarkAsRead} />)}
                        </TabsContent>
                    </Tabs>
                </CardHeader>
            </Card>
        </div>
    );
}
