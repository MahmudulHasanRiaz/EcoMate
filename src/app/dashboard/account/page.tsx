
'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useUser, useClerk } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
    CardDescription,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Save, Edit, User as UserIcon, Briefcase, DollarSign, BarChart2, Loader2, TrendingUp, TrendingDown, AlertCircle, CheckCircle, XCircle, PlusCircle, Clock, KeyRound, ChevronLeft, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ChartConfig } from '@/components/ui/chart';
import { getStaffMemberByClerkId, getStaffMemberById } from '@/services/staff';
import type { StaffMemberUI, OrderStatus, StaffIncome, StaffPayment, StaffFine } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { endOfDay, format, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { useAuthErrorHandler } from "@/hooks/use-auth-error-handler";

function formatIncomeNote(note?: string | null) {
    if (!note) return '-';
    // Match "Overtime <any_number>min"
    const match = note.match(/^Overtime\s+(\d+)min$/i);
    if (match) {
        const mins = parseInt(match[1], 10);
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `Overtime ${h}h ${m}m`;
    }
    return note;
}

function formatHistoryDate(dateStr: string | Date, action?: string, frequency?: string) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'N/A';
    if (action === 'Salary' && frequency) {
        if (frequency === 'Monthly') {
            const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
            return `${format(d, 'MMM d')} -> ${format(lastDay, 'MMM d, yyyy')}`;
        } else if (frequency === 'Weekly') {
            const endDate = new Date(d);
            endDate.setDate(d.getDate() + 6);
            return `${format(d, 'MMM d')} -> ${format(endDate, 'MMM d, yyyy')}`;
        }
    }
    return format(d, 'PP');
}

const ChartContainer = dynamic(
    () => import('@/components/ui/chart').then((mod) => mod.ChartContainer),
    { ssr: false, loading: () => <Skeleton className="h-[240px] w-full" /> }
);
const ChartTooltip = dynamic(
    () => import('@/components/ui/chart').then((mod) => mod.ChartTooltip),
    { ssr: false }
);
const ChartTooltipContent = dynamic(
    () => import('@/components/ui/chart').then((mod) => mod.ChartTooltipContent),
    { ssr: false }
);
const ChartLegend = dynamic(
    () => import('@/components/ui/chart').then((mod) => mod.ChartLegend),
    { ssr: false }
);
const ChartLegendContent = dynamic(
    () => import('@/components/ui/chart').then((mod) => mod.ChartLegendContent),
    { ssr: false }
);

const PieChart = dynamic(
    () => import('recharts').then((mod) => mod.PieChart),
    { ssr: false, loading: () => <Skeleton className="h-[200px] w-full" /> }
) as any;
const Pie = dynamic(() => import('recharts').then((mod) => mod.Pie), { ssr: false }) as any;
const Cell = dynamic(() => import('recharts').then((mod) => mod.Cell), { ssr: false }) as any;

const chartColors = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
];

const PerformanceStatCard = ({ title, value, icon: Icon, iconClass }: { title: string, value: string | number, icon?: React.ElementType, iconClass?: string }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            {Icon && <Icon className={cn("h-4 w-4 text-muted-foreground", iconClass)} />}
        </CardHeader>
        <CardContent>
            <div className="text-2xl font-bold">{value}</div>
        </CardContent>
    </Card>
);

function HistoryDialog({ title, children, data, frequency }: { title: string, children: React.ReactNode, data: StaffIncome[] | StaffPayment[], frequency?: string }) {
    return (
        <Dialog>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto">
                    {data && data.length > 0 ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    {'orderId' in data[0] && <TableHead>Order No</TableHead>}
                                    {'action' in data[0] && <TableHead>Action</TableHead>}
                                    <TableHead>Notes</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.map((item, index) => (
                                    <TableRow key={index}>
                                        <TableCell>{formatHistoryDate(item.date, 'action' in item ? item.action : undefined, frequency)}</TableCell>
                                        {'orderId' in item && item.orderId && (
                                            <TableCell>{(item as StaffIncome).orderNumber || item.orderId}</TableCell>
                                        )}
                                        {'action' in item && item.action && <TableCell><Badge variant="secondary">{item.action}</Badge></TableCell>}
                                        <TableCell>{'notes' in item ? formatIncomeNote(item.notes) : '-'}</TableCell>
                                        <TableCell className="text-right font-mono">৳{item.amount.toLocaleString()}</TableCell>
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
    );
}

function FineHistoryDialog({ title, children, data }: { title: string, children: React.ReactNode, data: StaffFine[] }) {
    return (
        <Dialog>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto">
                    {data && data.length > 0 ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Reason</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.map((fine) => (
                                    <TableRow key={fine.id}>
                                        <TableCell>{format(new Date(fine.date), 'PP')}</TableCell>
                                        <TableCell>
                                            <div className="font-medium">{fine.reason}</div>
                                            {fine.notes && <div className="text-xs text-muted-foreground">{fine.notes}</div>}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={fine.status === 'Active' ? 'outline' : 'secondary'}>
                                                {fine.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-mono font-bold text-destructive">
                                            Tk {fine.amount.toLocaleString()}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <div className="text-center text-muted-foreground py-8">
                            No fine records found.
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default function AccountPage() {
    const { toast } = useToast();
    const { user: clerkUser, isLoaded } = useUser();
    const { openUserProfile } = useClerk();
    const { handleError } = useAuthErrorHandler();
    const [loggedInStaff, setLoggedInStaff] = React.useState<StaffMemberUI | null>(null);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isSaving, setIsSaving] = React.useState(false);

    const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);

    const activePeriod = React.useMemo(() => {
        const from = dateRange?.from;
        const to = dateRange?.to ?? dateRange?.from;
        if (!from || !to) return undefined;
        return {
            from: startOfDay(from).toISOString(),
            to: endOfDay(to).toISOString(),
        };
    }, [dateRange]);

    const periodLabel = React.useMemo(() => {
        const from = dateRange?.from;
        const to = dateRange?.to ?? dateRange?.from;
        if (!from || !to) return 'All time';
        const fromKey = format(from, 'yyyy-MM-dd');
        const toKey = format(to, 'yyyy-MM-dd');
        if (fromKey === toKey) return format(from, 'MMM d, yyyy');
        return `${format(from, 'MMM d, yyyy')} - ${format(to, 'MMM d, yyyy')}`;
    }, [dateRange]);

    React.useEffect(() => {
        const load = async () => {
            if (!isLoaded) return;
            if (!clerkUser) {
                setIsLoading(false);
                return;
            }
            setIsLoading(true);

            const period = activePeriod;

            try {
                // Try by clerkId first with period
                let staff = await getStaffMemberByClerkId(clerkUser.id, period);

                // Fallback: if metadata has staffId, fetch by staffId
                if (!staff && clerkUser.publicMetadata?.staffId) {
                    staff = await getStaffMemberById(clerkUser.publicMetadata.staffId as string, period);
                }
                if (staff) {
                    setLoggedInStaff(staff);
                }
            } catch (error) {
                console.error('[ACCOUNT_PAGE] Failed to load staff profile', error);
                await handleError(error);
            }
            setIsLoading(false);
        };
        load();
    }, [isLoaded, clerkUser, activePeriod]);

    const nonTerminalStatuses = ['Draft', 'Incomplete', 'Incomplete-Cancelled'];
    const performanceChartData = React.useMemo(() => {
        if (!loggedInStaff || !loggedInStaff.performance) return [];
        return Object.entries(loggedInStaff.performance.statusBreakdown)
            .filter(([status, value]) => value > 0 && !nonTerminalStatuses.includes(status))
            .map(([status, value], index) => ({
                status: status as OrderStatus,
                value,
                fill: chartColors[index % chartColors.length]
            }));
    }, [loggedInStaff]);

    const chartConfig: ChartConfig = React.useMemo(() => {
        if (!performanceChartData) return {};
        return performanceChartData.reduce((acc, { status, fill }) => {
            acc[status] = { label: status, color: fill };
            return acc;
        }, {} as ChartConfig);
    }, [performanceChartData]);

    const stats = React.useMemo(() => {
        if (!loggedInStaff) return {
            createdTotal: 0, createdConfirmed: 0, createdCanceled: 0, createdDelivered: 0, createdReturned: 0,
            createdConfirmationRate: 0, createdCancellationRate: 0, createdDeliveryRate: 0, createdReturnRate: 0,

            confirmedTotal: 0, confirmedDelivered: 0, confirmedReturned: 0, confirmedCanceled: 0,
            deliveryRate: 0, returnRate: 0, confirmedCancellationRate: 0,

            incompleteWorked: 0, incompleteConverted: 0, incompleteConversionRate: 0,
            ordersWorked: 0, totalActions: 0, combinedCancellationRate: 0, combinedDeliveryRate: 0,
            terminalOrders: 0, totalDistinctOrders: 0
        };

        const { performance } = loggedInStaff;

        // 1. Creation Metrics
        const createdTotal = performance.ordersCreated || 0;
        const createdStats = performance.createdStatusBreakdown || {};
        const createdConfirmed = createdStats['Confirmed'] || 0;
        const createdCanceled = createdStats['Canceled'] || 0;
        const createdDelivered = createdStats['Delivered'] || 0;
        const createdReturned = (createdStats['Returned'] || 0) + (createdStats['Paid_Return'] || 0);

        const createdConfirmationRate = createdTotal > 0 ? (createdConfirmed / createdTotal) * 100 : 0;
        const createdCancellationRate = createdTotal > 0 ? (createdCanceled / createdTotal) * 100 : 0;
        // Delivery rate from Created orders
        const createdDeliveryRate = createdTotal > 0 ? (createdDelivered / createdTotal) * 100 : 0;
        const createdReturnRate = createdTotal > 0 ? (createdReturned / createdTotal) * 100 : 0;


        // 2. Confirmation Metrics (Processing)
        const confirmedTotal = performance.ordersConfirmed || 0;
        const confirmedStats = performance.confirmedStatusBreakdown || {};
        const confirmedDelivered = confirmedStats['Delivered'] || 0;
        const confirmedReturned = (confirmedStats['Returned'] || 0) + (confirmedStats['Paid_Return'] || 0);
        const confirmedCanceled = confirmedStats['Canceled'] || 0;

        const deliveryRate = confirmedTotal > 0 ? (confirmedDelivered / confirmedTotal) * 100 : 0;
        const returnRate = confirmedTotal > 0 ? (confirmedReturned / confirmedTotal) * 100 : 0;
        const confirmedCancellationRate = confirmedTotal > 0 ? (confirmedCanceled / confirmedTotal) * 100 : 0;

        // 3. Incomplete Metrics (separate from Created/Confirmed)
        const incompleteWorked = performance.incompleteWorked || 0;
        const incompleteConverted = performance.incompleteConverted || 0;
        const incompleteConversionRate = incompleteWorked > 0
            ? (incompleteConverted / incompleteWorked) * 100
            : 0;

        // 4. Overall — use statusBreakdown (distinct orders, no double-count)
        const statusBd = performance.statusBreakdown || {};
        const totalDistinctOrders = Object.values(statusBd).reduce((sum, v) => sum + v, 0);
        const deliveredOrders = statusBd['Delivered'] || 0;
        const returnedOrders = (statusBd['Returned'] || 0) + (statusBd['Paid_Return'] || 0);
        const canceledOrders = statusBd['Canceled'] || 0;
        const terminalOrders = deliveredOrders + returnedOrders + canceledOrders;

        const combinedDeliveryRate = (deliveredOrders + returnedOrders) > 0
            ? (deliveredOrders / (deliveredOrders + returnedOrders)) * 100
            : 0;
        const combinedCancellationRate = terminalOrders > 0
            ? (canceledOrders / terminalOrders) * 100
            : 0;

        return {
            createdTotal,
            createdConfirmed,
            createdCanceled,
            createdDelivered,
            createdReturned,
            createdConfirmationRate,
            createdCancellationRate,
            createdDeliveryRate,
            createdReturnRate,

            confirmedTotal,
            confirmedDelivered,
            confirmedReturned,
            confirmedCanceled,
            deliveryRate,
            returnRate,
            confirmedCancellationRate,

            incompleteWorked,
            incompleteConverted,
            incompleteConversionRate,

            ordersWorked: performance.ordersWorked ?? totalDistinctOrders,
            totalActions: performance.totalOrderActions ?? totalDistinctOrders,
            combinedCancellationRate,
            combinedDeliveryRate,
            terminalOrders,
            totalDistinctOrders
        };
    }, [loggedInStaff]);

    if (isLoading || !isLoaded) {
        return (
            <div className="flex-1 space-y-6 p-4 lg:p-6">
                <Skeleton className="h-12 w-1/3" />
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                    <div className="lg:col-span-2 grid gap-6">
                        <Skeleton className="h-56" />
                        <Skeleton className="h-64" />
                    </div>
                </div>
            </div>
        );
    }

    if (!loggedInStaff) {
        return (
            <div className="flex-1 space-y-6 p-4 lg:p-6 text-center">
                <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
                <h2 className="mt-4 text-xl font-semibold">Staff Profile Not Found</h2>
                <p className="mt-2 text-muted-foreground">We couldn't find a staff profile associated with your account.</p>
            </div>
        )
    }

    return (
        <div className="flex-1 space-y-6 p-4 lg:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold font-headline">My Account</h1>
                    <p className="text-muted-foreground">
                        Performance report for <span className="font-medium text-foreground">{periodLabel}</span>.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <DateRangePicker
                        date={dateRange}
                        onDateChange={setDateRange}
                        placeholder="Filter by date"
                        className="w-full sm:w-auto"
                    />
                    <Button variant="outline" size="icon" onClick={() => openUserProfile()}>
                        <Edit className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2 space-y-6">
                    {/* Performance Metrics could go here, but focusing on the requested sections */}

                    {/* Placeholder for performance metrics if needed, as seen on Staff View */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                        {/* Redesigning existing metrics into the cards from staff view if applicable */}
                        {/* Card 2: Creation Performance */}
                        <Card className="h-full shadow-md rounded-xl border-border/60 overflow-hidden">
                            <CardHeader className="bg-muted/10 pb-4">
                                <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground/80">
                                    <PlusCircle className="h-5 w-5 text-blue-600" />
                                    Creation Performance
                                </CardTitle>
                                <CardDescription className="text-[11px]">Metrics based on orders you created.</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="flex items-baseline justify-between mb-4 border-b border-border/40 pb-4">
                                    <div className="space-y-1">
                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Created</span>
                                        <div className="text-3xl font-extrabold text-foreground">{stats.createdTotal}</div>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Success Rate</span>
                                        <div className="text-xl font-bold text-green-600">{stats.createdDeliveryRate.toFixed(1)}%</div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        <div className="bg-blue-50/50 p-2 rounded-lg border border-blue-100">
                                            <div className="text-lg font-bold text-blue-700">{stats.createdConfirmed}</div>
                                            <div className="text-[9px] uppercase font-bold text-blue-600/70">Confirmed</div>
                                        </div>
                                        <div className="bg-green-50/50 p-2 rounded-lg border border-green-100">
                                            <div className="text-lg font-bold text-green-700">{stats.createdDelivered}</div>
                                            <div className="text-[9px] uppercase font-bold text-green-600/70">Delivered</div>
                                        </div>
                                        <div className="bg-red-50/50 p-2 rounded-lg border border-red-100">
                                            <div className="text-lg font-bold text-red-700">{stats.createdReturned}</div>
                                            <div className="text-[9px] uppercase font-bold text-red-600/70">Returned</div>
                                        </div>
                                    </div>
                                    <Progress value={stats.createdDeliveryRate} className="h-1.5 bg-muted/50" />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Card 1: Confirmation Performance */}
                        <Card className="h-full shadow-md rounded-xl border-border/60 overflow-hidden">
                            <CardHeader className="bg-muted/10 pb-4">
                                <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground/80">
                                    <CheckCircle className="h-5 w-5 text-sky-600" />
                                    Confirmation Performance
                                </CardTitle>
                                <CardDescription className="text-[11px]">Metrics based on orders you confirmed.</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="flex items-baseline justify-between mb-4 border-b border-border/40 pb-4">
                                    <div className="space-y-1">
                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Confirmed</span>
                                        <div className="text-3xl font-extrabold text-foreground">{stats.confirmedTotal}</div>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Success Rate</span>
                                        <div className="text-xl font-bold text-green-600">{stats.deliveryRate.toFixed(1)}%</div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="grid grid-cols-3 gap-2 text-center">
                                        <div className="bg-gray-50/50 p-2 rounded-lg border border-gray-100">
                                            <div className="text-lg font-bold text-gray-700">{stats.confirmedCanceled}</div>
                                            <div className="text-[9px] uppercase font-bold text-gray-600/70">Canceled</div>
                                        </div>
                                        <div className="bg-green-50/50 p-2 rounded-lg border border-green-100">
                                            <div className="text-lg font-bold text-green-700">{stats.confirmedDelivered}</div>
                                            <div className="text-[9px] uppercase font-bold text-green-600/70">Delivered</div>
                                        </div>
                                        <div className="bg-red-50/50 p-2 rounded-lg border border-red-100">
                                            <div className="text-lg font-bold text-red-700">{stats.confirmedReturned}</div>
                                            <div className="text-[9px] uppercase font-bold text-red-600/70">Returned</div>
                                        </div>
                                    </div>
                                    <Progress value={stats.deliveryRate} className="h-1.5 bg-muted/50" />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Card 3: Incomplete Performance */}
                        <Card className="h-full shadow-md rounded-xl border-border/60 overflow-hidden">
                            <CardHeader className="bg-muted/10 pb-4">
                                <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground/80">
                                    <Clock className="h-5 w-5 text-amber-600" />
                                    Incomplete Performance
                                </CardTitle>
                                <CardDescription className="text-[11px]">Lead handling from incomplete orders only.</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="flex items-baseline justify-between mb-4 border-b border-border/40 pb-4">
                                    <div className="space-y-1">
                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Worked</span>
                                        <div className="text-3xl font-extrabold text-foreground">{stats.incompleteWorked}</div>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Conversion Rate</span>
                                        <div className="text-xl font-bold text-green-600">{stats.incompleteConversionRate.toFixed(1)}%</div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-2 text-center">
                                        <div className="bg-amber-50/50 p-2 rounded-lg border border-amber-100">
                                            <div className="text-lg font-bold text-amber-700">{stats.incompleteWorked}</div>
                                            <div className="text-[9px] uppercase font-bold text-amber-600/70">Worked</div>
                                        </div>
                                        <div className="bg-green-50/50 p-2 rounded-lg border border-green-100">
                                            <div className="text-lg font-bold text-green-700">{stats.incompleteConverted}</div>
                                            <div className="text-[9px] uppercase font-bold text-green-600/70">Converted</div>
                                        </div>
                                    </div>
                                    <Progress value={stats.incompleteConversionRate} className="h-1.5 bg-muted/50" />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Overall Efficiency Banner */}
                    <Card className="shadow-md rounded-xl border-border/60 overflow-hidden bg-gradient-to-br from-background to-muted/20">
                        <CardContent className="p-6">
                            <div className="flex flex-col sm:flex-row items-center gap-8">
                                <div className="flex items-center gap-4 flex-1">
                                    <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 shadow-sm shrink-0">
                                        <BarChart2 className="h-6 w-6" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-foreground">Overall Efficiency</h3>
                                        <p className="text-sm text-muted-foreground">Aggregate performance across all actions.</p>
                                    </div>
                                </div>

                                <Separator orientation="vertical" className="hidden sm:block h-12 bg-border/60" />

                                <div className="flex items-center gap-8 flex-shrink-0 flex-wrap justify-center">
                                    <div className="text-center">
                                        <div className="text-3xl font-bold text-foreground">{stats.ordersWorked}</div>
                                        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mt-0.5">Orders Worked</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-3xl font-bold text-sky-600">{stats.totalActions}</div>
                                        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mt-0.5">Action Events</div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-3xl font-bold text-green-600">{stats.combinedDeliveryRate.toFixed(1)}%</div>
                                        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mt-0.5">Overall Success</div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Sidebar Column (1/3) */}
                <aside className="space-y-6">

                    {/* 1. Profile Card */}
                    <Card className="shadow-md rounded-xl border-border/60 overflow-hidden">
                        <CardHeader className="flex flex-row items-center gap-4 space-y-0 bg-muted/10 pb-4">
                            <User className="w-5 h-5 text-muted-foreground" />
                            <CardTitle className="text-base">Profile</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Staff Code</div>
                                    <div className="text-sm font-semibold truncate">{loggedInStaff.staffCode}</div>
                                </div>
                                <div className="space-y-1">
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Designation</div>
                                    <div className="text-sm font-semibold truncate">{loggedInStaff.designation || 'N/A'}</div>
                                </div>
                                <div className="space-y-1 col-span-2">
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Join Date</div>
                                    <div className="text-sm font-semibold">
                                        {(() => {
  const raw = loggedInStaff.jobStartDate ?? loggedInStaff.createdAt;
  if (!raw) return 'N/A';
  const d = new Date(raw);
  return isNaN(d.getTime()) ? 'N/A' : format(d, 'MMM d, yyyy');
})()}
                                    </div>
                                </div>
                            </div>
                            <Separator className="opacity-40" />
                            <div className="flex justify-between items-center">
                                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Role Assignment</div>
                                <Badge variant="secondary" className="font-bold">{loggedInStaff.role}</Badge>
                            </div>
                        </CardContent>
                    </Card>

                    {/* 2. Compensation Card */}
                    <Card className="shadow-md rounded-xl border-border/60 overflow-hidden">
                        <CardHeader className="flex flex-row items-center gap-4 space-y-0 bg-muted/10 pb-4">
                            <Briefcase className="w-5 h-5 text-muted-foreground" />
                            <CardTitle className="text-base">Compensation</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-4">
                            <div className="bg-muted/20 rounded-lg p-3 border border-border/40">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-xs text-muted-foreground font-medium">{loggedInStaff.paymentType === 'Salary' || loggedInStaff.paymentType === 'Both' ? loggedInStaff.salaryDetails?.frequency || 'Monthly' : 'Commission Based'} Salary</span>
                                    <span className="text-lg font-bold">
                                        Tk {(loggedInStaff.salaryDetails?.amount || 0).toLocaleString()}
                                    </span>
                                </div>
                                <Progress value={100} className="h-1 bg-muted" />
                            </div>
                            <div className="space-y-2 px-1">
                                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Commission Policy (Rates)</div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="flex justify-between p-2 rounded bg-muted/30">
                                        <span className="text-muted-foreground">Create:</span>
                                        <span className="font-mono font-bold">Tk {loggedInStaff.commissionDetails?.onOrderCreate || 0}</span>
                                    </div>
                                    <div className="flex justify-between p-2 rounded bg-muted/30">
                                        <span className="text-muted-foreground">Confirm:</span>
                                        <span className="font-mono font-bold">Tk {loggedInStaff.commissionDetails?.onOrderConfirm || 0}</span>
                                    </div>
                                    <div className="flex justify-between p-2 rounded bg-muted/30">
                                        <span className="text-muted-foreground">Pack:</span>
                                        <span className="font-mono font-bold">Tk {loggedInStaff.commissionDetails?.onOrderPacked || 0}</span>
                                    </div>
                                    <div className="flex justify-between p-2 rounded bg-muted/30">
                                        <span className="text-muted-foreground">Convert:</span>
                                        <span className="font-mono font-bold">Tk {loggedInStaff.commissionDetails?.onOrderConvert || 0}</span>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* 3. Financials Card */}
                    <Card className="shadow-md rounded-xl border-border/60 overflow-hidden border-t-4 border-t-primary/20">
                        <CardHeader className="flex flex-row items-center gap-4 space-y-0 bg-muted/10 pb-4">
                            <DollarSign className="w-5 h-5 text-muted-foreground" />
                            <CardTitle className="text-base">Financials</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-4">
                            <div className="rounded-xl bg-card border shadow-sm p-4 space-y-3">
                                <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">Lifetime Earnings</span>
                                    <span className="font-semibold font-mono">Tk {loggedInStaff.financials.totalEarned.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">Total Payments Made</span>
                                    <span className="font-semibold text-green-600 font-mono">Tk {loggedInStaff.financials.totalPaid.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">Total Fines</span>
                                    <span className="font-semibold text-destructive font-mono">Tk {(loggedInStaff.financials.totalFines || 0).toLocaleString()}</span>
                                </div>
                                <Separator className="bg-border/40" />
                                <div className="flex justify-between items-center pt-1">
                                    <span className={cn("text-xs font-bold uppercase tracking-wider", loggedInStaff.financials.dueAmount > 0 ? "text-destructive" : "text-muted-foreground")}>Current Due</span>
                                    <span className={cn("text-xl font-black font-mono", loggedInStaff.financials.dueAmount > 0 ? "text-destructive" : "text-foreground")}>Tk {loggedInStaff.financials.dueAmount.toLocaleString()}</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <HistoryDialog title="Payment History" data={loggedInStaff.paymentHistory}>
                                    <Button variant="outline" size="sm" className="w-full text-[10px] h-8">Payments</Button>
                                </HistoryDialog>
                                <HistoryDialog title="Income History" data={loggedInStaff.incomeHistory} frequency={loggedInStaff.salaryDetails?.frequency}>
                                    <Button variant="outline" size="sm" className="w-full text-[10px] h-8">Income</Button>
                                </HistoryDialog>
                                <FineHistoryDialog title="Fine History" data={loggedInStaff.fineHistory || []}>
                                    <Button variant="outline" size="sm" className="w-full text-[10px] h-8 col-span-2">View Fines</Button>
                                </FineHistoryDialog>
                            </div>
                        </CardContent>
                    </Card>
                </aside>
            </div>
        </div>
    );
}







