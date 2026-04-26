'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { RotateCcw, Filter, AlertCircle, Search } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { getWebhookFailures, replayWebhookFailure, type WebhookFailure } from '@/services/webhooks';
import { useUser } from '@clerk/nextjs';
import { usePermissions } from '@/hooks/use-permissions';

export default function WebhookFailuresPage() {
    const { toast } = useToast();
    const { user, isLoaded: isUserLoaded } = useUser();
    const permissions = usePermissions();
    const [failures, setFailures] = React.useState<WebhookFailure[]>([]);
    const [nextCursor, setNextCursor] = React.useState<string | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isReplaying, setIsReplaying] = React.useState<string | null>(null);
    const [isClient, setIsClient] = React.useState(false);

    // Filters
    const [source, setSource] = React.useState('');
    const [integrationId, setIntegrationId] = React.useState('');
    const [orderId, setOrderId] = React.useState('');
    const [dateFrom, setDateFrom] = React.useState('');
    const [dateTo, setDateTo] = React.useState('');
    const [status, setStatus] = React.useState<'Open' | 'Resolved' | 'Ignored' | 'all'>('Open');

    const role = user?.publicMetadata?.role as string | undefined;
    const isAdmin = role?.toLowerCase() === 'admin';
    const integrationsPerm = permissions?.integrations;
    const hasAccess = Boolean(isAdmin || (typeof integrationsPerm === 'object' && integrationsPerm?.read));

    const fetchFailures = React.useCallback(async (cursor?: string) => {
        setIsLoading(true);
        try {
            const data = await getWebhookFailures({
                source: source || undefined,
                integrationId: integrationId || undefined,
                orderId: orderId || undefined,
                dateFrom: dateFrom || undefined,
                dateTo: dateTo || undefined,
                status: status === 'all' ? undefined : status,
                cursor,
                pageSize: 20
            });

            if (cursor) {
                setFailures(prev => [...prev, ...data.items]);
            } else {
                setFailures(data.items);
            }
            setNextCursor(data.nextCursor);
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: err?.message || 'Failed to load webhook failures'
            });
        } finally {
            setIsLoading(false);
        }
    }, [source, integrationId, orderId, dateFrom, dateTo, status, toast]);

    React.useEffect(() => {
        setIsClient(true);
        if (isUserLoaded && hasAccess) {
            fetchFailures();
        }
    }, [isUserLoaded, hasAccess, fetchFailures]);

    const handleReplay = async (id: string) => {
        setIsReplaying(id);
        try {
            const result = await replayWebhookFailure(id);
            toast({
                title: 'Replay Successful',
                description: result?.message || 'The webhook has been re-triggered.'
            });
            // Refresh current list to show possible notes updates if the API updates them immediately
            fetchFailures();
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Replay Failed',
                description: err?.message || 'Failed to replay webhook'
            });
        } finally {
            setIsReplaying(null);
        }
    };

    const handleStatusChange = async (id: string, newStatus: 'Resolved' | 'Ignored') => {
        try {
            await fetch(`/api/webhooks/failures/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            toast({ title: 'Success', description: `Failure marked as ${newStatus}` });
            fetchFailures();
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: err?.message || 'Failed to update status'
            });
        }
    };

    if (!isClient) return null;

    if (!isUserLoaded || (!isAdmin && (!permissions || typeof permissions === 'undefined'))) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Skeleton className="h-24 w-full max-w-md" />
            </div>
        );
    }

    if (!hasAccess) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
                            <AlertCircle className="h-6 w-6" />
                        </div>
                        <CardTitle>Access Denied</CardTitle>
                        <CardDescription>
                            You do not have the required permissions to view webhook failures.
                        </CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-7xl mx-auto p-4 md:p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Webhook Failures</h2>
                    <p className="text-muted-foreground">
                        Monitor and manually replay failed webhook notifications.
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Filter className="h-4 w-4" /> Filters
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                        <div className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">Source</span>
                            <Input
                                placeholder="e.g. woo-webhook"
                                value={source}
                                onChange={e => setSource(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">Integration ID</span>
                            <Input
                                placeholder="ID..."
                                value={integrationId}
                                onChange={e => setIntegrationId(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">Order ID</span>
                            <Input
                                placeholder="External or Internal ID"
                                value={orderId}
                                onChange={e => setOrderId(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">Date From</span>
                            <Input
                                type="date"
                                value={dateFrom}
                                onChange={e => setDateFrom(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">Date To</span>
                            <Input
                                type="date"
                                value={dateTo}
                                onChange={e => setDateTo(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1">
                            <span className="text-xs font-medium text-muted-foreground">Status</span>
                            <select
                                className="w-full h-10 px-3 py-2 bg-background border rounded-md text-sm"
                                value={status}
                                onChange={e => setStatus(e.target.value as any)}
                            >
                                <option value="Open">Open</option>
                                <option value="Resolved">Resolved</option>
                                <option value="Ignored">Ignored</option>
                                <option value="all">All</option>
                            </select>
                        </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                        <Button variant="secondary" onClick={() => fetchFailures()} className="gap-2">
                            <Search className="h-4 w-4" /> Search
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[180px]">Last Seen</TableHead>
                                <TableHead>Source</TableHead>
                                <TableHead>Integration/Order</TableHead>
                                <TableHead>Occurrences</TableHead>
                                <TableHead className="max-w-[300px]">Error</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {failures.map((failure) => (
                                <TableRow key={failure.id}>
                                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                        <div className="flex flex-col">
                                            <span>{format(new Date(failure.lastSeenAt || failure.createdAt), 'MMM d, HH:mm:ss')}</span>
                                            {failure.createdAt !== failure.lastSeenAt && (
                                                <span className="text-[10px] opacity-70 italic">First: {format(new Date(failure.createdAt), 'MMM d')}</span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col gap-1">
                                            <Badge variant="outline" className="w-fit">{failure.source}</Badge>
                                            <Badge
                                                variant={failure.status === 'Open' ? 'destructive' : failure.status === 'Resolved' ? 'secondary' : 'outline'}
                                                className="text-[10px] w-fit px-1 h-4"
                                            >
                                                {failure.status}
                                            </Badge>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col gap-1 text-xs">
                                            {failure.integrationId && (
                                                <span className="truncate max-w-[150px]" title={failure.integrationId}>
                                                    Intg: {failure.integrationId}
                                                </span>
                                            )}
                                            {failure.externalOrderId && (
                                                <span className="font-medium">Ext: {failure.externalOrderId}</span>
                                            )}
                                            {failure.orderId && (
                                                <span className="text-muted-foreground">Int: {failure.orderId}</span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center font-bold">
                                        {failure.occurrences || 1}
                                    </TableCell>
                                    <TableCell className="max-w-[300px]">
                                        <p className="text-xs line-clamp-2 text-red-500 font-mono italic" title={failure.error}>
                                            {failure.error}
                                        </p>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-8 w-8 p-0"
                                            disabled={isReplaying === failure.id}
                                            onClick={() => handleReplay(failure.id)}
                                            title="Replay Webhook"
                                        >
                                            <RotateCcw className={cn("h-4 w-4", isReplaying === failure.id && "animate-spin")} />
                                        </Button>

                                        {failure.status === 'Open' && (
                                            <div className="flex gap-1 justify-end mt-1">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-6 text-[10px] px-2"
                                                    onClick={() => handleStatusChange(failure.id, 'Resolved')}
                                                >
                                                    Resolve
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-6 text-[10px] px-2"
                                                    onClick={() => handleStatusChange(failure.id, 'Ignored')}
                                                >
                                                    Ignore
                                                </Button>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                            {isLoading && (
                                [...Array(5)].map((_, i) => (
                                    <TableRow key={`skeleton-${i}`}>
                                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                        <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                                        <TableCell><Skeleton className="h-10 w-32" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                                        <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                                    </TableRow>
                                ))
                            )}
                            {!isLoading && failures.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                                        No webhook failures found matching your filters.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {nextCursor && (
                <div className="flex justify-center">
                    <Button
                        variant="outline"
                        onClick={() => fetchFailures(nextCursor)}
                        disabled={isLoading}
                    >
                        {isLoading ? 'Loading...' : 'Load More'}
                    </Button>
                </div>
            )}
        </div>
    );
}

