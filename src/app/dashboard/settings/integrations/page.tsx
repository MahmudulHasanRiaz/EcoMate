

'use client';

import Link from 'next/link';
import { MoreHorizontal, PlusCircle, Store, Copy } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import * as React from 'react';

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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { getWooCommerceIntegrations } from '@/services/integrations';
import { getBusinesses } from '@/services/partners';
import type { WooCommerceIntegration, Business } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { createWooIntegration, updateWooIntegration, deleteWooIntegration } from './actions';

export default function IntegrationsPage() {
    const { toast } = useToast();
    const [integrations, setIntegrations] = React.useState<WooCommerceIntegration[]>([]);
    const [businesses, setBusinesses] = React.useState<Business[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isDialogOpen, setIsDialogOpen] = React.useState(false);
    const [isClient, setIsClient] = React.useState(false);
    const [formState, setFormState] = React.useState<{
        businessId: string;
        storeName: string;
        storeUrl: string;
        consumerKey: string;
        consumerSecret: string;
        webhookUrl?: string;
        webhookSecret?: string;
        apiKey?: string;
        autoSyncEnabled?: boolean;
        incompleteEnabled?: boolean;
        restrictionEnabled?: boolean;
        restrictionScope?: string;
        restrictionDurationType?: string;
        restrictionDurationValue?: number;
        restrictionMessage?: string;
        restrictionSupportPhone?: string;
        dedupeMinutes?: number;
        debounceMs?: number;
        retrySeconds?: number;
    }>({
        businessId: '',
        storeName: '',
        storeUrl: '',
        consumerKey: '',
        consumerSecret: '',
        webhookUrl: '',
        webhookSecret: '',
    });
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [isSaving, startSaving] = React.useTransition();
    const [menuResetKey, setMenuResetKey] = React.useState(0);

    // Sync UI State
    const [isSyncDialogOpen, setIsSyncDialogOpen] = React.useState(false);
    const [syncDays, setSyncDays] = React.useState(3);
    const [isSyncing, setIsSyncing] = React.useState(false);
    const [syncProgress, setSyncProgress] = React.useState(0);
    const [syncTarget, setSyncTarget] = React.useState<WooCommerceIntegration | null>(null);

    // Stock Sync Mode State
    const [stockSyncMode, setStockSyncMode] = React.useState<'inventory' | 'publish'>('inventory');
    const [isSavingMode, startSavingMode] = React.useTransition();

    const isDuplicateUrl = React.useMemo(() => {
        if (!formState.storeUrl) return false;
        const normalize = (u: string) => u.replace(/\/+$/, '').toLowerCase().trim();
        const currentUrl = normalize(formState.storeUrl);
        return integrations.some(integration =>
            integration.id !== editingId && normalize(integration.storeUrl) === currentUrl
        );
    }, [formState.storeUrl, integrations, editingId]);

    const openEditDialog = (integration: WooCommerceIntegration) => {
        openAfterMenu(() => {
            setEditingId(integration.id);
            setFormState({
                businessId: integration.businessId,
                storeName: integration.storeName,
                storeUrl: integration.storeUrl,
                consumerKey: integration.consumerKey,
                consumerSecret: integration.consumerSecret,
                webhookUrl: (integration as any).webhookUrl || '',
                webhookSecret: (integration as any).webhookSecret || '',
                apiKey: (integration as any).apiKey || '',
                autoSyncEnabled: !!(integration as any).autoSyncEnabled,
                incompleteEnabled: !!(integration as any).incompleteEnabled,
                restrictionEnabled: !!(integration as any).restrictionEnabled,
                restrictionScope: (integration as any).restrictionScope || 'site',
                restrictionDurationType: (integration as any).restrictionDurationType || 'days',
                restrictionDurationValue: (integration as any).restrictionDurationValue ?? 1,
                restrictionMessage: (integration as any).restrictionMessage || '',
                restrictionSupportPhone: (integration as any).restrictionSupportPhone || '',
                dedupeMinutes: (integration as any).dedupeMinutes ?? 10,
                debounceMs: (integration as any).debounceMs ?? 1200,
                retrySeconds: (integration as any).retrySeconds ?? 15,
            });
            setIsDialogOpen(true);
        });
    };

    const releaseFocus = () => {
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            (document.activeElement as HTMLElement | null)?.blur?.();
        } catch { /* no-op */ }
        setTimeout(() => {
            try { document.body?.focus?.(); } catch { }
        }, 0);
    };

    const openAfterMenu = (fn: () => void) => {
        releaseFocus();
        setTimeout(() => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => requestAnimationFrame(fn));
            } else {
                fn();
            }
        }, 0);
    };

    const handleDialogOpenChange = (open: boolean) => {
        if (!open) {
            setIsDialogOpen(false);
            setEditingId(null);
            setTimeout(() => {
                releaseFocus();
                setMenuResetKey(k => k + 1);
            }, 0);
        } else {
            setIsDialogOpen(true);
        }
    };

    const toggleAutoSync = async (integration: WooCommerceIntegration, checked: boolean) => {
        const payload: any = { ...integration, autoSyncEnabled: checked };
        const result = await updateWooIntegration(payload);
        if (result.success) {
            setIntegrations(prev => prev.map(i => i.id === integration.id ? { ...i, autoSyncEnabled: checked } : i));
            toast({ title: 'Success', description: `Auto-Sync turned ${checked ? 'ON' : 'OFF'}.` });
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to update auto-sync.' });
        }
    };

    const saveStockSyncMode = async () => {
        startSavingMode(async () => {
            try {
                const res = await fetch('/api/settings/general', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ stockSyncMode }),
                });
                if (!res.ok) throw new Error('Failed to save');
                toast({ title: 'Success', description: 'Stock sync mode saved.' });
            } catch (err) {
                toast({ title: 'Error', description: 'Failed to save.', variant: 'destructive' });
            }
        });
    };

    React.useEffect(() => {
        setIsClient(true);
        setIsLoading(true);
        Promise.all([
            getWooCommerceIntegrations(),
            getBusinesses(),
            fetch('/api/settings/general').then(r => r.json()).catch(() => ({}))
        ]).then(([integrationsData, businessesData, generalSettings]) => {
            setIntegrations(integrationsData);
            setBusinesses(businessesData);
            if (generalSettings?.stockSyncMode === 'publish') {
                setStockSyncMode('publish');
            }
            setIsLoading(false);
        });
    }, []);

    const renderTable = () => (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Store Name</TableHead>
                    <TableHead>Business</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                        <span className="sr-only">Actions</span>
                    </TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {isLoading ? (
                    [...Array(2)].map((_, i) => (
                        <TableRow key={i}>
                            <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                            <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                            <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                            <TableCell><Skeleton className="h-8 w-8 float-right" /></TableCell>
                        </TableRow>
                    ))
                ) : integrations.length > 0 ? (
                    integrations.map((integration) => (
                        <TableRow key={integration.id}>
                            <TableCell className="font-medium">{integration.storeName}</TableCell>
                            <TableCell>{integration.businessName}</TableCell>
                            <TableCell className="text-muted-foreground">{integration.storeUrl}</TableCell>
                            <TableCell>
                                <div className="flex items-center gap-4">
                                    <Badge variant={integration.status === 'Active' ? 'default' : 'secondary'}>
                                        {integration.status}
                                    </Badge>
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={!!integration.autoSyncEnabled}
                                            onCheckedChange={(checked) => toggleAutoSync(integration, checked)}
                                            aria-label="Toggle Auto-Sync"
                                        />
                                        <Label className="text-xs whitespace-nowrap hidden sm:inline-block">
                                            Auto-Sync: {integration.autoSyncEnabled ? 'ON' : 'OFF'}
                                        </Label>
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell>
                                <div className="flex justify-end">
                                    <DropdownMenu key={`${integration.id}-${menuResetKey}`}>
                                        <DropdownMenuTrigger asChild>
                                            <Button aria-haspopup="true" size="icon" variant="ghost">
                                                <MoreHorizontal className="h-4 w-4" />
                                                <span className="sr-only">Toggle menu</span>
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                            <DropdownMenuItem onSelect={() => openEditDialog(integration)}>
                                                Edit
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onSelect={() => {
                                                    openAfterMenu(() => {
                                                        setSyncTarget(integration);
                                                        setSyncProgress(0);
                                                        setIsSyncing(false);
                                                        setIsSyncDialogOpen(true);
                                                    });
                                                }}
                                            >
                                                Sync Orders
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                className="text-destructive"
                                                onSelect={() => {
                                                    openAfterMenu(() => {
                                                        if (window.confirm('Are you sure you want to delete this integration? This will not delete orders but will stop syncing.')) {
                                                            startSaving(async () => {
                                                                const result = await deleteWooIntegration(integration.id);
                                                                if (result.success) {
                                                                    const refreshed = await getWooCommerceIntegrations();
                                                                    setIntegrations(refreshed);
                                                                    toast({ title: 'Deleted', description: 'Integration removed successfully.' });
                                                                } else {
                                                                    toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to delete integration' });
                                                                }
                                                            });
                                                        }
                                                    });
                                                }}
                                            >
                                                Delete
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))
                ) : (
                    <TableRow>
                        <TableCell colSpan={5} className="text-center h-24">
                            No WooCommerce integrations found.
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );

    const renderCardList = () => (
        <div className="space-y-4">
            {isLoading ? (
                [...Array(2)].map((_, i) => (
                    <Card key={i}><CardContent className="p-4"><Skeleton className="h-24 w-full" /></CardContent></Card>
                ))
            ) : integrations.length > 0 ? (
                integrations.map((integration) => (
                    <Card key={integration.id}>
                        <CardContent className="p-4">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="font-semibold">{integration.storeName}</p>
                                    <p className="text-sm text-muted-foreground">{integration.businessName}</p>
                                </div>
                                <DropdownMenu key={`${integration.id}-card-${menuResetKey}`}>
                                    <DropdownMenuTrigger asChild>
                                        <Button aria-haspopup="true" size="icon" variant="ghost">
                                            <MoreHorizontal className="h-4 w-4" />
                                            <span className="sr-only">Toggle menu</span>
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                        <DropdownMenuItem onSelect={() => openEditDialog(integration)}>Edit</DropdownMenuItem>
                                        <DropdownMenuItem
                                            onSelect={() => {
                                                openAfterMenu(() => {
                                                    setSyncTarget(integration);
                                                    setSyncProgress(0);
                                                    setIsSyncing(false);
                                                    setIsSyncDialogOpen(true);
                                                });
                                            }}
                                        >
                                            Sync Orders
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            className="text-destructive"
                                            onSelect={() => {
                                                openAfterMenu(() => {
                                                    if (window.confirm('Are you sure you want to delete this integration? This will not delete orders but will stop syncing.')) {
                                                        startSaving(async () => {
                                                            const result = await deleteWooIntegration(integration.id);
                                                            if (result.success) {
                                                                const refreshed = await getWooCommerceIntegrations();
                                                                setIntegrations(refreshed);
                                                                toast({ title: 'Deleted', description: 'Integration removed successfully.' });
                                                            } else {
                                                                toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to delete integration' });
                                                            }
                                                        });
                                                    }
                                                });
                                            }}
                                        >
                                            Delete
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <p className="text-sm text-muted-foreground mt-2">{integration.storeUrl}</p>
                            <Separator className="my-3" />
                            <div className="flex items-center">
                                <Badge variant={integration.status === 'Active' ? 'default' : 'secondary'}>
                                    {integration.status}
                                </Badge>
                                <div className="flex items-center ml-auto gap-2">
                                    <Label className="text-xs text-muted-foreground whitespace-nowrap">
                                        Auto-Sync: {integration.autoSyncEnabled ? 'ON' : 'OFF'}
                                    </Label>
                                    <Switch
                                        checked={!!integration.autoSyncEnabled}
                                        onCheckedChange={(checked) => toggleAutoSync(integration, checked)}
                                        aria-label="Toggle Auto-Sync"
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))
            ) : (
                <div className="text-center text-muted-foreground py-8">No WooCommerce integrations found.</div>
            )}
        </div>
    );

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Integrations</h2>
                <p className="text-muted-foreground">
                    Connect and manage your external service integrations like WooCommerce.
                </p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Stock Sync Mode</CardTitle>
                    <CardDescription>
                        Choose how stock status is synced with WooCommerce.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-col gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="stockSyncMode"
                                value="inventory"
                                checked={stockSyncMode === 'inventory'}
                                onChange={() => setStockSyncMode('inventory')}
                                className="w-4 h-4"
                            />
                            <span className="text-sm">Yes (Inventory Based)</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="radio"
                                name="stockSyncMode"
                                value="publish"
                                checked={stockSyncMode === 'publish'}
                                onChange={() => setStockSyncMode('publish')}
                                className="w-4 h-4"
                            />
                            <span className="text-sm">No (Published Based)</span>
                        </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        &quot;Yes&quot; syncs stock status based on inventory quantity.
                        &quot;No&quot; syncs based on whether the product is published.
                    </p>
                    <Button onClick={saveStockSyncMode} disabled={isSavingMode} size="sm">
                        {isSavingMode ? 'Saving...' : 'Save'}
                    </Button>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>WooCommerce Stores</CardTitle>
                        <CardDescription>
                            A list of all connected WooCommerce stores.
                        </CardDescription>
                    </div>
                    <div className="flex gap-2">
                        <Button variant="outline" asChild>
                            <Link href="/dashboard/webhook-failures">Webhook Failures</Link>
                        </Button>
                        <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
                            <DialogTrigger asChild>
                                <Button>
                                    <PlusCircle className="mr-2 h-4 w-4" />
                                    Add New Integration
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
                                <DialogHeader className="px-6 py-4 border-b">
                                    <DialogTitle>Add WooCommerce Integration</DialogTitle>
                                    <DialogDescription>
                                        Enter the details for your new WooCommerce store.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 p-6 flex-1 overflow-y-auto custom-scrollbar">
                                    <div className="space-y-2">
                                        <Label htmlFor="business">Business</Label>
                                        <Select value={formState.businessId} onValueChange={(v) => setFormState(prev => ({ ...prev, businessId: v }))}>
                                            <SelectTrigger id="business">
                                                <SelectValue placeholder="Select a business" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {businesses.map(b => (
                                                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="store-name">Store Name</Label>
                                        <Input id="store-name" placeholder="My Awesome Store" value={formState.storeName} onChange={(e) => setFormState(prev => ({ ...prev, storeName: e.target.value }))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="store-url">Store URL</Label>
                                        <Input
                                            id="store-url"
                                            placeholder="https://example.com"
                                            value={formState.storeUrl}
                                            onChange={(e) => setFormState(prev => ({ ...prev, storeUrl: e.target.value }))}
                                            className={isDuplicateUrl ? 'border-destructive' : ''}
                                        />
                                        {isDuplicateUrl && (
                                            <p className="text-xs text-destructive font-medium">
                                                This store URL is already integrated.
                                            </p>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="consumer-key">Consumer Key</Label>
                                        <Input id="consumer-key" placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxx" value={formState.consumerKey} onChange={(e) => setFormState(prev => ({ ...prev, consumerKey: e.target.value }))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="consumer-secret">Consumer Secret</Label>
                                        <Input id="consumer-secret" type="password" placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxx" value={formState.consumerSecret} onChange={(e) => setFormState(prev => ({ ...prev, consumerSecret: e.target.value }))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="webhook-url">Webhook URL (delivery URL)</Label>
                                        <div className="flex gap-2">
                                            <Input
                                                id="webhook-url"
                                                readOnly
                                                value={editingId && typeof window !== 'undefined'
                                                    ? `${window.location.origin}/api/webhooks/woo/${editingId}`
                                                    : 'Save integration first to generate URL'}
                                                className="bg-muted text-muted-foreground"
                                            />
                                            {editingId && typeof window !== 'undefined' && (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="icon"
                                                    title="Copy URL"
                                                    onClick={() => {
                                                        const url = `${window.location.origin}/api/webhooks/woo/${editingId}`;
                                                        navigator.clipboard.writeText(url);
                                                        const btn = document.activeElement as HTMLElement; // Simple feedback hack
                                                        if (btn) btn.style.color = 'green';
                                                    }}
                                                >
                                                    <Copy className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            This is the Delivery URL you should use in WooCommerce if setting up manually.
                                        </p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="webhook-secret">Webhook Secret (optional)</Label>
                                        <Input id="webhook-secret" placeholder="WooFashionary" value={formState.webhookSecret || ''} onChange={(e) => setFormState(prev => ({ ...prev, webhookSecret: e.target.value }))} />
                                        <p className="text-xs text-muted-foreground">Use the same secret when configuring the report webhook.</p>
                                    </div>

                                    <Separator className="my-4" />
                                    <h3 className="text-sm font-medium">Checkout Recovery & Plugin Settings</h3>

                                    <div className="flex items-center space-x-2 mt-4">
                                        <input
                                            type="checkbox"
                                            id="incompleteEnabled"
                                            checked={!!(formState as any).incompleteEnabled}
                                            onChange={(e) => setFormState(prev => ({ ...prev, incompleteEnabled: e.target.checked } as any))}
                                            className="h-4 w-4 rounded border-gray-300"
                                        />
                                        <Label htmlFor="incompleteEnabled">Enable Incomplete Order Capture</Label>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>API Key (for Plugin)</Label>
                                        <div className="flex gap-2">
                                            <Input readOnly value={(formState as any).apiKey || ''} placeholder="Generate key..." className="font-mono text-xs" />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => {
                                                    // Simple key gen
                                                    const key = 'sk_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                                                    setFormState(prev => ({ ...prev, apiKey: key } as any));
                                                }}
                                            >
                                                Generate
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="dedupeMinutes" className="text-xs">Dedupe (Min)</Label>
                                            <Input type="number" id="dedupeMinutes" value={(formState as any).dedupeMinutes ?? 10} onChange={(e) => setFormState(prev => ({ ...prev, dedupeMinutes: parseInt(e.target.value) || 10 } as any))} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="debounceMs" className="text-xs">Debounce (ms)</Label>
                                            <Input type="number" id="debounceMs" value={(formState as any).debounceMs ?? 1200} onChange={(e) => setFormState(prev => ({ ...prev, debounceMs: parseInt(e.target.value) || 1200 } as any))} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="retrySeconds" className="text-xs">Retry (Sec)</Label>
                                            <Input type="number" id="retrySeconds" value={(formState as any).retrySeconds ?? 15} onChange={(e) => setFormState(prev => ({ ...prev, retrySeconds: parseInt(e.target.value) || 15 } as any))} />
                                        </div>
                                    </div>

                                    <Separator className="my-4" />
                                    <h3 className="text-sm font-medium">Order Restrictions</h3>

                                    <div className="flex items-center space-x-2">
                                        <input
                                            type="checkbox"
                                            id="restrictionEnabled"
                                            checked={!!(formState as any).restrictionEnabled}
                                            onChange={(e) => setFormState(prev => ({ ...prev, restrictionEnabled: e.target.checked } as any))}
                                            className="h-4 w-4 rounded border-gray-300"
                                        />
                                        <Label htmlFor="restrictionEnabled">Enable Phone/IP Restrictions</Label>
                                    </div>

                                    {(formState as any).restrictionEnabled && (
                                        <>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Scope</Label>
                                                    <Select value={(formState as any).restrictionScope || 'site'} onValueChange={(v) => setFormState(prev => ({ ...prev, restrictionScope: v } as any))}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="site">Site Only</SelectItem>
                                                            <SelectItem value="global">Global (All Integrations)</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Duration Type</Label>
                                                    <Select value={(formState as any).restrictionDurationType || 'days'} onValueChange={(v) => setFormState(prev => ({ ...prev, restrictionDurationType: v } as any))}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="days">Days</SelectItem>
                                                            <SelectItem value="hours">Hours</SelectItem>
                                                            <SelectItem value="always">Always</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <Label htmlFor="restrictionDurationValue">Duration Value</Label>
                                                <Input type="number" id="restrictionDurationValue" value={(formState as any).restrictionDurationValue ?? 1} onChange={(e) => setFormState(prev => ({ ...prev, restrictionDurationValue: parseInt(e.target.value) || 1 } as any))} />
                                            </div>

                                            <div className="space-y-2">
                                                <Label htmlFor="restrictionMessage">Blocked Message</Label>
                                                <Input id="restrictionMessage" placeholder="You are not allowed to place orders." value={(formState as any).restrictionMessage || ''} onChange={(e) => setFormState(prev => ({ ...prev, restrictionMessage: e.target.value } as any))} />
                                            </div>

                                            <div className="space-y-2">
                                                <Label htmlFor="restrictionSupportPhone">Support Phone (Override)</Label>
                                                <Input id="restrictionSupportPhone" placeholder="+8801xxxxxxxxx" value={(formState as any).restrictionSupportPhone || ''} onChange={(e) => setFormState(prev => ({ ...prev, restrictionSupportPhone: e.target.value } as any))} />
                                            </div>
                                        </>
                                    )}
                                </div>
                                <DialogFooter className="px-6 py-4 border-t bg-muted/40 shrink-0">
                                    <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                                    <Button
                                        onClick={() => {
                                            if (isDuplicateUrl) return;
                                            startSaving(async () => {
                                                const payload = { ...formState };
                                                const result = editingId
                                                    ? await updateWooIntegration({ ...(payload as any), id: editingId })
                                                    : await createWooIntegration(payload as any);
                                                if (result.success) {
                                                    const refreshed = await getWooCommerceIntegrations();
                                                    setIntegrations(refreshed);
                                                    handleDialogOpenChange(false);
                                                    setFormState({ businessId: '', storeName: '', storeUrl: '', consumerKey: '', consumerSecret: '', webhookUrl: '', webhookSecret: '' });
                                                    toast({ title: editingId ? 'Updated' : 'Created', description: 'Integration saved successfully.' });
                                                } else {
                                                    toast({ variant: 'destructive', title: 'Error', description: result.message || 'Failed to save integration' });
                                                }
                                            });
                                        }}
                                        disabled={isSaving || isDuplicateUrl}
                                    >
                                        {isSaving ? 'Saving…' : editingId ? 'Update Integration' : 'Save Integration'}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                </CardHeader>
                <CardContent>
                    {isClient ? (
                        <>
                            <div className="hidden sm:block">{renderTable()}</div>
                            <div className="sm:hidden">{renderCardList()}</div>
                        </>
                    ) : (
                        <div className="h-48 flex items-center justify-center text-muted-foreground">Loading integrations...</div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={isSyncDialogOpen} onOpenChange={setIsSyncDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Sync WooCommerce Orders</DialogTitle>
                        <DialogDescription>
                            Import processing orders from <strong>{syncTarget?.storeName}</strong>.
                        </DialogDescription>
                    </DialogHeader>
                    {!isSyncing ? (
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="sync-days">Sync Window (Days)</Label>
                                <Input
                                    id="sync-days"
                                    type="number"
                                    min={1}
                                    max={365}
                                    value={syncDays}
                                    onChange={(e) => setSyncDays(parseInt(e.target.value) || 3)}
                                />
                                <p className="text-xs text-muted-foreground">Orders created in the last {syncDays} days will be checked.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6 py-8 text-center">
                            <div className="flex flex-col items-center gap-4">
                                <Progress value={syncProgress} className="w-full h-2" />
                                <p className="text-sm font-medium animate-pulse text-primary">
                                    {syncProgress < 10
                                        ? 'Starting sync...'
                                        : syncProgress < 95
                                        ? `Processing orders... ${syncProgress}%`
                                        : 'Finalizing sync...'
                                    }
                                </p>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        {!isSyncing ? (
                            <>
                                <Button variant="outline" onClick={() => setIsSyncDialogOpen(false)}>Cancel</Button>
                                <Button
                                    onClick={async () => {
                                        if (!syncTarget) return;
                                        setIsSyncing(true);
                                        setSyncProgress(5);

                                        // Chunked sync: process one page (100 orders) per request
                                        // to avoid HTTP timeouts on large stores (300-400+ orders).
                                        const cumulativeStats = {
                                            fetched: 0,
                                            imported: 0,
                                            skipped: 0,
                                            failed: 0,
                                            queued: 0,
                                            failedIds: [] as string[],
                                        };

                                        try {
                                            let currentPage = 1;
                                            let totalPages: number | null = null;

                                            // eslint-disable-next-line no-constant-condition
                                            while (true) {
                                                const res = await fetch('/api/orders/import/woo', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({
                                                        integrationId: syncTarget.id,
                                                        days: syncDays,
                                                        status: 'processing',
                                                        forceInline: true,
                                                        page: currentPage,
                                                    }),
                                                });

                                                if (!res.ok) {
                                                    const txt = await res.text();
                                                    setIsSyncing(false);
                                                    toast({ variant: 'destructive', title: 'Sync Failed', description: txt });
                                                    return;
                                                }

                                                const payload = await res.json();
                                                const data = payload?.data || payload;

                                                // Accumulate stats
                                                cumulativeStats.fetched += data.fetched || 0;
                                                cumulativeStats.imported += data.imported || 0;
                                                cumulativeStats.skipped += data.skipped || 0;
                                                cumulativeStats.failed += data.failed || 0;
                                                cumulativeStats.queued += data.queued || 0;
                                                if (Array.isArray(data.failedIds)) {
                                                    cumulativeStats.failedIds.push(...data.failedIds);
                                                }

                                                // Update progress using real page metadata
                                                if (data.totalPages && data.totalPages > 0) {
                                                    totalPages = data.totalPages;
                                                }
                                                const progressPct = totalPages
                                                    ? Math.min(95, Math.round((currentPage / totalPages) * 95))
                                                    : Math.min(95, currentPage * 20);
                                                setSyncProgress(progressPct);

                                                // Stop if no more pages
                                                if (!data.hasMore) break;
                                                currentPage += 1;
                                            }

                                            setSyncProgress(100);
                                            setTimeout(() => {
                                                setIsSyncing(false);
                                                setIsSyncDialogOpen(false);
                                                getWooCommerceIntegrations().then(setIntegrations);
                                                const { fetched, imported, skipped, failed, queued, failedIds } = cumulativeStats;
                                                const failedSnippet = failedIds.length > 0 ? ` Failed IDs: ${failedIds.slice(0, 3).join(', ')}` : '';
                                                toast({
                                                    title: 'Sync Complete',
                                                    description: `Scanned ${fetched}. Imported ${imported}, Skipped ${skipped}, Failed ${failed}, Queued ${queued}.${failedSnippet}`
                                                });
                                            }, 500);

                                        } catch (err) {
                                            setIsSyncing(false);
                                            toast({ variant: 'destructive', title: 'Error', description: 'An error occurred during sync.' });
                                        }
                                    }}
                                >
                                    Start Sync
                                </Button>
                            </>
                        ) : (
                            <Button disabled variant="secondary" className="w-full">Sync in Progress...</Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}



