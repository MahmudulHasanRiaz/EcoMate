
'use client';

import { MoreHorizontal, PlusCircle, Printer, DollarSign, Scissors, Package, PackagePlus, Loader2 } from "lucide-react";
import Link from "next/link";
import { DateRange } from "react-day-picker";
import { format } from "date-fns";
import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { PurchaseOrder, PurchaseOrderStatus } from "@/types";
import { 
  getPurchaseStats, 
  updatePurchaseOrder 
} from "@/services/purchases";
import { getSuppliers, getVendors } from "@/services/partners";
import { useToast } from "@/hooks/use-toast";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";

const ITEMS_PER_PAGE = 20;

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP error! status: ${res.status}`);
  }
  return json.data || json;
};

const statusColors: Record<string, string> = {
  'Received': 'bg-green-500/20 text-green-700',
  'Cutting': 'bg-purple-500/20 text-purple-700',
  'Printing': 'bg-yellow-500/20 text-yellow-700',
  'Fabric Ordered': 'bg-blue-500/20 text-blue-700',
  'Draft': 'bg-gray-500/20 text-gray-700',
  'Cancelled': 'bg-red-500/20 text-red-700',
};
const paymentStatusColors: Record<string, string> = {
  'Paid': 'bg-emerald-500/20 text-emerald-700',
  'Partial': 'bg-amber-500/20 text-amber-700',
  'Unpaid': 'bg-red-500/20 text-red-700',
};

export default function PurchasesClientPage() {
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [deferredDateRange, setDeferredDateRange] = useState<DateRange | undefined>(undefined);
  
  // New Filters
  const [status, setStatus] = useState<string>('all');
  const [paymentStatus, setPaymentStatus] = useState<string>('all');
  const [partyFilter, setPartyFilter] = useState<string>('all');

  const [isPending, startTransition] = useTransition();
  const [menuResetKey, setMenuResetKey] = useState(0);

  const handleDateChange = (range: DateRange | undefined) => {
    setDateRange(range);
    startTransition(() => {
      setDeferredDateRange(range);
    });
  };

  // Fetch filter options
  const { data: suppliersData } = useSWR('/api/partners/suppliers', () => getSuppliers({ pageSize: 100 }));
  const { data: vendorsData } = useSWR('/api/partners/vendors', () => getVendors({ pageSize: 100 }));

  const suppliers = suppliersData?.items || [];
  const vendors = vendorsData?.items || [];

  // Stats fetching
  const { data: stats, error: statsError } = useSWR(
    ['/api/purchases/stats', deferredDateRange],
    () => getPurchaseStats({
      from: deferredDateRange?.from?.toISOString(),
      to: deferredDateRange?.to?.toISOString()
    })
  );

  // Infinite Loading for Purchases
  const getKey = (pageIndex: number, previousPageData: any) => {
    if (previousPageData && !previousPageData.nextCursor) return null;
    const cursor = previousPageData?.nextCursor || '';
    const params = new URLSearchParams({
      cursor,
      pageSize: String(ITEMS_PER_PAGE),
      from: deferredDateRange?.from?.toISOString() || '',
      to: deferredDateRange?.to?.toISOString() || '',
      status: status !== 'all' ? status : '',
      paymentStatus: paymentStatus !== 'all' ? paymentStatus : '',
      party: partyFilter !== 'all' ? partyFilter : '',
    });
    return `/api/purchases?${params.toString()}`;
  };

  const { data: infiniteData, size, setSize, isValidating, mutate, error: listError } = useSWRInfinite(getKey, fetcher);
  const listErrorShown = useRef(false);
  const statsErrorShown = useRef(false);

  useEffect(() => {
    if (listError && !listErrorShown.current) {
      listErrorShown.current = true;
      toast({
        variant: "destructive",
        title: "Failed to load purchases",
        description: listError.message || "Please retry.",
      });
    }
    if (!listError) listErrorShown.current = false;
  }, [listError, toast]);

  useEffect(() => {
    if (statsError && !statsErrorShown.current) {
      statsErrorShown.current = true;
      toast({
        variant: "destructive",
        title: "Failed to load purchase stats",
        description: statsError.message || "Please retry.",
      });
    }
    if (!statsError) statsErrorShown.current = false;
  }, [statsError, toast]);

  const allPurchaseOrders = useMemo(() => {
    return infiniteData ? infiniteData.flatMap(page => page.items || []) : [];
  }, [infiniteData]);

  const hasMore = infiniteData && infiniteData[infiniteData.length - 1]?.nextCursor;
  const isLoading = !infiniteData && isValidating;

  const purchaseStatuses: PurchaseOrderStatus[] = ['Draft', 'Fabric Ordered', 'Printing', 'Cutting', 'Received', 'Cancelled'];

  const handleStatusChange = async (poId: string, status: PurchaseOrderStatus) => {
    try {
      const res = await updatePurchaseOrder(poId, { status });
      if (res) {
        mutate();
        toast({ title: "Status Updated", description: `PO ${poId} moved to ${status}.` });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Update Failed", description: err.message });
    }
    setMenuResetKey(k => k + 1);
  };

  const closeMenuAnd = (fn: () => void) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setTimeout(fn, 0);
  };

  const clearFilters = () => {
    setStatus('all');
    setPaymentStatus('all');
    setPartyFilter('all');
    handleDateChange(undefined);
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 overflow-x-hidden">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="font-headline text-2xl font-bold tracking-tight">Purchases</h1>
          <p className="text-sm text-muted-foreground">Standardized manufacturing and supplier management.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end flex-wrap">
          <DateRangePicker date={dateRange} onDateChange={handleDateChange} placeholder="Filter by batch date" />
          <Button size="sm" asChild className="shadow-sm">
            <Link href="/dashboard/purchases/new">
              <PlusCircle className="h-4 w-4 mr-2" />
              <span>New Batch</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl border border-primary/10 shadow-sm">
        <div className="w-[160px]">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="PO Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {purchaseStatuses.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[160px]">
          <Select value={paymentStatus} onValueChange={setPaymentStatus}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Payment Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Payments</SelectItem>
              <SelectItem value="Unpaid">Unpaid</SelectItem>
              <SelectItem value="Partial">Partial</SelectItem>
              <SelectItem value="Paid">Paid</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="w-[200px]">
          <Select value={partyFilter} onValueChange={setPartyFilter}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Supplier / Vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Partners</SelectItem>
              {suppliers.length > 0 && <div className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase bg-muted/30">Suppliers</div>}
              {suppliers.map((s: any) => (
                <SelectItem key={`supplier:${s.id}`} value={`supplier:${s.id}`}>{s.name}</SelectItem>
              ))}
              {vendors.length > 0 && <div className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase bg-muted/30 mt-1">Vendors</div>}
              {vendors.map((v: any) => (
                <SelectItem key={`vendor:${v.id}`} value={`vendor:${v.id}`}>{v.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {(status !== 'all' || paymentStatus !== 'all' || partyFilter !== 'all' || dateRange) && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 px-2 text-xs text-muted-foreground hover:text-primary">
            Clear
          </Button>
        )}
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { title: "Total Running", val: stats?.totalRunningQty, cost: stats?.totalRunningValue, icon: PackagePlus, color: "text-primary" },
          { title: "Fabric Stage", val: stats?.inFabricQty, cost: stats?.inFabricValue, icon: Package, color: "text-blue-500" },
          { title: "Printing Stage", val: stats?.inPrintingQty, cost: stats?.inPrintingValue, icon: Printer, color: "text-yellow-500" },
          { title: "Cutting Stage", val: stats?.inCuttingQty, cost: stats?.inCuttingValue, icon: Scissors, color: "text-purple-500" },
        ].map((s, i) => (
          <Card key={i} className="border-primary/10 bg-gradient-to-br from-background via-background to-muted/30 shadow-sm backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{s.title}</CardTitle>
              <s.icon className={cn("h-4 w-4", s.color)} />
            </CardHeader>
            <CardContent>
              {statsError ? (
                <div className="text-xs text-destructive">Failed to load stats</div>
              ) : stats ? (
                <>
                  <div className="text-2xl font-bold">{(s.val || 0).toLocaleString()} <span className="text-xs font-normal text-muted-foreground">qty</span></div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Valued at <span className="font-mono font-medium text-foreground">Tk {(s.cost || 0).toLocaleString()}</span>
                  </p>
                </>
              ) : (
                <div className="animate-pulse space-y-2">
                  <div className="h-6 bg-muted rounded w-3/4"></div>
                  <div className="h-3 bg-muted rounded w-1/2"></div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-primary/10 shadow-sm overflow-hidden bg-gradient-to-b from-background to-muted/30 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Batch List</CardTitle>
          {isValidating && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </CardHeader>
        <CardContent className="p-0">
          {listError ? (
            <div className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Package className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm font-medium">Failed to load purchases</p>
              <Button variant="outline" size="sm" onClick={() => mutate()}>
                Retry
              </Button>
            </div>
          ) : isLoading ? (
            <div className="h-64 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p>Loading batches...</p>
            </div>
          ) : allPurchaseOrders.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[120px] pl-4 text-muted-foreground">PO Number</TableHead>
                    <TableHead className="text-muted-foreground">Type</TableHead>
                    <TableHead className="text-muted-foreground">Supplier</TableHead>
                    <TableHead className="text-muted-foreground">Date</TableHead>
                    <TableHead className="text-muted-foreground">Payment</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-right pr-4">Total</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allPurchaseOrders.map((po) => (
                    <TableRow key={po.id} className="group hover:bg-muted/30 transition-colors">
                      <TableCell className="font-medium pl-4">
                        <Link href={`/dashboard/purchases/${po.id}`} className="hover:text-primary transition-colors">
                          #{po.id}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={po.type === 'general' ? 'secondary' : 'outline'} className="rounded-sm">
                          {po.type === 'general' ? 'General' : '3-Piece'}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate">{po.supplier}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{format(new Date(po.date), "MMM d, yyyy")}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('rounded-sm border-none font-medium shadow-sm ring-1 ring-black/5', paymentStatusColors[po.paymentStatus])}>
                          {po.paymentStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('rounded-sm border-none font-medium shadow-sm ring-1 ring-black/5', statusColors[po.status])}>
                          {po.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium pr-4">Tk {po.total.toLocaleString()}</TableCell>
                      <TableCell>
                        <DropdownMenu key={`${menuResetKey}-${po.id}`}>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="opacity-0 group-hover:opacity-100 transition-opacity">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel>Batch Actions</DropdownMenuLabel>
                            <DropdownMenuItem asChild><Link href={`/dashboard/purchases/${po.id}`}>View Details</Link></DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => closeMenuAnd(() => handleStatusChange(po.id, 'Received'))}>Mark Received</DropdownMenuItem>
                            <Separator className="my-1" />
                            <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground font-bold">Move Stage</DropdownMenuLabel>
                            {purchaseStatuses.map((status) => (
                              <DropdownMenuItem key={status} onSelect={() => closeMenuAnd(() => handleStatusChange(po.id, status))}>
                                {status}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Package className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground font-medium">No batches found</p>
              {(dateRange?.from || dateRange?.to || status !== 'all' || paymentStatus !== 'all' || partyFilter !== 'all') && (
                <Button variant="link" size="sm" onClick={clearFilters}>Clear filters</Button>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-center border-t bg-muted/30 p-4">
          {hasMore ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSize(size + 1)}
              disabled={isValidating}
              className="bg-background shadow-sm px-8"
            >
              {isValidating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Fetching...
                </>
              ) : 'Load More Batches'}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {allPurchaseOrders.length > 0 ? "End of purchase history reached." : ""}
            </p>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
