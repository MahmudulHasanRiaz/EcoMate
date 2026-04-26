
'use client';

import {
    Package,
    Users,
    ShoppingCart,
    Warehouse,
    Truck,
    Handshake,
    PackageCheck,
    ClipboardList,
    Clock,
    Wallet,
    Landmark,
    BarChartHorizontal,
    User,
    AlertCircle,
    MonitorSmartphone,
} from "lucide-react";
import Link from "next/link";
import * as React from 'react';
import { DateRange } from 'react-day-picker';
import { startOfDay, endOfDay } from 'date-fns';
import useSWR from 'swr';

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { getOrderSummary, getIncompleteSummary, type OrderSummaryStat, type IncompleteSummary } from "@/services/orders";
import { getBusinesses } from "@/services/partners";
import type { OrderStatus, StaffRole } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";

// Mock user role. In a real app, this would come from your auth context (e.g., Clerk session claims).
const MOCK_USER_ROLE: StaffRole = (process.env.NEXT_PUBLIC_MOCK_ROLE as StaffRole) || 'Admin'; // Change env to test roles
const isPackingAssistant = MOCK_USER_ROLE === 'Packing Assistant';

const mainQuickAccessItems = [
    {
        href: isPackingAssistant ? "/dashboard/packing-orders" : "/dashboard/orders/all",
        icon: isPackingAssistant ? ClipboardList : ShoppingCart,
        label: isPackingAssistant ? "Packing Orders" : "Orders",
        color: "text-sky-500",
        bgColor: "bg-sky-500/10"
    },
    { href: "/dashboard/products", icon: Package, label: "Products", color: "text-amber-500", bgColor: "bg-amber-500/10" },
    { href: "/dashboard/inventory", icon: Warehouse, label: "Inventory", color: "text-lime-500", bgColor: "bg-lime-500/10" },
    { href: "/dashboard/customers", icon: Users, label: "Customers", color: "text-violet-500", bgColor: "bg-violet-500/10" },
];

const secondaryQuickAccessItems = [
    { href: "/dashboard/purchases", icon: PackageCheck, label: "Purchases", color: "text-emerald-500", bgColor: "bg-emerald-500/10" },
    { href: "/dashboard/expenses", icon: Wallet, label: "Expenses", color: "text-rose-500", bgColor: "bg-rose-500/10" },
    { href: "/dashboard/check-passing", icon: Landmark, label: "Check Passing", color: "text-cyan-500", bgColor: "bg-cyan-500/10" },
    { href: "/dashboard/partners", icon: Handshake, label: "Partners", color: "text-blue-500", bgColor: "bg-blue-500/10" },
    { href: "/dashboard/courier", icon: Truck, label: "Courier", color: "text-indigo-500", bgColor: "bg-indigo-500/10" },
    { href: "/dashboard/attendance", icon: Clock, label: "Attendance", color: "text-teal-500", bgColor: "bg-teal-500/10" },
    { href: "/dashboard/issues", icon: AlertCircle, label: "Issues", color: "text-red-500", bgColor: "bg-red-500/10" },
    { href: "/dashboard/analytics", icon: BarChartHorizontal, label: "Analytics", color: "text-fuchsia-500", bgColor: "bg-fuchsia-500/10" },
    { href: "/pos", icon: MonitorSmartphone, label: "Visit POS", color: "text-slate-700 dark:text-slate-300", bgColor: "bg-slate-500/10" },
    { href: "/dashboard/staff", icon: User, label: "Staff", color: "text-pink-500", bgColor: "bg-pink-500/10" },
];


const statusColors: Partial<Record<OrderStatus, string>> = {
    'Draft': 'bg-slate-500/15 text-slate-700',
    'New': 'bg-blue-500/20 text-blue-700',
    'Confirmed': 'bg-sky-500/20 text-sky-700',
    'Confirmed Waiting': 'bg-teal-500/20 text-teal-700',
    'Packing Hold': 'bg-amber-500/20 text-amber-700',
    'Canceled': 'bg-red-500/20 text-red-700',
    'C2C': 'bg-red-500/20 text-red-700',
    'Hold': 'bg-yellow-500/20 text-yellow-700',
    'In-Courier': 'bg-orange-500/20 text-orange-700',
    'RTS (Ready to Ship)': 'bg-purple-500/20 text-purple-700',
    'Shipped': 'bg-cyan-500/20 text-cyan-700',
    'Delivered': 'bg-green-500/20 text-green-700',
    'Return Pending': 'bg-pink-500/20 text-pink-700',
    'Returned': 'bg-gray-500/20 text-gray-700',
    'Paid_Return': 'bg-gray-500/20 text-gray-700',
    'Paid Return': 'bg-gray-500/20 text-gray-700',
    'Partial': 'bg-fuchsia-500/20 text-fuchsia-700',
    'Damaged': 'bg-rose-500/20 text-rose-700',
    'Incomplete': 'bg-gray-500/20 text-gray-700',
    'Incomplete-Cancelled': 'bg-red-500/20 text-red-700',
    'No Response': 'bg-orange-400/20 text-orange-700',
};


export default function Dashboard() {
    const [dateRange, setDateRange] = React.useState<DateRange | undefined>({
        from: startOfDay(new Date()),
        to: endOfDay(new Date()),
    });
    const [businessFilter, setBusinessFilter] = React.useState('all');
    const [orderStats, setOrderStats] = React.useState<OrderSummaryStat[]>([]);
    const [incompleteStats, setIncompleteStats] = React.useState<IncompleteSummary | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);

    const { data: businesses } = useSWR('businesses', getBusinesses);

    React.useEffect(() => {
        setIsLoading(true);
        const dateParams = dateRange?.from && dateRange.to
            ? { from: startOfDay(dateRange.from).toISOString(), to: endOfDay(dateRange.to).toISOString() }
            : undefined;
        const params = {
            ...dateParams,
            ...(businessFilter !== 'all' ? { businessId: businessFilter } : {}),
        };
        const hasParams = Object.keys(params).length > 0 ? params : undefined;

        Promise.all([
            getOrderSummary(hasParams),
            getIncompleteSummary({ ...dateParams, ...(businessFilter !== 'all' ? { businessId: businessFilter } : {}) })
        ]).then(([data, incData]) => {
            setOrderStats(data);
            setIncompleteStats(incData);
            setIsLoading(false);
        });
    }, [dateRange, businessFilter]);

    const statusMap = React.useMemo(() => {
        const map = new Map<OrderStatus, OrderSummaryStat>();
        orderStats.forEach(stat => map.set(stat.status, stat));
        return map;
    }, [orderStats]);

    const topStatus = React.useMemo(() => {
        if (!orderStats.length) return null;
        const sorted = [...orderStats].sort((a, b) => b.count - a.count);
        return sorted[0];
    }, [orderStats]);

    const actionStatuses: OrderStatus[] = [
        'Draft',
        'New',
        'Confirmed',
        'Confirmed Waiting',
        'Packing Hold',
        'Canceled',
        'Hold',
        'No Response',
        'In-Courier',
        'RTS (Ready to Ship)',
        'Shipped',
        'Delivered',
        'Return Pending',
        'Returned',
        'Paid Return',
        'Partial',
        'Damaged',
    ];
    const actionItems = actionStatuses.map(status => ({
        status,
        count: statusMap.get(status)?.count ?? 0,
    }));

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 pb-24 sm:pb-6 lg:gap-6 lg:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex-1">
                    <h1 className="text-2xl font-bold font-headline">Dashboard</h1>
                    <p className="text-muted-foreground">An overview of your business operations.</p>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
                    <Select value={businessFilter} onValueChange={setBusinessFilter}>
                        <SelectTrigger className="w-full sm:w-[160px] h-9 text-sm">
                            <SelectValue placeholder="Business" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Businesses</SelectItem>
                            {(businesses || []).map((b: any) => (
                                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <DateRangePicker date={dateRange} onDateChange={setDateRange} />
                </div>
            </div>

            <div className="flex flex-col gap-6">
                <Card className="border-0 bg-transparent shadow-none">
                    <CardHeader className="px-0 pt-0 pb-3">
                        <CardTitle className="text-lg font-semibold tracking-tight text-foreground/80">Apps & Shortcuts</CardTitle>
                    </CardHeader>
                    <CardContent className="px-0 space-y-6">
                        <TooltipProvider>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                {mainQuickAccessItems.map((item) => (
                                    <Tooltip key={item.href}>
                                        <TooltipTrigger asChild>
                                            <Link href={item.href}>
                                                <div className="group relative flex flex-col items-center justify-center gap-3 rounded-2xl border bg-background/50 p-6 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-primary/20 hover:bg-background hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:hover:shadow-[0_8px_30px_rgb(255,255,255,0.02)] h-full">
                                                    <div className={cn("flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl shadow-sm ring-1 ring-inset ring-foreground/5 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3", item.bgColor, item.color)}>
                                                        <item.icon className="h-7 w-7" strokeWidth={1.75} />
                                                    </div>
                                                    <span className="text-[15px] font-semibold tracking-tight text-foreground/90 transition-colors group-hover:text-foreground">{item.label}</span>
                                                </div>
                                            </Link>
                                        </TooltipTrigger>
                                        <TooltipContent className="sm:hidden">
                                            <p>{item.label}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                ))}
                            </div>
                        </TooltipProvider>

                        <TooltipProvider>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                                {secondaryQuickAccessItems.map((item) => (
                                    <Tooltip key={item.href}>
                                        <TooltipTrigger asChild>
                                            <Link href={item.href}>
                                                <div className="group relative flex items-center gap-3 rounded-xl border bg-background/40 p-3 shadow-sm backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/20 hover:bg-background hover:shadow-md h-full">
                                                    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ring-1 ring-inset ring-foreground/5 transition-transform duration-200 group-hover:scale-105", item.bgColor, item.color)}>
                                                        <item.icon className="h-5 w-5" strokeWidth={2} />
                                                    </div>
                                                    <span className="text-sm font-medium leading-tight tracking-tight text-muted-foreground transition-colors group-hover:text-foreground line-clamp-2">{item.label}</span>
                                                </div>
                                            </Link>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom" className="sm:hidden">
                                            <p>{item.label}</p>
                                        </TooltipContent>
                                    </Tooltip>
                                ))}
                            </div>
                        </TooltipProvider>
                    </CardContent>
                </Card>

                <Card className="border-primary/10 bg-gradient-to-br from-background to-muted/30 shadow-sm">
                    <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle>Action Center</CardTitle>
                            <CardDescription>Jump into the most important queues right now.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            {topStatus && (
                                <Badge variant="outline" className={cn("w-fit shadow-sm", statusColors[topStatus.status] || "bg-muted/60 text-muted-foreground")}>
                                    Top: {topStatus.status} ({topStatus.count})
                                </Badge>
                            )}
                            <Badge variant="outline" className="w-fit shadow-sm bg-primary/10 text-primary">
                                Total Orders: {dateRange?.from && dateRange?.to 
                                    ? (orderStats.find(s => s.status === 'New')?.count ?? 0)
                                    : orderStats.reduce((sum, s) => sum + s.count, 0)}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {isLoading ? (
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {actionItems.map(item => (
                                    <Skeleton key={item.status} className="h-[84px] w-full" />
                                ))}
                            </div>
                        ) : (
                            <>
                                {incompleteStats && (
                                    <Link href="/dashboard/orders/incomplete" className="block mb-6">
                                        <Card className="border-red-500/20 bg-red-500/5 shadow-sm transition-all hover:bg-red-500/10 hover:shadow-md hover:border-red-500/30">
                                            <CardContent className="p-4 flex items-center justify-between gap-4">
                                                <div className="space-y-2 flex-1">
                                                    <Badge variant="outline" className="w-fit bg-red-500/20 text-red-700">Incomplete Leads</Badge>
                                                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground mt-1">
                                                        <span>Open Now: <strong className="text-foreground">{incompleteStats.openNow}</strong></span>
                                                        <span>Converted: <strong className="text-foreground">{incompleteStats.converted}</strong></span>
                                                        <span>Failed: <strong className="text-foreground">{incompleteStats.notConverted}</strong></span>
                                                        <span>Ratio: <strong className="text-foreground">{incompleteStats.successRatioPct}%</strong></span>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-lg font-bold text-red-700">{incompleteStats.totalLeads}</p>
                                                    <span className="text-xs text-muted-foreground">Total Leads</span>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </Link>
                                )}
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {actionItems.map(item => (
                                        <Link key={item.status} href={`/dashboard/orders?status=${encodeURIComponent(item.status)}`} className="block">
                                            <Card className="h-full border-primary/10 shadow-sm transition-all hover:bg-muted/50 hover:shadow-md hover:border-primary/30">
                                                <CardContent className="p-4 flex items-center justify-between gap-4">
                                                    <div className="space-y-2">
                                                        <Badge variant="outline" className={cn("w-fit", statusColors[item.status] || "bg-muted/60 text-muted-foreground")}>
                                                            {item.status}
                                                        </Badge>
                                                        <p className="text-xs text-muted-foreground">View orders</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-lg font-bold">{item.count}</p>
                                                        <span className="text-xs text-muted-foreground">orders</span>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        </Link>
                                    ))}
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>


            </div>
        </div>
    );
}
