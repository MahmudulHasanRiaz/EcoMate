'use client';

import * as React from 'react';
import {
  FileWarning,
  Trash2,
  Eye,
  Wand2,
  RefreshCw,
  ShoppingBag,
  RotateCw,
  Users,
  CheckCircle2,
  XCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { Checkbox } from '@/components/ui/checkbox';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
  PaginationLink,
} from '@/components/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getIncompleteOrders,
  IncompleteLead,
  getIncompleteLead,
  IncompleteLeadDetail,
  resolveIncompleteSkus,
  markIncompleteLeadConverted,
  updateIncompleteLeadAssignee,
} from '@/services/orders';
import { getBusinesses } from '@/services/partners';
import { getStaff, getAssignableStaff } from '@/services/staff';
import { StaffCombobox } from '@/components/orders/staff-combobox';
import { NewOrderDialog } from '@/components/orders/new-order-dialog';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { normalizeBdPhoneForStorage } from '@/lib/phone';
import type { Permission, StaffMember } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { usePermissions } from '@/hooks/use-permissions';
import { resolveImageSrc } from '@/lib/image';
import useSWR from 'swr';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ITEMS_PER_PAGE = 10;

export default function IncompleteOrdersPage() {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [debouncedSearch, setDebouncedSearch] = React.useState('');
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [selectedLeadId, setSelectedLeadId] = React.useState<string | null>(null);
  const [leadDetail, setLeadDetail] = React.useState<IncompleteLeadDetail | null>(null);
  const [resolvedLeadItems, setResolvedLeadItems] = React.useState<any[]>([]);
  const [isDetailOpen, setIsDetailOpen] = React.useState(false);
  const [isDetailLoading, setIsDetailLoading] = React.useState(false);
  const [isConverting, setIsConverting] = React.useState(false);
  const [selectedLeads, setSelectedLeads] = React.useState<string[]>([]);
  const [isBulkActing, setIsBulkActing] = React.useState(false);
  const { toast } = useToast();

  const [isConvertDialogOpen, setIsConvertDialogOpen] = React.useState(false);
  const [convertLead, setConvertLead] = React.useState<IncompleteLeadDetail | null>(null);
  const [convertPrefillItems, setConvertPrefillItems] = React.useState<any[]>([]);
  const [isPreparingConvert, setIsPreparingConvert] = React.useState(false);

  const permissions = usePermissions();
  const [businessFilter, setBusinessFilter] = React.useState('all');
  const [assigneeFilter, setAssigneeFilter] = React.useState('all');

  const { data: businessesData } = useSWR('businesses', getBusinesses, { revalidateOnFocus: false });
  const allBusinesses = businessesData || [];

  const { data: staffData } = useSWR('staff-incomplete', async () => {
    const results = await Promise.allSettled([
      getStaff({ pageSize: 200 }),
      getAssignableStaff()
    ]);

    const merged = new Map<string, any>();

    results.forEach(res => {
      if (res.status === 'fulfilled') {
        const items = Array.isArray(res.value) ? res.value : (res.value as any)?.items || [];
        items.forEach((item: any) => {
          if (item?.id && !merged.has(item.id)) {
            merged.set(item.id, item);
          }
        });
      }
    });

    const items = Array.from(merged.values());
    return { items, total: items.length };
  }, { revalidateOnFocus: false });
  const allStaff = (staffData as any)?.items || [];

  const deriveLeadName = (lead: IncompleteLead | IncompleteLeadDetail) => {
    const name = String(lead?.name || '').trim();
    if (name) return name;
    const p = (lead as any)?.payload || {};
    const first = String(p?.firstName || '').trim();
    const last = String(p?.lastName || '').trim();
    const full = [first, last].filter(Boolean).join(' ').trim();
    return full || 'Unknown';
  };

  const deriveLeadAddress = (lead: IncompleteLead | IncompleteLeadDetail) => {
    const address = String(lead?.address || '').trim();
    if (address) return address;
    const p = (lead as any)?.payload || {};
    const parts = [
      p?.address1,
      p?.address2,
      p?.city,
      p?.state,
      p?.postcode,
      p?.country,
    ]
      .map((x: any) => String(x || '').trim())
      .filter(Boolean);
    return parts.join(', ');
  };

  const deriveLeadPhone = (lead: IncompleteLead | IncompleteLeadDetail) => {
    const raw = String((lead as any).phone || (lead as any).phoneNormalized || (lead as any)?.payload?.phone || '').trim();
    const meta = normalizeBdPhoneForStorage(raw);
    return meta.isValid ? meta.last11 : (meta.value || raw);
  };

  const canOrders = (action: keyof Permission) => {
    const perms = permissions?.orders;
    if (perms === true) return true;
    if (perms && typeof perms === 'object') {
      return !!perms[action];
    }
    return false;
  };

  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 500);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  const { data: leadsData, isLoading, mutate: refreshLeads } = useSWR(
    ['incomplete-orders', businessFilter, assigneeFilter, debouncedSearch, currentPage, pageSize],
    async () => getIncompleteOrders({
      businessId: businessFilter === 'all' ? undefined : businessFilter,
      assignedToId: assigneeFilter === 'all' ? undefined : assigneeFilter,
      search: debouncedSearch || undefined,
      page: currentPage,
      pageSize,
    }),
    { revalidateOnFocus: false }
  );

  const paginatedOrders = leadsData?.items || [];
  const totalCount = leadsData?.pagination?.total || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const paginatedOrderIds = React.useMemo(() => paginatedOrders.map((o) => o.id), [paginatedOrders]);
  const selectedOnPageCount = React.useMemo(
    () => paginatedOrderIds.filter((id) => selectedLeads.includes(id)).length,
    [paginatedOrderIds, selectedLeads]
  );
  const allPageSelected = paginatedOrderIds.length > 0 && selectedOnPageCount === paginatedOrderIds.length;

  const handleSelectAllOnPage = React.useCallback(() => {
    setSelectedLeads((prev) => {
      const merged = new Set(prev);
      paginatedOrderIds.forEach((id) => merged.add(id));
      return Array.from(merged);
    });
  }, [paginatedOrderIds]);

  const handleClearPageSelection = React.useCallback(() => {
    setSelectedLeads((prev) => prev.filter((id) => !paginatedOrderIds.includes(id)));
  }, [paginatedOrderIds]);

  React.useEffect(() => {
    setCurrentPage(1);
    setSelectedLeads([]);
  }, [debouncedSearch, businessFilter, assigneeFilter, pageSize]);

  const handleCancel = async (leadId: string) => {
    try {
      const res = await fetch(`/api/orders/incomplete/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || json?.error || 'Cancel failed');

      refreshLeads((prev) => prev ? { ...prev, items: prev.items.filter((o) => o.id !== leadId) } : prev, { revalidate: false });
      toast({ title: 'Success', description: 'Lead cancelled' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Failed to cancel lead', variant: 'destructive' });
    }
  };

  const handleNotConverted = async (leadId: string) => {
    try {
      const res = await fetch(`/api/orders/incomplete/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'not_converted' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || json?.error || 'Update failed');

      refreshLeads((prev) => prev ? { ...prev, items: prev.items.filter((o) => o.id !== leadId) } : prev, { revalidate: false });
      setIsConvertDialogOpen(false);
      toast({ title: 'Success', description: 'Marked as Not Converted' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Failed to update lead', variant: 'destructive' });
    }
  };

  const handleAssign = async (leadId: string, staffId: string) => {
    try {
      const targetId = staffId === 'unassigned' ? null : staffId;
      const response = await updateIncompleteLeadAssignee(leadId, targetId);

      refreshLeads((prev) => prev ? {
        ...prev,
        items: prev.items.map((o) => {
          if (o.id === leadId) {
            return {
              ...o,
              assignedToId: response?.assignedTo?.id ?? null,
              assignedTo: response?.assignedTo ?? null
            };
          }
          return o;
        })
      } : prev, { revalidate: false });
      toast({ title: 'Success', description: 'Assignee updated' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Failed to update assignee', variant: 'destructive' });
    }
  };

  const handleBulkAssign = async (staffId: string) => {
    if (selectedLeads.length === 0) return;
    setIsBulkActing(true);
    try {
      const res = await fetch('/api/orders/incomplete/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: selectedLeads, assignedToStaffId: staffId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || json?.error || 'Bulk assignment failed');

      const data = json.data || json;
      const { successCount, errorCount, rejectedIds, targetStaffName } = data;
      const rejectedCount = Array.isArray(rejectedIds) ? rejectedIds.length : 0;

      if (successCount === 0) {
        toast({
          title: 'Bulk Assign Warning',
          description: `No leads were updated. Rejected: ${rejectedCount}, Failed: ${errorCount || 0}`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Bulk Assign Complete',
          description: `Updated: ${successCount}, Rejected: ${rejectedCount}, Failed: ${errorCount || 0}${targetStaffName ? ` (Assigned to: ${targetStaffName})` : ''}`,
          variant: (errorCount > 0 || rejectedCount > 0) ? 'destructive' : 'default',
        });
      }
      await refreshLeads();
    } catch (e: any) {
      toast({ title: 'Bulk Error', description: e?.message || 'Failed to bulk assign', variant: 'destructive' });
    } finally {
      setIsBulkActing(false);
    }
  };

  const handleView = async (leadId: string) => {
    setSelectedLeadId(leadId);
    setIsDetailOpen(true);
    setIsDetailLoading(true);
    setResolvedLeadItems([]);
    try {
      const detail = await getIncompleteLead(leadId);
      setLeadDetail(detail);

      const skuStrings = Array.isArray(detail?.skuList)
        ? detail.skuList.map((s: any) => (typeof s === 'string' ? s : (s?.sku || s?.SKU || ''))).filter(Boolean)
        : [];

      if (skuStrings.length > 0) {
        const resolved = await resolveIncompleteSkus(skuStrings);
        if (resolved?.items) {
          setResolvedLeadItems(resolved.items);
        }
      }
    } catch (e) {
      toast({ title: 'Error', description: 'Failed to load lead details', variant: 'destructive' });
    } finally {
      setIsDetailLoading(false);
    }
  };

  const openConvertModal = async (leadId: string) => {
    setIsPreparingConvert(true);
    try {
      const detail = await getIncompleteLead(leadId);
      if (!detail) throw new Error('Lead not found');

      const skuList = Array.isArray(detail.skuList)
        ? detail.skuList.map((s: any) => (typeof s === 'string' ? s : s?.sku || s?.SKU || '')).filter(Boolean)
        : [];

      const resolved = skuList.length ? await resolveIncompleteSkus(skuList) : { items: [], missing: [] };

      setConvertLead(detail);
      setConvertPrefillItems(Array.isArray(resolved?.items) ? resolved.items : []);
      setIsConvertDialogOpen(true);
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'Failed to prepare conversion', variant: 'destructive' });
    } finally {
      setIsPreparingConvert(false);
    }
  };

  const renderTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[40px]">
            <Checkbox
              checked={allPageSelected}
              onCheckedChange={(c) => {
                if (c) handleSelectAllOnPage();
                else handleClearPageSelection();
              }}
            />
          </TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Assignee</TableHead>
          <TableHead className="text-right">Seen</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          [...Array(5)].map((_, i) => (
            <TableRow key={i}>
              <TableCell colSpan={6}><Skeleton className="h-14 w-full" /></TableCell>
            </TableRow>
          ))
        ) : paginatedOrders.length > 0 ? (
          paginatedOrders.map((order) => {
            const phoneMeta = normalizeBdPhoneForStorage(order.phone || '');
            const phoneDisplay = phoneMeta.isValid ? phoneMeta.last11 : (phoneMeta.value || order.phone || '');
            const displayName = deriveLeadName(order);
            const displayAddress = deriveLeadAddress(order);

            return (
              <TableRow key={order.id} className={cn(selectedLeads.includes(order.id) && "bg-muted/50")}>
                <TableCell>
                  <Checkbox
                    checked={selectedLeads.includes(order.id)}
                    onCheckedChange={(c) => setSelectedLeads((prev) => {
                      if (c) {
                        if (prev.includes(order.id)) return prev;
                        return [...prev, order.id];
                      }
                      return prev.filter(id => id !== order.id);
                    })}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  <p className="font-bold">{displayName}</p>
                  <div className="flex items-center gap-2">
                    <a href={`tel:${phoneMeta.value || order.phone || ''}`} className={cn("text-sm text-blue-600 hover:underline", !phoneMeta.isValid && "text-destructive pointer-events-none")}>
                      {phoneDisplay}
                    </a>
                    {!phoneMeta.isValid && <Badge variant="destructive" className="h-5 px-2">Invalid</Badge>}
                  </div>
                  {displayAddress && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{displayAddress}</p>
                  )}
                  {order.businessName && (
                    <p className="text-xs text-muted-foreground mt-1 italic">{order.businessName}</p>
                  )}
                </TableCell>
                <TableCell>{format(new Date(order.lastSeenAt || order.firstSeenAt || new Date().toISOString()), 'MMM d, yyyy')}</TableCell>
                <TableCell>
                  {canOrders('update') ? (
                    <StaffCombobox
                      staffMembers={allStaff}
                      value={order.assignedToId || 'unassigned'}
                      onChange={(val) => handleAssign(order.id, val)}
                      selectedLabel={order.assignedTo?.name}
                      mode="assign"
                    />
                  ) : (
                    <Badge variant="outline" className="font-normal">
                      {order.assignedTo?.name || 'Unassigned'}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {order.occurrences ? `x${order.occurrences}` : 'x1'}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleView(order.id)}>
                      <Eye className="h-4 w-4" />
                    </Button>

                    {canOrders('create') && (
                      <Button
                        variant="default"
                        size="sm"
                        className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
                        onClick={() => openConvertModal(order.id)}
                        disabled={isPreparingConvert}
                      >
                        <Wand2 className="mr-1 h-4 w-4" />
                        Convert
                      </Button>
                    )}

                    {canOrders('update') && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" className="text-amber-600 border-amber-300 hover:bg-amber-50">
                            Not Converted
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Mark as Not Converted?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will close the lead for analytics without creating an order.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Go Back</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleNotConverted(order.id)}>
                              Confirm
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}

                    {canOrders('update') && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will cancel the incomplete order for <strong>{displayName}</strong>. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Go Back</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleCancel(order.id)}>
                              Confirm Cancel
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        ) : (
          <TableRow>
            <TableCell colSpan={6} className="h-24 text-center">
              No results found.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  const renderCards = () => (
    <div className="flex flex-col gap-4">
      {paginatedOrders.map((order) => {
        const phoneMeta = normalizeBdPhoneForStorage(order.phone || '');
        const phoneDisplay = phoneMeta.isValid ? phoneMeta.last11 : (phoneMeta.value || order.phone || '');

        return (
          <Card key={order.id} className={cn(selectedLeads.includes(order.id) && "ring-2 ring-primary")}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={selectedLeads.includes(order.id)}
                  onCheckedChange={(c) => setSelectedLeads((prev) => {
                    if (c) {
                      if (prev.includes(order.id)) return prev;
                      return [...prev, order.id];
                    }
                    return prev.filter(id => id !== order.id);
                  })}
                  className="mt-1"
                />
                <div className="flex-1">
                  <p className="font-semibold">{deriveLeadName(order)}</p>
                  <div className="flex items-center gap-2">
                    <a href={`tel:${phoneMeta.value || order.phone || ''}`} className={cn("text-sm text-blue-600 hover:underline", !phoneMeta.isValid && "text-destructive pointer-events-none")}>
                      {phoneDisplay}
                    </a>
                    {!phoneMeta.isValid && <Badge variant="destructive" className="h-5 px-2">Invalid</Badge>}
                  </div>
                  {deriveLeadAddress(order) && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{deriveLeadAddress(order)}</p>
                  )}
                  {order.businessName && (
                    <p className="text-xs text-muted-foreground mt-1 italic">{order.businessName}</p>
                  )}
                </div>
              </div>
              <div>
                {canOrders('update') ? (
                  <StaffCombobox
                    staffMembers={allStaff}
                    value={order.assignedToId || 'unassigned'}
                    onChange={(val) => handleAssign(order.id, val)}
                    selectedLabel={order.assignedTo?.name}
                    mode="assign"
                  />
                ) : (
                  <Badge variant="outline" className="font-normal">
                    {order.assignedTo?.name || 'Unassigned'}
                  </Badge>
                )}
              </div>
              <div className="flex justify-between items-center text-sm">
                <p className="text-muted-foreground">{format(new Date(order.lastSeenAt || order.firstSeenAt || new Date().toISOString()), 'MMM d, yyyy')}</p>
                <p className="font-semibold font-mono text-lg">{order.occurrences ? `x${order.occurrences}` : 'x1'}</p>
              </div>
              <Separator />
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => handleView(order.id)}>
                  <Eye className="h-4 w-4 mr-1" />
                  View
                </Button>

                {canOrders('create') && (
                  <Button
                    size="sm"
                    className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
                    onClick={() => openConvertModal(order.id)}
                    disabled={isPreparingConvert}
                  >
                    <Wand2 className="mr-1 h-4 w-4" />
                    Convert
                  </Button>
                )}

                {canOrders('update') && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="text-amber-600 border-amber-300 hover:bg-amber-50">
                        Not Converted
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Mark as Not Converted?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will close the lead for analytics without creating an order.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Go Back</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleNotConverted(order.id)}>
                          Confirm
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
                {canOrders('update') && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Cancel
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will cancel the incomplete order for <strong>{deriveLeadName(order)}</strong>. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Go Back</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleCancel(order.id)}>Confirm Cancel</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex-1">
          <h1 className="font-headline text-2xl sm:text-3xl font-bold tracking-tight">Incomplete Leads</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Manage abandoned carts and convert them to real orders.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Abandoned Cart List</CardTitle>
          <CardDescription>
            These are potential orders from customers who started the checkout process but did not complete it.
          </CardDescription>
          <div className="pt-4 flex flex-col sm:flex-row gap-4">
            <Input
              placeholder="Search by name or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
            />

            <Select value={businessFilter} onValueChange={setBusinessFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Filter by Business" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Businesses</SelectItem>
                {allBusinesses.map((business: any) => (
                  <SelectItem key={business.id} value={business.id}>
                    {business.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <StaffCombobox
              staffMembers={allStaff}
              value={assigneeFilter}
              onChange={setAssigneeFilter}
              mode="filter"
            />
          </div>

          {selectedLeads.length > 0 && (
            <div className="mt-4 p-3 bg-primary/5 border border-primary/20 rounded-xl flex flex-wrap items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="rounded-full px-3">{selectedLeads.length}</Badge>
                <span className="text-sm font-medium">Leads selected</span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedLeads([])} className="text-xs h-7">Clear</Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Bulk Assign:</span>
                <StaffCombobox
                  staffMembers={allStaff}
                  value="unassigned"
                  onChange={(val) => { handleBulkAssign(val); }}
                  mode="assign"
                  disabled={isBulkActing}
                />
                {isBulkActing && <RotateCw className="h-4 w-4 animate-spin text-primary" />}
              </div>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {allStaff.length === 0 && !isLoading && (
            <div className="mb-4 bg-amber-50 border border-amber-200 p-3 rounded-md flex items-center gap-3 text-amber-800 text-sm">
              <FileWarning className="h-5 w-5 text-amber-500" />
              <div>
                <p className="font-semibold">No assignable staff found.</p>
                <p>You might have restricted permissions or no businesses assigned to your scope.</p>
              </div>
            </div>
          )}
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : paginatedOrders.length > 0 ? (
            <>
              <div className="sm:hidden mb-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={handleSelectAllOnPage}
                  disabled={allPageSelected}
                >
                  Select all on this page
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={handleClearPageSelection}
                  disabled={selectedOnPageCount === 0}
                >
                  Clear page selection
                </Button>
                <Badge variant="secondary" className="rounded-full px-2 py-0.5">
                  {selectedOnPageCount}/{paginatedOrderIds.length} selected
                </Badge>
              </div>
              <div className="hidden sm:block">{renderTable()}</div>
              <div className="sm:hidden">{renderCards()}</div>
            </>
          ) : (
            <div className="h-48 flex flex-col items-center justify-center text-center text-muted-foreground">
              <FileWarning className="w-12 h-12 mb-4" />
              <h3 className="font-semibold">No Incomplete Orders Found</h3>
              <p className="text-sm">When a customer abandons a checkout, it will appear here.</p>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <div className="w-full flex items-center justify-between text-xs text-muted-foreground">
            <div>
              <div className="flex flex-col sm:flex-row items-center gap-2">
                <Select value={String(pageSize)} onValueChange={(val) => setPageSize(Number(val))}>
                  <SelectTrigger className="w-[110px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 / page</SelectItem>
                    <SelectItem value="25">25 / page</SelectItem>
                    <SelectItem value="50">50 / page</SelectItem>
                    <SelectItem value="100">100 / page</SelectItem>
                  </SelectContent>
                </Select>
                <span className="shrink-0">
                  Showing{' '}
                  <strong>
                    {totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1}-
                    {Math.min(currentPage * pageSize, totalCount)}
                  </strong>{' '}
                  of <strong>{totalCount}</strong> leads
                </span>
              </div>
              {totalPages > 1 && (
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setCurrentPage((p) => Math.max(1, p - 1));
                        }}
                      />
                    </PaginationItem>
                    {/* Desktop Number Pagination */}
                    <div className="hidden sm:flex items-center gap-1">
                      {Array.from({ length: totalPages }).map((_, i) => {
                        const page = i + 1;
                        const isNearCurrent = Math.abs(page - currentPage) <= 1;
                        const isEnd = page === 1 || page === totalPages;

                        if (!isNearCurrent && !isEnd) {
                          if (page === 2 || page === totalPages - 1) {
                            return (
                              <PaginationItem key={page}>
                                <span className="flex h-9 w-9 items-center justify-center text-muted-foreground text-sm">...</span>
                              </PaginationItem>
                            );
                          }
                          return null;
                        }

                        return (
                          <PaginationItem key={page}>
                            <Button
                              variant={currentPage === page ? "default" : "outline"}
                              size="icon"
                              className="h-9 w-9 text-xs"
                              onClick={(e) => {
                                e.preventDefault();
                                setCurrentPage(page);
                              }}
                            >
                              {page}
                            </Button>
                          </PaginationItem>
                        );
                      })}
                    </div>

                    {/* Mobile Simple Indicator */}
                    <div className="sm:hidden flex items-center justify-center px-4 w-[80px]">
                      <span className="text-sm font-medium">
                        {currentPage} / {totalPages}
                      </span>
                    </div>

                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setCurrentPage((p) => Math.min(totalPages, p + 1));
                        }}
                        className={
                          currentPage === totalPages
                            ? 'pointer-events-none opacity-50'
                            : ''
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          </div>
        </CardFooter>
      </Card>

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col p-0 rounded-2xl border-none shadow-2xl">
          <DialogHeader className="p-6 pb-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-xl font-bold tracking-tight">Lead Details</DialogTitle>
                <DialogDescription>
                  Checkout session information and history.
                </DialogDescription>
              </div>
              {leadDetail && (
                <Badge
                  variant={leadDetail.status === 'CONVERTED' ? 'default' : 'secondary'}
                  className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                    leadDetail.status === 'CONVERTED' && "bg-emerald-500 hover:bg-emerald-600",
                    leadDetail.status === 'OPEN' && "bg-blue-500/10 text-blue-600 hover:bg-blue-500/20"
                  )}
                >
                  {leadDetail.status}
                </Badge>
              )}
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">

            {isDetailLoading ? (
              <div className="space-y-4 py-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : leadDetail ? (
              <div className="space-y-6 py-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Customer</h4>
                    <p className="text-lg font-bold leading-tight">{deriveLeadName(leadDetail)}</p>
                    <a href={`tel:${normalizeBdPhoneForStorage(deriveLeadPhone(leadDetail) || '').value || deriveLeadPhone(leadDetail) || ''}`} className="text-sm font-medium text-blue-600 hover:underline block mb-1">
                      {deriveLeadPhone(leadDetail)}
                    </a>
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Store / Source</h4>
                    <p className="font-semibold text-sm">{leadDetail.businessName || 'EcoMate'}</p>
                    {leadDetail.storeUrl && (
                      <a href={leadDetail.storeUrl} target="_blank" className="text-xs text-blue-600 hover:underline break-all block">
                        {leadDetail.storeUrl}
                      </a>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Shipping Address</h4>
                  <p className="text-sm p-3 bg-muted/50 border border-muted rounded-xl leading-relaxed">{deriveLeadAddress(leadDetail) || 'No address provided'}</p>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase mb-2">Cart Items</h4>
                  <div className="space-y-2">
                    {resolvedLeadItems.length > 0 ? (
                      resolvedLeadItems.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-3 p-2 border rounded-lg bg-muted/30">
                          <div className="h-12 w-12 rounded border bg-background overflow-hidden flex-shrink-0">
                            {item.image ? (
                              <img src={resolveImageSrc(item.image)} alt={item.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full flex items-center justify-center bg-muted">
                                <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold truncate">{item.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{item.sku}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold">৳{item.price}</p>
                            <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                          </div>
                        </div>
                      ))
                    ) : leadDetail.skuList && leadDetail.skuList.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {leadDetail.skuList.map((sku: any, idx) => (
                          <Badge key={idx} variant="secondary">
                            {typeof sku === 'string' ? sku : (sku.sku || sku.SKU || JSON.stringify(sku))}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm italic text-muted-foreground">No items in cart</span>
                    )}
                  </div>
                </div>

                {leadDetail.payload && (
                  <div>
                    <h4 className="text-sm font-semibold text-muted-foreground uppercase mb-2">Raw Data</h4>
                    <pre className="text-[10px] p-2 bg-slate-900 text-slate-100 rounded overflow-x-auto">
                      {JSON.stringify(leadDetail.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Lead not found or has been removed.</p>
              </div>
            )}
          </div>

          <DialogFooter className="p-4 sm:p-6 pt-0 flex-col-reverse sm:flex-row gap-2 sm:gap-3 bg-gradient-to-t from-background via-background to-transparent">
            <Button variant="ghost" onClick={() => setIsDetailOpen(false)} className="w-full sm:w-auto rounded-xl text-muted-foreground">Close</Button>

            <div className="flex gap-2 w-full sm:w-auto">
              {leadDetail && canOrders('update') && leadDetail.status === 'OPEN' && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="flex-1 sm:w-auto text-amber-600 border-amber-200 hover:bg-amber-50 rounded-xl px-2 h-10 sm:h-11">
                      Not Converted
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md rounded-2xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Mark as Not Converted?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will close the lead for analytics without creating an order.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                      <AlertDialogCancel className="w-full sm:w-auto rounded-xl mt-0">Go Back</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleNotConverted(leadDetail.id)} className="w-full sm:w-auto rounded-xl">
                        Confirm
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {leadDetail && canOrders('update') && leadDetail.status === 'OPEN' && (
                <Button onClick={() => openConvertModal(leadDetail.id)} disabled={isPreparingConvert} className="flex-1 sm:w-auto rounded-xl shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground h-10 sm:h-11">
                  {isPreparingConvert ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Wand2 className="mr-2 h-4 w-4" />
                      <span>Convert</span>
                    </>
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewOrderDialog
        open={isConvertDialogOpen}
        onOpenChange={(open) => {
          setIsConvertDialogOpen(open);
          if (!open) {
            setConvertLead(null);
            setConvertPrefillItems([]);
          }
        }}
        leadPrefill={convertLead ? {
          leadId: convertLead.id,
          businessId: convertLead.businessId,
          customerName: deriveLeadName(convertLead),
          customerPhone: deriveLeadPhone(convertLead),
          customerAddress: deriveLeadAddress(convertLead),
          customerNote: (convertLead.payload as any)?.note || '',
          officeNote: '',
          items: convertPrefillItems,
        } : null}
        onOrderCreated={async (order) => {
          try {
            if (convertLead?.id && order?.id) {
              await markIncompleteLeadConverted(convertLead.id, order.id);
            }
            toast({ title: 'Converted', description: 'Lead converted to order.' });
            await refreshLeads();
          } catch (e: any) {
            toast({ title: 'Converted (partial)', description: e?.message || 'Order created but lead not marked converted', variant: 'destructive' });
          }
        }}
      />
    </div>
  );
}
