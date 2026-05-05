
'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ChevronLeft,
  Mail,
  Phone,
  MapPin,
  MoreVertical,
  ShoppingCart,
  DollarSign,
  Calendar,
  Ban,
  CircleCheck,
  Globe,
  Monitor,
  ShieldCheck,
  Package,
  PackageCheck,
  RotateCcw,
  TrendingUp,
  Award
} from 'lucide-react';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { getCustomerById } from '@/services/customers';
import { getOrdersByCustomerPhone, getOrderById } from '@/services/orders';
import type { Customer, Order, OrderStatus } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { defaultBadgeRules, getBadgeForValue, normalizeBadgeRules } from '@/lib/badges';
import { useToast } from '@/hooks/use-toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getWooCommerceIntegrations } from '@/services/integrations';
import type { WooCommerceIntegration } from '@/types';

const statusColors: Record<string, string> = {
  // Identifiers
  'New': 'bg-blue-500/20 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  'Confirmed': 'bg-sky-500/20 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',
    'Confirmed Waiting': 'bg-teal-500/20 text-teal-700',
  'Canceled': 'bg-red-500/20 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  'Hold': 'bg-yellow-500/20 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400',
  'In_Courier': 'bg-orange-500/20 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
  'RTS__Ready_to_Ship_': 'bg-purple-500/20 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
  'Shipped': 'bg-cyan-500/20 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400',
  'Delivered': 'bg-green-500/20 text-green-700 dark:bg-green-500/10 dark:text-green-400',
  'Returned': 'bg-gray-500/20 text-gray-700 dark:bg-gray-500/10 dark:text-gray-400',
  'Paid_Return': 'bg-gray-500/20 text-gray-700 dark:bg-gray-500/10 dark:text-gray-400',
  'Paid Return': 'bg-gray-500/20 text-gray-700 dark:bg-gray-500/10 dark:text-gray-400',
  'Packing_Hold': 'bg-amber-500/20 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  'Return_Pending': 'bg-pink-500/20 text-pink-700 dark:bg-pink-500/10 dark:text-pink-400',
  'Partial': 'bg-fuchsia-500/20 text-fuchsia-700 dark:bg-fuchsia-500/10 dark:text-fuchsia-400',
  'Incomplete': 'bg-gray-500/20 text-gray-700 dark:bg-gray-500/10 dark:text-gray-400',
  'Incomplete_Cancelled': 'bg-red-500/20 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  'Draft': 'bg-zinc-500/20 text-zinc-700 dark:bg-zinc-500/10 dark:text-zinc-400',
  'Damaged': 'bg-rose-500/20 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
  // Labels (Backward Compatibility)
  'In-Courier': 'bg-orange-500/20 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
  'RTS (Ready to Ship)': 'bg-purple-500/20 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
  'Packing Hold': 'bg-amber-500/20 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  'Return Pending': 'bg-pink-500/20 text-pink-700 dark:bg-pink-500/10 dark:text-pink-400',
  'Incomplete-Cancelled': 'bg-red-500/20 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  'No_Response': 'bg-orange-400/20 text-orange-700 dark:bg-orange-400/10 dark:text-orange-400',
  'No Response': 'bg-orange-400/20 text-orange-700 dark:bg-orange-400/10 dark:text-orange-400',
};


export default function CustomerDetailsPage() {
  const params = useParams();
  const customerId = params.id as string;
  const { toast } = useToast();

  const [customer, setCustomer] = React.useState<Customer | undefined>(undefined);
  const [customerOrders, setCustomerOrders] = React.useState<Order[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [phoneBlocked, setPhoneBlocked] = React.useState<boolean>(false);
  const [blockScope, setBlockScope] = React.useState<'SITE' | 'GLOBAL'>('GLOBAL');
  const [lastOrderIp, setLastOrderIp] = React.useState<string | null>(null);
  const [ipBlocked, setIpBlocked] = React.useState(false);
  const [isCheckingRestrictions, setIsCheckingRestrictions] = React.useState(false);

  // P47bz: Explicit site selection state
  const [integrations, setIntegrations] = React.useState<WooCommerceIntegration[]>([]);
  const [selectedIntegrationId, setSelectedIntegrationId] = React.useState<string | undefined>(undefined);

  // Fetch integrations for label enrichment
  React.useEffect(() => {
    getWooCommerceIntegrations().then(setIntegrations).catch(console.error);
  }, []);

  // Derive available sites from customer orders
  const siteOptions = React.useMemo(() => {
    const options = new Map<string, string>();
    customerOrders.forEach(order => {
      if (order.integrationId) {
        // Try to find matching integration for name
        const integration = integrations.find(i => i.id === order.integrationId);
        let label = integration?.storeName || integration?.storeUrl || `Integration ${order.integrationId.substring(0, 8)}`;

        // Fallback to order metadata if available
        if (!integration && (order as any).businessName) {
          label = `${(order as any).businessName} • ${(order as any).platform || 'Web'}`;
        }

        options.set(order.integrationId, label);
      }
    });
    return Array.from(options.entries()).map(([id, label]) => ({ id, label }));
  }, [customerOrders, integrations]);

  const checkRestriction = React.useCallback(async (value: string, type: 'PHONE' | 'IP', integrationId?: string) => {
    setIsCheckingRestrictions(true);
    try {
      const query = new URLSearchParams({ targetType: type, targetValue: value });
      if (integrationId && type === 'PHONE') query.append('integrationId', integrationId);
      const res = await fetch(`/api/restrictions?${query.toString()}`);
      const data = await res.json();
      if (type === 'PHONE') setPhoneBlocked(data.length > 0);
      else if (type === 'IP') setIpBlocked(data.length > 0);
    } catch (e) {
      console.error('Error checking restriction:', e);
    } finally {
      setIsCheckingRestrictions(false);
    }
  }, []);

  React.useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const c = await getCustomerById(customerId);
        if (!c) throw new Error('Customer not found');
        setCustomer(c);

        const orders = await getOrdersByCustomerPhone(c.phone);
        setCustomerOrders(orders);

        // P47bz: Use unscoped check for customer-level badge/status
        checkRestriction(c.phone, 'PHONE');

        if (c.ip) {
          setLastOrderIp(c.ip);
          checkRestriction(c.ip, 'IP');
        } else if (orders[0]) {
          const fullOrder = await getOrderById(orders[0].id);
          const ip = fullOrder?.rawPayload?.customer_ip_address;
          if (ip) {
            setLastOrderIp(ip);
            checkRestriction(ip, 'IP');
          }
        }
      } catch (e: any) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: e.message || 'Failed to load customer data'
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [customerId, toast, checkRestriction]);

  const { data: generalSettings } = useSWR('/api/settings/general', (url) => fetch(url).then(r => r.json()));
  const badgeRules = React.useMemo(() => normalizeBadgeRules(generalSettings?.badgeRules, defaultBadgeRules), [generalSettings]);
  const customerBadge = React.useMemo(() => getBadgeForValue(badgeRules.customerOrders, customerOrders.length), [badgeRules, customerOrders.length]);

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6 lg:p-8">
        <Skeleton className="h-12 w-3/4" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <p className="text-lg text-muted-foreground">Customer not found</p>
        <Button asChild>
          <Link href="/dashboard/customers">Back to Customers</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center gap-2 md:gap-4">
        <Button variant="outline" size="icon" className="h-8 w-8 md:h-9 md:w-9" asChild>
          <Link href="/dashboard/customers">
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Back</span>
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight truncate">{customer.name}</h1>
            {customerBadge && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <Award className="h-3 w-3" />
                {customerBadge.label}
              </Badge>
            )}
          </div>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Joined on {customer.createdAt && !isNaN(new Date(customer.createdAt).getTime())
              ? format(new Date(customer.createdAt), "MMMM d, yyyy")
              : "Unknown date"}
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Contact Info Card */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">Customer Profile</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <div className="flex items-start gap-3">
              <Mail className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <a href={`mailto:${customer.email}`} className="text-xs lg:text-sm text-primary hover:underline break-all">
                {customer.email}
              </a>
            </div>
            <div className="flex items-start gap-3">
              <Phone className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <a href={`tel:${customer.phone}`} className="text-xs lg:text-sm text-primary hover:underline font-medium">
                    {customer.phone}
                  </a>
                  {phoneBlocked ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 px-1.5 text-[10px] text-green-600 hover:text-green-700 hover:bg-green-50"
                      onClick={async () => {
                        try {
                          // New logic: Delete ALL restrictions for this phone (GLOBAL + SITE)
                          const query = new URLSearchParams({
                            targetType: 'PHONE',
                            targetValue: customer.phone,
                            allScopes: 'true'
                          });

                          const delRes = await fetch(`/api/restrictions?${query.toString()}`, { method: 'DELETE' });
                          const data = await delRes.json();

                          if (delRes.ok) {
                            if (data.deletedCount > 0) {
                              toast({
                                title: 'Phone Unblocked',
                                description: `Removed ${data.deletedCount} restriction(s).`
                              });
                            } else {
                              toast({
                                title: 'Already Unblocked',
                                description: 'No active restrictions found for this phone.',
                              });
                            }

                            // CRITICAL: Re-verify state from server to ensure UI is in sync
                            // P47ca: Use unscoped check for customer-level status
                            await checkRestriction(customer.phone, 'PHONE');
                          } else {
                            throw new Error(data.error || 'Failed to unblock');
                          }
                        } catch (e: any) {
                          toast({
                            variant: 'destructive',
                            title: 'Error unblocking phone',
                            description: e.message || 'Could not complete unblock request'
                          });
                        }
                      }}
                    >
                      <CircleCheck className="w-2.5 h-2.5 mr-1" /> Unblock
                    </Button>
                  ) : (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10">
                          <Ban className="w-2.5 h-2.5 mr-1" /> Block
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Block Phone Number?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will block <strong>{customer.phone}</strong> from placing future orders.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="py-4 space-y-4">
                          <div className="flex flex-col gap-3">
                            <label className="text-sm font-medium">Block Scope</label>
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                variant={blockScope === 'GLOBAL' ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setBlockScope('GLOBAL')}
                                className="flex items-center gap-2"
                              >
                                <Globe className="w-4 h-4" /> Global
                              </Button>
                              <Button
                                variant={blockScope === 'SITE' ? 'default' : 'outline'}
                                size="sm"
                                disabled={siteOptions.length === 0}
                                onClick={() => {
                                  setBlockScope('SITE');
                                  // Auto-select if only one option
                                  if (siteOptions.length === 1) setSelectedIntegrationId(siteOptions[0].id);
                                }}
                                className="flex items-center gap-2"
                              >
                                <Monitor className="w-4 h-4" /> Specific Site
                              </Button>
                            </div>

                            {blockScope === 'GLOBAL' && (
                              <p className="text-xs text-muted-foreground">
                                Blocks this phone number across <strong>all</strong> connected stores.
                              </p>
                            )}

                            {blockScope === 'SITE' && (
                              <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                <label className="text-xs font-medium text-muted-foreground">Select Site to Block</label>
                                <Select
                                  value={selectedIntegrationId}
                                  onValueChange={setSelectedIntegrationId}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Choose a site..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {siteOptions.map(opt => (
                                      <SelectItem key={opt.id} value={opt.id}>
                                        {opt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                  Blocks only for the selected store.
                                </p>
                              </div>
                            )}

                            {siteOptions.length === 0 && (
                              <p className="text-xs text-amber-600 flex items-center gap-1">
                                <Ban className="w-3 h-3" /> No sites found from customer orders.
                              </p>
                            )}
                          </div>
                        </div>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            disabled={blockScope === 'SITE' && (!selectedIntegrationId || !integrations.find(i => i.id === selectedIntegrationId))}
                            onClick={async () => {
                              try {
                                // P47cb: Deriving context strictly from selected integration
                                let finalIntegrationId: string | null = null;
                                let finalBusinessId: string | null = null;

                                if (blockScope === 'SITE') {
                                  const selectedIntegration = integrations.find(i => i.id === selectedIntegrationId);
                                  if (!selectedIntegration) {
                                    toast({ variant: 'destructive', title: 'Error', description: 'Selected site metadata not found. Please reload.' });
                                    return;
                                  }
                                  if (!selectedIntegration.businessId) {
                                    toast({ variant: 'destructive', title: 'Error', description: 'Selected site has no business mapping.' });
                                    return;
                                  }
                                  finalIntegrationId = selectedIntegration.id;
                                  finalBusinessId = selectedIntegration.businessId;
                                } else {
                                  // For GLOBAL, we don't bind to a specific business in this flow
                                  finalIntegrationId = null;
                                  finalBusinessId = null;
                                }

                                const res = await fetch('/api/restrictions', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    targetType: 'PHONE',
                                    targetValue: customer.phone,
                                    message: `Manual block from customer page ${customer.id}`,
                                    durationDays: 3650,
                                    scope: blockScope,
                                    integrationId: finalIntegrationId,
                                    businessId: finalBusinessId
                                  })
                                });
                                if (!res.ok) throw new Error('Failed to block phone');

                                const siteLabel = siteOptions.find(o => o.id === finalIntegrationId)?.label || 'selected site';
                                toast({
                                  title: 'Phone Blocked',
                                  description: blockScope === 'GLOBAL'
                                    ? 'Phone number blocked globally.'
                                    : `Phone number blocked for ${siteLabel}.`
                                });
                                setPhoneBlocked(true);
                              } catch (e) {
                                toast({ variant: 'destructive', title: 'Error', description: 'Could not block phone.' });
                              }
                            }} className="bg-destructive hover:bg-destructive/90">
                            Confirm Block
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Globe className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Network Protection</span>
                  {lastOrderIp && (
                    ipBlocked ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[10px] text-green-600 hover:text-green-700"
                        onClick={async () => {
                          try {
                            const res = await fetch(`/api/restrictions?targetType=IP&targetValue=${encodeURIComponent(lastOrderIp)}`, { method: 'GET' });
                            const data = await res.json();
                            if (data && data[0]?.targetHash) {
                              const delRes = await fetch(`/api/restrictions?targetHash=${data[0].targetHash}&scope=GLOBAL`, { method: 'DELETE' });
                              if (delRes.ok) {
                                toast({ title: 'Connection Unblocked' });
                                setIpBlocked(false);
                              }
                            }
                          } catch (e) {
                            toast({ variant: 'destructive', title: 'Error unblocking protection' });
                          }
                        }}
                      >
                        Unblock IP
                      </Button>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-destructive hover:bg-destructive/10">
                            Block IP
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Block this connection?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will prevent future orders from <strong>{lastOrderIp}</strong>.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={async () => {
                              try {
                                const res = await fetch('/api/restrictions', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    targetType: 'IP',
                                    targetValue: lastOrderIp,
                                    durationDays: 3650,
                                    scope: 'GLOBAL',
                                    integrationId: null,
                                    businessId: customerOrders[0]?.businessId || null
                                  })
                                });
                                if (!res.ok) throw new Error('Failed to block connection');
                                toast({ title: 'Connection Blocked' });
                                setIpBlocked(true);
                              } catch (e) {
                                toast({ variant: 'destructive', title: 'Error' });
                              }
                            }} className="bg-destructive hover:bg-destructive/90">
                              Block IP
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )
                  )}
                </div>
                {lastOrderIp ? (
                  <p className="text-[10px] font-mono text-muted-foreground truncate">{lastOrderIp}</p>
                ) : (
                  <p className="text-[10px] text-muted-foreground">Not available</p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <address className="not-italic text-xs text-muted-foreground leading-relaxed">
                {customer.address}, {customer.district}, {customer.country}
              </address>
            </div>
          </CardContent>
        </Card>

        {/* Order Stats Card */}
        <Card className="hover:shadow-md transition-shadow border-l-4 border-l-blue-500 bg-gradient-to-br from-blue-50/50 to-white dark:from-blue-950/10 dark:to-background">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-blue-700 dark:text-blue-400">Order Activity</CardTitle>
            <div className="p-1.5 bg-blue-100 dark:bg-blue-900/40 rounded-md">
              <ShoppingCart className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-baseline gap-2">
              <p className="text-3xl font-bold tracking-tight text-blue-900 dark:text-blue-100">{customerOrders.length}</p>
              <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Total Orders</span>
            </div>
            <Separator className="my-4 bg-blue-200 dark:bg-blue-800/40" />
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="space-y-1">
                <p className="text-sm font-bold text-green-600 dark:text-green-400">{customerOrders.filter(o => o.status === 'Delivered').length}</p>
                <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1 uppercase tracking-tight">
                  <PackageCheck className="w-2.5 h-2.5" /> Delivered
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-red-600 dark:text-red-400">{customerOrders.filter(o => o.status === 'Canceled' || o.status === 'Incomplete-Cancelled').length}</p>
                <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1 uppercase tracking-tight">
                  <Ban className="w-2.5 h-2.5" /> Canceled
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-orange-600 dark:text-orange-400">{customerOrders.filter(o => o.status === 'Returned' || o.status === 'Paid_Return' || (o.status as any) === 'Paid Return').length}</p>
                <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-1 uppercase tracking-tight">
                  <RotateCcw className="w-2.5 h-2.5" /> Returned
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Financials Card */}
        <Card className="hover:shadow-md transition-shadow border-l-4 border-l-emerald-500 bg-gradient-to-br from-emerald-50/50 to-white dark:from-emerald-950/10 dark:to-background">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Financial Insights</CardTitle>
            <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/40 rounded-md">
              <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex flex-col gap-1">
              <p className="text-2xl font-bold tracking-tight text-emerald-900 dark:text-emerald-100 font-mono">
                Tk {customerOrders.reduce((sum, o) => sum + o.total, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium tracking-wide">Lifetime Spent</span>
            </div>
            <Separator className="my-4 bg-emerald-200 dark:bg-emerald-800/40" />
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-[10px] text-muted-foreground uppercase tracking-tight">Average Value</span>
                <p className="text-sm font-bold font-mono">
                  Tk {customerOrders.length > 0
                    ? (customerOrders.reduce((sum, o) => sum + o.total, 0) / customerOrders.length).toLocaleString(undefined, { minimumFractionDigits: 2 })
                    : '0.00'}
                </p>
              </div>
              <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-full">
                <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Order History Card */}
      <Card className="hover:shadow-md transition-shadow">
        <CardHeader>
          <CardTitle>Order History</CardTitle>
          <CardDescription>
            A complete list of all orders placed by this customer
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Desktop Table */}
          <div className="hidden md:block">
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-semibold">Order Number</TableHead>
                    <TableHead className="font-semibold">Date</TableHead>
                    <TableHead className="font-semibold">Status</TableHead>
                    <TableHead className="text-right font-semibold">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customerOrders.map((order) => (
                    <TableRow key={order.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-medium">
                        <Link href={`/dashboard/orders/${order.id}`} className="text-primary hover:underline inline-flex items-center gap-1 font-mono">
                          {order.orderNumber || order.id}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {order.date && !isNaN(new Date(order.date).getTime())
                          ? format(new Date(order.date), "MMM d, yyyy")
                          : "N/A"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={'outline'} className={cn('font-medium', statusColors[order.status as OrderStatus] || 'bg-gray-500/20 text-gray-700')}>
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">Tk {order.total.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {customerOrders.map((order) => (
              <Card key={order.id} className="hover:shadow-md transition-shadow border-l-4 border-l-primary/30">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0">
                      <Link href={`/dashboard/orders/${order.id}`} className="font-semibold text-primary hover:underline block truncate font-mono text-sm">
                        {order.orderNumber || order.id}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-1">
                        {order.date && !isNaN(new Date(order.date).getTime())
                          ? format(new Date(order.date), "MMM d, yyyy")
                          : "N/A"}
                      </p>
                    </div>
                    <Badge variant={'outline'} className={cn('text-xs font-medium ml-2 flex-shrink-0', statusColors[order.status as OrderStatus] || 'bg-gray-500/20 text-gray-700')}>
                      {order.status}
                    </Badge>
                  </div>
                  <Separator className="my-3" />
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Order Total</span>
                    <p className="font-bold font-mono text-base">Tk {order.total.toFixed(2)}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {customerOrders.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Package className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground font-medium">No orders found</p>
              <p className="text-sm text-muted-foreground/70 mt-1">This customer hasn&apos;t placed any orders yet</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
