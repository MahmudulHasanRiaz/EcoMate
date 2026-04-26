'use client';

import * as React from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import { startOfDay, endOfDay, subDays, format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useUser } from '@clerk/nextjs';
import type { StaffRole } from '@/types';
import { Printer } from 'lucide-react';
import useSWR from 'swr';
import { getBusinesses } from '@/services/partners';

type IncompleteStats = {
    totalLeads: number;
    converted: number;
    notConverted: number;
    canceled: number;
    conversionRatio: number;
};

type IncompleteBusinessRow = IncompleteStats & { id: string; name: string };

type SaleReportData = {
    overall: Record<string, number>;
    businessData: { id: string, name: string, counts: Record<string, number> }[];
    incomplete: {
        overall: IncompleteStats;
        businessData: IncompleteBusinessRow[];
    };
    metadata: { from?: string, to?: string, businessId?: string, generatedAt: string };
};

const fetcher = (url: string) => fetch(url).then(res => res.json()).then(res => res.data);

const PRESETS = [
    { label: 'Today', getValue: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
    { label: 'Yesterday', getValue: () => ({ from: startOfDay(subDays(new Date(), 1)), to: endOfDay(subDays(new Date(), 1)) }) },
    { label: 'Last 7 Days', getValue: () => ({ from: startOfDay(subDays(new Date(), 7)), to: endOfDay(new Date()) }) },
    { label: 'Last 30 Days', getValue: () => ({ from: startOfDay(subDays(new Date(), 30)), to: endOfDay(new Date()) }) },
    { label: 'Custom', getValue: () => undefined },
];

export default function SaleReportPage() {
    const { user, isLoaded } = useUser();
    const [preset, setPreset] = React.useState<string>('Today');
    const [dateRange, setDateRange] = React.useState<DateRange | undefined>(PRESETS[0].getValue());
    const [businessFilter, setBusinessFilter] = React.useState<string>('all');
    const [businesses, setBusinesses] = React.useState<{ id: string, name: string }[]>([]);

    React.useEffect(() => {
        getBusinesses().then(res => setBusinesses(Array.isArray(res) ? res : []));
    }, []);

    const handlePresetChange = (v: string) => {
        setPreset(v);
        const p = PRESETS.find(x => x.label === v);
        if (p && p.getValue()) {
            setDateRange(p.getValue());
        }
    };

    const handleDateChange = (range: DateRange | undefined) => {
        setDateRange(range);
        setPreset('Custom');
    };

    const qs = new URLSearchParams();
    if (dateRange?.from) qs.set('from', dateRange.from.toISOString());
    if (dateRange?.to) qs.set('to', dateRange.to.toISOString());
    if (businessFilter !== 'all') {
        qs.set('businessId', businessFilter);
    }

    const { data, isLoading, error } = useSWR<SaleReportData>(
        `/api/orders/sale-report?${qs.toString()}`,
        fetcher
    );

    const role = user?.publicMetadata?.role as StaffRole;
    const hasAccess = role === 'Admin' || role === 'Manager';

    const handlePrint = () => {
        window.print();
    };

    if (!isLoaded || (user && user.publicMetadata?.status === 'loading')) return <div className="p-6">Loading...</div>;
    if (!user || !hasAccess) return <div className="p-6 text-red-500">Access Denied</div>;

    const targetStatuses = ['Confirmed', 'Canceled', 'Hold', 'Returned', 'Delivered', 'Incomplete Converted'];
    const inc = data?.incomplete?.overall;

    return (
        <div className="flex min-h-full w-full flex-1 flex-col gap-4 p-4 pb-24 lg:gap-6 lg:p-6 lg:pb-8 print:m-0 print:gap-3 print:bg-white print:px-4 print:py-3 print:text-black">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 print:hidden">
                <div>
                    <h1 className="text-2xl font-bold font-headline">Sale Report</h1>
                    <p className="text-muted-foreground">Activity-based metrics for Confirmed, Canceled, Hold, Returned, Delivered, and Incomplete Converted orders.</p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <Select value={preset} onValueChange={handlePresetChange}>
                        <SelectTrigger className="w-full sm:w-[150px]">
                            <SelectValue placeholder="Select period" />
                        </SelectTrigger>
                        <SelectContent>
                            {PRESETS.map(p => <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>)}
                        </SelectContent>
                    </Select>

                    {preset === 'Custom' && (
                        <div className="w-full sm:w-auto">
                            <DateRangePicker date={dateRange} onDateChange={handleDateChange} />
                        </div>
                    )}

                    <Select value={businessFilter} onValueChange={setBusinessFilter}>
                        <SelectTrigger className="w-full sm:w-[150px]">
                            <SelectValue placeholder="All Businesses" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Businesses</SelectItem>
                            {businesses.map((b) => (
                                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Button onClick={handlePrint} variant="outline" className="w-full gap-2 sm:w-auto">
                        <Printer className="w-4 h-4" />
                        <span>Print / PDF</span>
                    </Button>
                </div>
            </div>

            {/* Print Header */}
            <div className="mb-5 hidden print:block">
                <div className="overflow-hidden rounded-sm border border-slate-300 bg-white">
                    <div className="border-b border-slate-300 px-4 py-3">
                        <h1 className="text-3xl font-bold leading-none tracking-tight">Sale Report</h1>
                        <p className="mt-1 text-xs text-slate-600">
                            Status-wise sales activity summary
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 text-sm">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Date Range</p>
                            <p className="font-medium text-slate-900">
                                {dateRange?.from ? format(dateRange.from, 'PPp') : 'Beginning'} - {dateRange?.to ? format(dateRange.to, 'PPp') : 'Now'}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Business</p>
                            <p className="font-medium text-slate-900">
                                {businessFilter === 'all' ? 'All Businesses' : businesses.find(b => b.id === businessFilter)?.name || businessFilter}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Generated At</p>
                            <p className="font-medium text-slate-900">
                                {data?.metadata.generatedAt ? format(new Date(data.metadata.generatedAt), 'PPp') : '-'}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Generated By</p>
                            <p className="font-medium text-slate-900">{user?.firstName || user?.fullName || 'User'}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="space-y-6">
                {/* Overall Status Activity */}
                <Card className="print:break-inside-avoid print:rounded-none print:border print:border-slate-200 print:shadow-none">
                    <CardHeader className="print:px-4 print:pb-3">
                        <CardTitle>Overall Status Activity</CardTitle>
                    </CardHeader>
                    <CardContent className="print:px-4 print:pt-0">
                        {error ? (
                            <div className="text-red-500 py-4">Failed to load report data.</div>
                        ) : (
                            <div className="rounded-md border print:rounded-none print:border-slate-200">
                                <Table className="min-w-[560px]">
                                    <TableHeader>
                                        <TableRow>
                                            {targetStatuses.map(status => (
                                                <TableHead key={status} className="text-center">{status}</TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isLoading ? (
                                            <TableRow>
                                                {targetStatuses.map(s => <TableCell key={s}><Skeleton className="h-4 w-full" /></TableCell>)}
                                            </TableRow>
                                        ) : (
                                            <TableRow>
                                                {targetStatuses.map(status => (
                                                    <TableCell key={status} className="text-center font-semibold text-lg">
                                                        {data?.overall?.[status] || 0}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Business Breakdown (Order Activity) */}
                {data && data.businessData.length > 0 && (
                    <Card className="print:break-inside-avoid print:rounded-none print:border print:border-slate-200 print:shadow-none">
                        <CardHeader className="print:px-4 print:pb-3">
                            <CardTitle>Business Breakdown</CardTitle>
                        </CardHeader>
                        <CardContent className="print:px-4 print:pt-0">
                            <div className="rounded-md border print:rounded-none print:border-slate-200">
                                <Table className="min-w-[720px]">
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Business Name</TableHead>
                                            {targetStatuses.map(status => (
                                                <TableHead key={status} className="text-right">{status}</TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.businessData.map((b) => (
                                            <TableRow key={b.id} className="print:break-inside-avoid">
                                                <TableCell className="font-medium">{b.name}</TableCell>
                                                {targetStatuses.map(status => (
                                                    <TableCell key={status} className="text-right">
                                                        {b.counts[status] || 0}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Incomplete Conversion Insight */}
                <Card className="print:break-inside-avoid print:rounded-none print:border print:border-slate-200 print:shadow-none">
                    <CardHeader className="print:px-4 print:pb-3">
                        <CardTitle>Incomplete Conversion Insight</CardTitle>
                        <CardDescription>Conversion metrics from incomplete checkout leads within the selected period.</CardDescription>
                    </CardHeader>
                    <CardContent className="print:px-4 print:pt-0">
                        {isLoading ? (
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <div key={i} className="rounded-lg border p-4">
                                        <Skeleton className="h-3 w-20 mb-2" />
                                        <Skeleton className="h-7 w-16" />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                                <div className="rounded-lg border p-4">
                                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Leads</p>
                                    <p className="text-2xl font-bold mt-1">{inc?.totalLeads ?? 0}</p>
                                </div>
                                <div className="rounded-lg border border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/30 p-4">
                                    <p className="text-xs text-green-700 dark:text-green-400 font-medium uppercase tracking-wide">Converted</p>
                                    <p className="text-2xl font-bold text-green-700 dark:text-green-400 mt-1">{inc?.converted ?? 0}</p>
                                </div>
                                <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30 p-4">
                                    <p className="text-xs text-amber-700 dark:text-amber-400 font-medium uppercase tracking-wide">Not Converted</p>
                                    <p className="text-2xl font-bold text-amber-700 dark:text-amber-400 mt-1">{inc?.notConverted ?? 0}</p>
                                </div>
                                <div className="rounded-lg border border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30 p-4">
                                    <p className="text-xs text-red-700 dark:text-red-400 font-medium uppercase tracking-wide">Canceled</p>
                                    <p className="text-2xl font-bold text-red-700 dark:text-red-400 mt-1">{inc?.canceled ?? 0}</p>
                                </div>
                                <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30 p-4">
                                    <p className="text-xs text-blue-700 dark:text-blue-400 font-medium uppercase tracking-wide">Conversion %</p>
                                    <p className="text-2xl font-bold text-blue-700 dark:text-blue-400 mt-1">{inc?.conversionRatio ?? 0}%</p>
                                </div>
                            </div>
                        )}

                        {/* Per-business incomplete breakdown */}
                        {data?.incomplete?.businessData && data.incomplete.businessData.length > 0 && (
                            <div className="rounded-md border mt-5 print:rounded-none print:border-slate-200">
                                <Table className="min-w-[700px]">
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Business Name</TableHead>
                                            <TableHead className="text-right">Total Leads</TableHead>
                                            <TableHead className="text-right text-green-700 dark:text-green-400">Converted</TableHead>
                                            <TableHead className="text-right text-amber-700 dark:text-amber-400">Not Converted</TableHead>
                                            <TableHead className="text-right text-red-700 dark:text-red-400">Canceled</TableHead>
                                            <TableHead className="text-right text-blue-700 dark:text-blue-400">Conversion %</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {data.incomplete.businessData.map((b) => (
                                            <TableRow key={b.id} className="print:break-inside-avoid">
                                                <TableCell className="font-medium">{b.name}</TableCell>
                                                <TableCell className="text-right font-semibold">{b.totalLeads}</TableCell>
                                                <TableCell className="text-right text-green-700 dark:text-green-400">{b.converted}</TableCell>
                                                <TableCell className="text-right text-amber-700 dark:text-amber-400">{b.notConverted}</TableCell>
                                                <TableCell className="text-right text-red-700 dark:text-red-400">{b.canceled}</TableCell>
                                                <TableCell className="text-right text-blue-700 dark:text-blue-400 font-semibold">{b.conversionRatio}%</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
