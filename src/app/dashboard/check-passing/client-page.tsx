
'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, MoreHorizontal, Eye } from "lucide-react";
import {
  addDays,
  endOfDay,
  format,
  isTomorrow,
  isToday,
  startOfDay,
  startOfToday,
} from "date-fns";
import { cn } from "@/lib/utils";
import Link from 'next/link';
import { Separator } from '@/components/ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import { Skeleton } from '@/components/ui/skeleton';
import dynamic from 'next/dynamic';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import { getCheckPassingItems, getCheckPassingLogs, getCheckPassingSummary, updateCheckPassingStatus } from '@/services/check-passing';
import type { CheckPassingItem, CheckPassingLog, CheckPassingSummaryItem } from '@/services/check-passing';
import type { CheckStatus } from '@/types';
import Autoplay from "embla-carousel-autoplay"
import { useToast } from '@/hooks/use-toast';


type CheckPayment = CheckPassingItem;

const statusColors: Record<CheckStatus, string> = {
  Pending: "bg-yellow-500/20 text-yellow-700",
  Passed: "bg-green-500/20 text-green-700",
  Bounced: "bg-red-500/20 text-red-700",
  Cancelled: "bg-gray-500/20 text-gray-700",
};


const CheckOverviewCarousel = dynamic(
  () => Promise.resolve(({ data }: { data: OverviewData[] }) => (
    <Carousel
      opts={{
        align: "start",
        loop: true,
      }}
      plugins={[
        Autoplay({
          delay: 3000,
        }),
      ]}
      className="w-full max-w-xs mx-auto"
    >
      <CarouselContent>
        {data.map((day, index) => (
          <CarouselItem key={index} className="md:basis-1/2 lg:basis-1/3">
            <div className="p-1">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{day.label}</CardTitle>
                  <span className="text-xs text-muted-foreground">{format(day.date, 'MMM d')}</span>
                </CardHeader>
                <CardContent className="flex flex-col items-center justify-center p-6 pt-2">
                  <div className="text-3xl font-bold">Tk {day.total.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground mt-1">{day.count} pending {day.count === 1 ? 'check' : 'checks'}</p>
                </CardContent>
              </Card>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  )),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[138px] w-full max-w-xs mx-auto" />
  }
);


type OverviewData = {
  label: string;
  date: Date;
  count: number;
  total: number;
};

function CheckDetailsDialog({ check, open, onOpenChange }: { check: CheckPayment | null, open: boolean, onOpenChange: (open: boolean) => void }) {
  if (!check) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Payment Voucher</DialogTitle>
        </DialogHeader>
        <div className="border rounded-lg p-6 space-y-6 bg-white shadow-sm print:shadow-none print:border-none">
          <div className="flex justify-between items-start border-b pb-4">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Payment To</div>
              <div className="font-bold text-lg">{check.payee}</div>
              <div className="text-sm text-muted-foreground">{check.source} - {check.type}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Check No</div>
              <div className="font-mono font-bold text-lg">{check.checkNo || 'N/A'}</div>
              <div className="text-sm text-muted-foreground">{format(new Date(check.date), 'PP')}</div>
            </div>
          </div>

          <div className="py-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Amount</div>
            <div className="text-3xl font-bold font-mono">Tk {check.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-muted-foreground mt-1 capitalize">{check.amount < 0 ? 'Refund / Credit' : 'Debit / Payment'}</div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm border-t pt-4">
            <div>
              <span className="block text-xs text-muted-foreground">Reference</span>
              <span className="font-medium">{check.referenceLabel}</span>
              {check.referenceUrl && (
                <Link href={check.referenceUrl} className="text-xs text-blue-600 underline block mt-0.5">View Source</Link>
              )}
            </div>
            <div>
              <span className="block text-xs text-muted-foreground">Detailed Status</span>
              <Badge variant="outline" className={cn("mt-1", statusColors[check.status])}>{check.status}</Badge>
            </div>
          </div>

          <div className="pt-8 mt-4 border-t border-dashed flex justify-between items-center text-xs text-muted-foreground">
            <div>Authorized Signature</div>
            <div>Receiver Signature</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}



export default function CheckPassingClientPage() {
  const { toast } = useToast();
  const [isClient, setIsClient] = React.useState(false);
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);
  const [checks, setChecks] = React.useState<CheckPayment[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const isMobile = useIsMobile();
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [searchInput, setSearchInput] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'All' | CheckStatus>('All');
  const [sourceFilter, setSourceFilter] = React.useState<'All' | CheckPayment['source']>('All');
  const [selectedKeys, setSelectedKeys] = React.useState<string[]>([]);
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [historyTarget, setHistoryTarget] = React.useState<CheckPayment | null>(null);
  const [historyLogs, setHistoryLogs] = React.useState<CheckPassingLog[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = React.useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = React.useState(false);
  const [summary, setSummary] = React.useState<CheckPassingSummaryItem[]>([]);
  const [menuResetKey, setMenuResetKey] = React.useState(0);
  const [viewCheck, setViewCheck] = React.useState<CheckPayment | null>(null);
  const loadingMoreRef = React.useRef(false);

  const PAGE_SIZE = 100;

  const checkKey = React.useCallback(
    (check: CheckPayment) => `${check.source}-${check.id}`,
    []
  );

  const releaseFocusAndOpen = (openFn: () => void) => {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch { }
    window.setTimeout(() => {
      setMenuResetKey((k) => k + 1);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(openFn));
      } else {
        openFn();
      }
    }, 0);
  };

  const resetMenuFocus = () => {
    try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
    window.setTimeout(() => {
      try { document.body?.focus?.(); } catch { }
      setMenuResetKey((k) => k + 1);
    }, 0);
  };

  React.useEffect(() => {
    setIsClient(true);
  }, []);

  React.useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const refreshSummary = React.useCallback(async () => {
    try {
      const data = await getCheckPassingSummary();
      setSummary(data || []);
    } catch {
      setSummary([]);
    }
  }, []);

  const loadChecks = React.useCallback(async (options?: { cursor?: string | null; append?: boolean }) => {
    const append = Boolean(options?.append);
    if (append) {
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }

    const fromDate = dateRange?.from ? startOfDay(dateRange.from) : undefined;
    const toDate = dateRange?.from
      ? endOfDay(dateRange.to ?? dateRange.from)
      : undefined;

    try {
      const data = await getCheckPassingItems({
        pageSize: PAGE_SIZE,
        cursor: options?.cursor || null,
        from: fromDate,
        to: toDate,
        status: statusFilter,
        source: sourceFilter,
        search: searchQuery,
      });
      setChecks((prev) => (append ? [...prev, ...data.items] : data.items));
      setNextCursor(data.nextCursor);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Failed to load checks',
        description: 'Please refresh and try again.',
      });
    } finally {
      if (append) {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [dateRange, statusFilter, sourceFilter, searchQuery, toast]);

  React.useEffect(() => {
    loadChecks({ append: false });
    refreshSummary();
  }, [loadChecks, refreshSummary]);

  React.useEffect(() => {
    setSelectedKeys([]);
  }, [dateRange, searchQuery, sourceFilter, statusFilter]);

  const overviewDays = [
    { label: 'Today', date: startOfToday() },
    { label: 'Tomorrow', date: addDays(startOfToday(), 1) },
    { label: 'In 2 Days', date: addDays(startOfToday(), 2) },
    { label: 'In 3 Days', date: addDays(startOfToday(), 3) },
    { label: 'In 7 Days', date: addDays(startOfToday(), 7) },
  ];

  const summaryMap = React.useMemo(() => {
    return new Map(summary.map((item) => [item.date, item]));
  }, [summary]);

  const overviewData = overviewDays.map(day => {
    const key = format(day.date, 'yyyy-MM-dd');
    const data = summaryMap.get(key);
    return {
      label: day.label,
      date: day.date,
      count: data?.count ?? 0,
      total: data?.total ?? 0,
    };
  });

  const selectedChecks = React.useMemo(() => {
    if (!selectedKeys.length) return [];
    const selectedSet = new Set(selectedKeys);
    return checks.filter((check) => selectedSet.has(checkKey(check)));
  }, [selectedKeys, checks, checkKey]);

  const allSelected =
    checks.length > 0 && selectedChecks.length === checks.length;
  const selectAllState =
    allSelected ? true : selectedChecks.length ? 'indeterminate' : false;

  const visibleKeys = React.useMemo(
    () => checks.map((check) => checkKey(check)),
    [checks, checkKey]
  );

  const toggleSelection = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedKeys(visibleKeys);
    } else {
      setSelectedKeys([]);
    }
  };

  const handleStatusUpdate = async (checks: CheckPayment[], status: CheckStatus) => {
    if (!checks.length || isUpdating) return;
    setIsUpdating(true);
    const updates = checks.map((check) => ({
      id: check.id,
      source: check.source,
      status,
    }));
    const result = await updateCheckPassingStatus(updates);
    if (!result.updated.length) {
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: 'No checks were updated. Please try again.',
      });
      setIsUpdating(false);
      return;
    }
    const updateMap = new Map(
      result.updated.map((item) => [`${item.source}-${item.id}`, item])
    );
    setChecks((prev) =>
      prev.map((check) => {
        const update = updateMap.get(checkKey(check));
        if (!update) return check;
        return {
          ...check,
          status: update.status,
          updatedAt: update.updatedAt || check.updatedAt,
        };
      })
    );
    setSelectedKeys([]);
    toast({
      title: 'Status updated',
      description: `${result.updated.length} check${result.updated.length > 1 ? 's' : ''} marked as ${status}.`,
    });
    refreshSummary();
    setIsUpdating(false);
    resetMenuFocus();
  };

  const handleExportCsv = () => {
    const exportChecks = selectedChecks.length ? selectedChecks : checks;
    if (!exportChecks.length) return;

    const headers = ['Passing Date', 'Reference', 'Source', 'Payee', 'Type', 'Status', 'Amount'];
    const rows = exportChecks.map((check) => ([
      format(new Date(check.date), 'yyyy-MM-dd'),
      check.referenceLabel,
      check.source,
      check.payee,
      check.type,
      check.status,
      check.amount.toFixed(2),
    ]));
    const escapeValue = (value: string) => `"${value.replace(/\"/g, '""')}"`;
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => escapeValue(String(value))).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `check-passing-${format(new Date(), 'yyyyMMdd')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openHistory = async (check: CheckPayment) => {
    setHistoryTarget(check);
    setHistoryLogs([]);
    setIsHistoryOpen(true);
    setIsHistoryLoading(true);
    const logs = await getCheckPassingLogs({ source: check.source, sourceId: check.id });
    setHistoryLogs(logs);
    setIsHistoryLoading(false);
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
        <Skeleton className="h-10 w-1/4" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }


  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center">
        <div className="flex-1">
          <h1 className="font-headline text-2xl font-bold">Check Passing</h1>
          <p className="text-muted-foreground hidden sm:block">
            Overview and list of upcoming check payments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker date={dateRange} onDateChange={setDateRange} presetMode="future" />
        </div>
      </div>

      {isClient && isMobile ? (
        <div className='py-4'>
          <CheckOverviewCarousel data={overviewData} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {overviewData.map(day => (
            <Card key={day.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{day.label}</CardTitle>
                <span className="text-xs text-muted-foreground">{format(day.date, 'MMM d')}</span>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">Tk {day.total.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">{day.count} pending {day.count === 1 ? 'check' : 'checks'}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Upcoming Checks</CardTitle>
              <CardDescription>
                {dateRange?.from
                  ? `Showing checks from ${format(dateRange.from, "LLL dd, y")}${dateRange.to ? ` to ${format(dateRange.to, "LLL dd, y")}` : ''}`
                  : "All scheduled check payments."
                }
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search checks..."
                className="sm:w-64"
              />
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'All' | CheckStatus)}>
                <SelectTrigger className="sm:w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Statuses</SelectItem>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Passed">Passed</SelectItem>
                  <SelectItem value="Bounced">Bounced</SelectItem>
                  <SelectItem value="Cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(value as 'All' | CheckPayment['source'])}>
                <SelectTrigger className="sm:w-36">
                  <SelectValue placeholder="Source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Sources</SelectItem>
                  <SelectItem value="Purchase">Purchase</SelectItem>
                  <SelectItem value="Expense">Expense</SelectItem>
                  <SelectItem value="Staff">Staff</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={handleExportCsv}
                disabled={checks.length === 0}
              >
                Export CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {selectedKeys.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <span>{selectedKeys.length} selected</span>
              <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={isUpdating}>
                      Bulk Update
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Set Status</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => handleStatusUpdate(selectedChecks, 'Pending')}>Mark as Pending</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleStatusUpdate(selectedChecks, 'Passed')}>Mark as Passed</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleStatusUpdate(selectedChecks, 'Bounced')}>Mark as Bounced</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleStatusUpdate(selectedChecks, 'Cancelled')}>Mark as Cancelled</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="ghost" size="sm" onClick={() => setSelectedKeys([])}>
                  Clear
                </Button>
              </div>
            </div>
          )}
          {/* Table for larger screens */}
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={selectAllState}
                      onCheckedChange={(checked) => toggleSelectAll(Boolean(checked))}
                      aria-label="Select all checks"
                    />
                  </TableHead>
                  <TableHead>Passing Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-[48px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isClient && checks.length > 0 ? (
                  checks.map((check) => {
                    const checkDate = new Date(check.date);
                    const isTodayCheck = isToday(checkDate);
                    const isTomorrowCheck = isTomorrow(checkDate);
                    const rowKey = checkKey(check);
                    return (
                      <TableRow key={rowKey} className={cn(isTodayCheck && "bg-primary/10")}>
                        <TableCell>
                          <Checkbox
                            checked={selectedKeys.includes(rowKey)}
                            onCheckedChange={() => toggleSelection(rowKey)}
                            aria-label={`Select check ${check.referenceLabel}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex flex-col">
                            <span>{format(checkDate, "MMMM d, yyyy")}</span>
                            {(isTodayCheck || isTomorrowCheck) && (
                              <Badge variant={isTodayCheck ? "destructive" : "secondary"} className="w-fit mt-1">
                                {isTodayCheck ? "Today" : "Tomorrow"}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            {check.referenceUrl ? (
                              <Button variant="link" asChild className="p-0 h-auto">
                                <Link href={check.referenceUrl}>{check.referenceLabel}</Link>
                              </Button>
                            ) : (
                              <span>{check.referenceLabel}</span>
                            )}
                            <span className="text-xs text-muted-foreground">{check.source}</span>
                          </div>
                        </TableCell>
                        <TableCell>{check.payee}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{check.type}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(statusColors[check.status])}>{check.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">Tk {check.amount.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setViewCheck(check)}
                              title="View Voucher"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <DropdownMenu key={`${rowKey}-${menuResetKey}`}>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  aria-haspopup="true"
                                  size="icon"
                                  variant="ghost"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                  <span className="sr-only">Toggle menu</span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Update Status</DropdownMenuLabel>
                                <DropdownMenuItem onSelect={() => handleStatusUpdate([check], 'Pending')}>Mark as Pending</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleStatusUpdate([check], 'Passed')}>Mark as Passed</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleStatusUpdate([check], 'Bounced')}>Mark as Bounced</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleStatusUpdate([check], 'Cancelled')}>Mark as Cancelled</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => releaseFocusAndOpen(() => openHistory(check))}>View History</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : isClient && checks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center">
                      No upcoming checks found for the selected date range.
                    </TableCell>
                  </TableRow>
                ) : (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}><Skeleton className="h-8 w-full" /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {/* Card list for smaller screens */}
          {isClient && (
            <div className="sm:hidden space-y-4">
              {checks.length > 0 ? (
                checks.map((check) => {
                  const checkDate = new Date(check.date);
                  const isTodayCheck = isToday(checkDate);
                  const isTomorrowCheck = isTomorrow(checkDate);
                  const rowKey = checkKey(check);
                  return (
                    <Card key={rowKey} className={cn(isTodayCheck && "bg-primary/10")}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={selectedKeys.includes(rowKey)}
                              onCheckedChange={() => toggleSelection(rowKey)}
                              aria-label={`Select check ${check.referenceLabel}`}
                            />
                            <div>
                              <p className="font-semibold">{check.payee}</p>
                              <p className="text-sm">
                                Ref:{' '}
                                {check.referenceUrl ? (
                                  <Button variant="link" asChild className="p-0 h-auto text-sm">
                                    <Link href={check.referenceUrl}>{check.referenceLabel}</Link>
                                  </Button>
                                ) : (
                                  <span>{check.referenceLabel}</span>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">{check.source}</p>
                              <div className="mt-2">
                                <Badge variant="outline">{check.type}</Badge>
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex flex-col items-end">
                            <p className="font-semibold font-mono">Tk {check.amount.toFixed(2)}</p>
                            <div className="mt-2">
                              <Badge variant="outline" className={cn(statusColors[check.status])}>{check.status}</Badge>
                            </div>
                          </div>
                        </div>
                        <Separator className="my-3" />
                        <div className="flex justify-between items-center text-sm">
                          <div className="flex flex-col">
                            <span className="text-muted-foreground">{format(checkDate, "MMMM d, yyyy")}</span>
                            {(isTodayCheck || isTomorrowCheck) && (
                              <Badge variant={isTodayCheck ? "destructive" : "secondary"} className="w-fit mt-1">
                                {isTodayCheck ? "Today" : "Tomorrow"}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setViewCheck(check)}
                              title="View Voucher"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <DropdownMenu key={`${rowKey}-card-${menuResetKey}`}>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  aria-haspopup="true"
                                  size="icon"
                                  variant="ghost"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                  <span className="sr-only">Toggle menu</span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Update Status</DropdownMenuLabel>
                                <DropdownMenuItem onSelect={() => handleStatusUpdate([check], 'Pending')}>Mark as Pending</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleStatusUpdate([check], 'Passed')}>Mark as Passed</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleStatusUpdate([check], 'Bounced')}>Mark as Bounced</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleStatusUpdate([check], 'Cancelled')}>Mark as Cancelled</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => releaseFocusAndOpen(() => openHistory(check))}>View History</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })
              ) : (
                <div className="h-24 text-center text-muted-foreground flex items-center justify-center">
                  No upcoming checks found.
                </div>
              )}
            </div>
          )}
          {!!nextCursor && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                onClick={() => loadChecks({ cursor: nextCursor, append: true })}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? 'Loading...' : 'Load more'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={isHistoryOpen}
        onOpenChange={(open) => {
          setIsHistoryOpen(open);
          if (!open) {
            setHistoryTarget(null);
            setHistoryLogs([]);
            setIsHistoryLoading(false);
            resetMenuFocus();
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Check History</DialogTitle>
          </DialogHeader>
          {historyTarget && (
            <div className="text-sm text-muted-foreground">
              {historyTarget.payee} - {historyTarget.referenceLabel} - {historyTarget.type}
            </div>
          )}
          <div className="max-h-[60vh] overflow-y-auto">
            {isHistoryLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading history...
              </div>
            ) : historyLogs.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Status Change</TableHead>
                    <TableHead>Updated By</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>{format(new Date(log.createdAt), 'PPp')}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {log.previousStatus ? (
                            <Badge variant="outline" className={cn(statusColors[log.previousStatus])}>{log.previousStatus}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">--</span>
                          )}
                          <span className="text-xs text-muted-foreground">-&gt;</span>
                          <Badge variant="outline" className={cn(statusColors[log.newStatus])}>{log.newStatus}</Badge>
                        </div>
                      </TableCell>
                      <TableCell>{log.userName}</TableCell>
                      <TableCell>{log.note || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                No history found.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <CheckDetailsDialog
        check={viewCheck}
        open={!!viewCheck}
        onOpenChange={(open) => {
          if (!open) {
            setViewCheck(null);
            resetMenuFocus();
          }
        }}
      />
    </div>
  );
}





