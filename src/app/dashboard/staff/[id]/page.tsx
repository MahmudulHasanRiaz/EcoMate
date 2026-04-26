
'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { ChevronLeft, MoreVertical, User, Briefcase, DollarSign, BarChart2, CheckCircle, PlusCircle, Activity, TrendingUp, KeyRound, Clock, UserCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import type { ChartConfig } from "@/components/ui/chart";
import { Separator } from '@/components/ui/separator';
import { getStaffMemberById, makePayment, fetchStaffPayments, fetchStaffIncome, fetchStaffFines, createStaffFine, voidStaffFine } from '@/services/staff';
import { getStaffAttendanceHistory } from '@/services/attendance';
import { getChartOfAccounts } from '@/services/accounting';
import { getCashDrawers } from '@/services/cash-drawers';
import type { StaffMember, OrderStatus, StaffIncome, Permission, AttendanceRecord, Account, StaffFine, StaffPayment } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { endOfDay, format, startOfDay } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { defaultBadgeRules, getBadgeForValue, getDeliverySuccessRate, normalizeBadgeRules } from '@/lib/badges';
import { useAuthErrorHandler } from "@/hooks/use-auth-error-handler";

// Chart components are dynamically imported

const ChartContainer = dynamic(
    () => import('@/components/ui/chart').then((mod) => mod.ChartContainer),
    { ssr: false, loading: () => <Skeleton className="h-[220px] w-full" /> }
);
const ChartTooltip = dynamic(
    () => import('@/components/ui/chart').then((mod) => mod.ChartTooltip),
    { ssr: false }
);
const ChartTooltipContent = dynamic(
    () => import('@/components/ui/chart').then((mod) => mod.ChartTooltipContent),
    { ssr: false }
);

const PieChart = dynamic(
    () => import('recharts').then((mod) => mod.PieChart),
    { ssr: false, loading: () => <Skeleton className="h-[200px] w-full" /> }
);
const Pie = dynamic(() => import('recharts').then((mod) => mod.Pie), { ssr: false });
const Cell = dynamic(() => import('recharts').then((mod) => mod.Cell), { ssr: false });
const RechartsLabel = dynamic(() => import('recharts').then((mod) => mod.Label), { ssr: false });

const statusColors: Record<OrderStatus, string> = {
    'New': 'bg-blue-500/20 text-blue-700',
    'Confirmed': 'bg-sky-500/20 text-sky-700',
    'Confirmed_Waiting': 'bg-teal-500/20 text-teal-700',
    'Confirmed Waiting': 'bg-teal-500/20 text-teal-700',
    'Canceled': 'bg-red-500/20 text-red-700',
    'C2C': 'bg-red-500/20 text-red-700',
    'Hold': 'bg-yellow-500/20 text-yellow-700',
    'In-Courier': 'bg-orange-500/20 text-orange-700',
    'RTS (Ready to Ship)': 'bg-purple-500/20 text-purple-700',
    'Shipped': 'bg-cyan-500/20 text-cyan-700',
    'Delivered': 'bg-green-500/20 text-green-700',
    'Returned': 'bg-gray-500/20 text-gray-700',
    'Paid_Return': 'bg-gray-500/20 text-gray-700',
    'Paid Return': 'bg-gray-500/20 text-gray-700',
    'Return Pending': 'bg-pink-500/20 text-pink-700',
    'Partial': 'bg-fuchsia-500/20 text-fuchsia-700',
    'Packing Hold': 'bg-amber-500/20 text-amber-700',
    'Incomplete': 'bg-gray-500/20 text-gray-700',
    'Incomplete-Cancelled': 'bg-red-500/20 text-red-700',
    'Draft': 'bg-zinc-500/20 text-zinc-700',
    'Damaged': 'bg-rose-500/20 text-rose-700',
    // Backend/Prisma variants
    'Packing_Hold': 'bg-amber-500/20 text-amber-700',
    'In_Courier': 'bg-orange-500/20 text-orange-700',
    'RTS__Ready_to_Ship_': 'bg-purple-500/20 text-purple-700',
    'Return_Pending': 'bg-pink-500/20 text-pink-700',
    'Incomplete_Cancelled': 'bg-red-500/20 text-red-700',
    'No_Response': 'bg-orange-400/20 text-orange-700',
    'No Response': 'bg-orange-400/20 text-orange-700',
};

const permissionModules: (Exclude<keyof StaffMember['permissions'], 'pageAccess' | 'integrations'>)[] = [
    'orders', 'packingOrders',
    'products',
    'inventory',
    'customers',
    'purchases',
    'expenses',
    'checkPassing',
    'partners',
    'courierReport',
    'courierManagement',
    'analytics',
    'staff',
    'settings',
    'issues',
    'attendance',
    'accounting',
    'marketing',
    'tasks',
];
const permissionActions: (keyof Permission)[] = ['create', 'read', 'update', 'delete'];

const chartColors = [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
];



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
    // Staff details page sometimes uses toLocaleDateString, here we unify with data-fns format for consistency if imported, 
    // but looking at imports, "format" from date-fns is already available.
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
    return d.toLocaleDateString();
}


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
                                        <TableCell className="text-right font-mono">Tk {item.amount.toLocaleString()}</TableCell>
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

function AttendanceHistoryDialog({ title, children, data }: { title: string, children: React.ReactNode, data: AttendanceRecord[] }) {
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
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Work Duration</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.map((record) => (
                                    <TableRow key={record.id}>
                                        <TableCell>
                                            {(() => {
                                                const d = new Date(record.date as any);
                                                return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString();
                                            })()}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{record.status}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right font-mono">
                                            {record.totalWorkDuration ? `${Math.floor(record.totalWorkDuration / 60)}h ${record.totalWorkDuration % 60}m` : 'N/A'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <div className="text-center text-muted-foreground py-8">
                            No attendance records found.
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function FineHistoryDialog({ title, children, data, onVoid }: { title: string, children: React.ReactNode, data: StaffFine[], onVoid: (id: string) => void }) {
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
                                    <TableHead>Notes</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                    <TableHead className="text-right">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.map((item) => (
                                    <TableRow key={item.id} className={item.status === 'Voided' ? 'opacity-50' : ''}>
                                        <TableCell>{(new Date(item.date)).toLocaleDateString()}</TableCell>
                                        <TableCell>{item.reason}</TableCell>
                                        <TableCell>
                                            <Badge variant={item.status === 'Active' ? 'destructive' : 'outline'}>{item.status}</Badge>
                                        </TableCell>
                                        <TableCell>{item.notes || '-'}</TableCell>
                                        <TableCell className="text-right font-mono">Tk {item.amount.toLocaleString()}</TableCell>
                                        <TableCell className="text-right">
                                            {item.status === 'Active' && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                                    onClick={() => {
                                                        if (confirm('Are you sure you want to void this fine?')) {
                                                            onVoid(item.id);
                                                        }
                                                    }}
                                                >
                                                    Void
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <div className="text-center text-muted-foreground py-8">
                            No fines found.
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}


export default function StaffDetailsPage() {
    const params = useParams();
    const staffId = params.id as string;
    const { toast } = useToast();
    const { handleError } = useAuthErrorHandler();
    const [staffMember, setStaffMember] = React.useState<StaffMember | undefined>(undefined);

    const { data: generalSettings } = useSWR('/api/settings/general', (url: string) =>
        fetch(url).then((res) => res.json()).catch(() => null)
    );
    const badgeRules = React.useMemo(
        () => normalizeBadgeRules(generalSettings?.badgeRules, defaultBadgeRules),
        [generalSettings]
    );

    // Pagination states
    const [attendanceHistory, setAttendanceHistory] = React.useState<AttendanceRecord[]>([]);
    const [attendanceCursor, setAttendanceCursor] = React.useState<string | null>(null);
    const [isAttendanceLoadingMore, setIsAttendanceLoadingMore] = React.useState(false);

    const [paymentHistory, setPaymentHistory] = React.useState<any[]>([]);
    const [paymentCursor, setPaymentCursor] = React.useState<string | null>(null);
    const [isPaymentLoadingMore, setIsPaymentLoadingMore] = React.useState(false);

    const [incomeHistory, setIncomeHistory] = React.useState<any[]>([]);
    const [incomeCursor, setIncomeCursor] = React.useState<string | null>(null);
    const [isIncomeLoadingMore, setIsIncomeLoadingMore] = React.useState(false);

    const [fineHistory, setFineHistory] = React.useState<StaffFine[]>([]);
    const [fineCursor, setFineCursor] = React.useState<string | null>(null);
    const [isFineLoadingMore, setIsFineLoadingMore] = React.useState(false);
    const [isFineDialogOpen, setIsFineDialogOpen] = React.useState(false);
    const [fineAmount, setFineAmount] = React.useState(0);
    const [fineReason, setFineReason] = React.useState('');
    const [fineNotes, setFineNotes] = React.useState('');
    const [fineDate, setFineDate] = React.useState(format(new Date(), 'yyyy-MM-dd'));

    const [isLoading, setIsLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState<string | null>(null);
    const [reloadKey, setReloadKey] = React.useState(0);
    const [isPaymentDialogOpen, setIsPaymentDialogOpen] = React.useState(false);
    const [paymentAmount, setPaymentAmount] = React.useState(0);
    const [paymentNotes, setPaymentNotes] = React.useState('');
    const [accounts, setAccounts] = React.useState<Account[]>([]);
    const [cashDrawers, setCashDrawers] = React.useState<any[]>([]);
    const [paymentAccountId, setPaymentAccountId] = React.useState<string | null>(null);
    const [paymentDate, setPaymentDate] = React.useState(format(new Date(), 'yyyy-MM-dd'));
    const [paymentCheckEnabled, setPaymentCheckEnabled] = React.useState(false);
    const [paymentCheckAmount, setPaymentCheckAmount] = React.useState(0);
    const [paymentCheckDate, setPaymentCheckDate] = React.useState('');
    const [paymentCheckNo, setPaymentCheckNo] = React.useState('');
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

    React.useEffect(() => {
        if (!staffId) return;
        let isActive = true;

        const load = async () => {
            setIsLoading(true);
            setLoadError(null);
            try {
                // Fetch Profile (summary) + Initial Lists
                const [staffRes, attRes, payRes, incRes, fineRes] = await Promise.all([
                    getStaffMemberById(staffId, activePeriod),
                    getStaffAttendanceHistory(staffId, activePeriod, undefined, 50),
                    fetchStaffPayments(staffId, undefined, 50),
                    fetchStaffIncome(staffId, undefined, 50),
                    fetchStaffFines(staffId, undefined, 50),
                ]);

                if (!isActive) return;

                setStaffMember(staffRes);
                setAttendanceHistory(attRes.items || []);
                setAttendanceCursor(attRes.nextCursor);

                setPaymentHistory(payRes.items);
                setPaymentCursor(payRes.nextCursor);

                setIncomeHistory(incRes.items);
                setIncomeCursor(incRes.nextCursor);

                setFineHistory(fineRes?.items || []);
                setFineCursor(fineRes?.nextCursor);

                if (staffRes) {
                    setPaymentAmount(staffRes.financials.dueAmount);
                }
            } catch (error) {
                console.error('[STAFF_DETAILS] Failed to load staff details', error);
                if (!isActive) return;
                if (await handleError(error)) return;
                setStaffMember(undefined);
                setAttendanceHistory([]);
                setLoadError('Failed to load staff details. Please try again.');
            } finally {
                if (isActive) setIsLoading(false);
            }
        };

        load();
        return () => {
            isActive = false;
        };
    }, [staffId, reloadKey, activePeriod]);

    const loadMoreAttendance = async () => {
        if (!staffId || !attendanceCursor || isAttendanceLoadingMore) return;
        setIsAttendanceLoadingMore(true);
        try {
            const res = await getStaffAttendanceHistory(staffId, activePeriod, attendanceCursor || undefined, 50);
            setAttendanceHistory(prev => [...prev, ...(res.items || [])]);
            setAttendanceCursor(res.nextCursor);
        } catch (error) {
            console.error('Failed to load more attendance', error);
            await handleError(error);
        } finally {
            setIsAttendanceLoadingMore(false);
        }
    };

    const loadMorePayments = async () => {
        if (!staffId || !paymentCursor || isPaymentLoadingMore) return;
        setIsPaymentLoadingMore(true);
        try {
            const res = await fetchStaffPayments(staffId, paymentCursor || undefined, 50);
            setPaymentHistory(prev => [...prev, ...res.items]);
            setPaymentCursor(res.nextCursor);
        } catch (error) {
            console.error('Failed to load more payments', error);
            await handleError(error);
        } finally {
            setIsPaymentLoadingMore(false);
        }
    };

    const loadMoreIncome = async () => {
        if (!staffId || !incomeCursor || isIncomeLoadingMore) return;
        setIsIncomeLoadingMore(true);
        try {
            const res = await fetchStaffIncome(staffId, incomeCursor || undefined, 50);
            setIncomeHistory(prev => [...prev, ...res.items]);
            setIncomeCursor(res.nextCursor);
        } catch (error) {
            console.error('Failed to load more income', error);
            await handleError(error);
        } finally {
            setIsIncomeLoadingMore(false);
        }
    };

    const loadMoreFines = async () => {
        if (!staffId || !fineCursor || isFineLoadingMore) return;
        setIsFineLoadingMore(true);
        try {
            const res = await fetchStaffFines(staffId, fineCursor || undefined, 50);
            setFineHistory(prev => [...prev, ...res.items]);
            setFineCursor(res.nextCursor);
        } catch (error) {
            console.error('Failed to load more fines', error);
            await handleError(error);
        } finally {
            setIsFineLoadingMore(false);
        }
    };

    const handleCreateFine = async () => {
        if (!staffMember || !fineAmount || !fineReason) {
            toast({ variant: 'destructive', title: 'Missing Fields', description: 'Please fill in all required fields.' });
            return;
        }

        try {
            const newFine = await createStaffFine(staffId, {
                amount: fineAmount,
                reason: fineReason,
                notes: fineNotes,
                date: new Date(fineDate)
            });

            // Refresh fines
            setFineHistory(prev => [newFine, ...prev]);

            // Re-fetch staff member to get updated financials
            const updatedStaff = await getStaffMemberById(staffId, activePeriod);
            if (updatedStaff) setStaffMember(updatedStaff);

            setIsFineDialogOpen(false);
            setFineAmount(0);
            setFineReason('');
            setFineNotes('');
            toast({ title: 'Fine Recorded', description: 'Staff fine has been recorded successfully.' });
        } catch (error: any) {
            console.error('Failed to create fine', error);
            if (await handleError(error)) return;
            toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to record fine.' });
        }
    };

    const handleVoidFine = async (fineId: string) => {
        try {
            await voidStaffFine(staffId, fineId);
            // successful void
            // Refresh list
            setFineHistory(prev => prev.map(f => f.id === fineId ? { ...f, status: 'Voided' } : f));

            // Re-fetch staff member
            const updatedStaff = await getStaffMemberById(staffId, activePeriod);
            if (updatedStaff) setStaffMember(updatedStaff);

            toast({ title: 'Fine Voided', description: 'The fine has been voided.' });
        } catch (error: any) {
            console.error('Failed to void fine', error);
            if (await handleError(error)) return;
            toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to void fine.' });
        }
    };


    React.useEffect(() => {
        let isActive = true;
        Promise.all([getChartOfAccounts(), getCashDrawers()])
            .then(([accData, cdData]) => {
                if (!isActive) return;
                setAccounts(Array.isArray(accData) ? accData : []);
                setCashDrawers(Array.isArray(cdData) ? cdData : []);
            })
            .catch(async (error) => {
                console.error('[STAFF_ACCOUNTS] Failed to load accounts or cash drawers', error);
                if (await handleError(error)) return;
                toast({
                    variant: 'destructive',
                    title: 'Failed to load accounts',
                    description: error?.message || 'Check server logs.',
                });
            });
        return () => {
            isActive = false;
        };
    }, [toast, handleError]);

    const paidFromAccounts = React.useMemo(() => {
        const liquidAccounts = accounts.filter(a => a.group === 'LIQUID');
        const drawers = cashDrawers.filter(cd => cd.isActive).map(cd => ({ id: cd.accountId, name: cd.name }));
        
        // Remove duplicates if cash drawers are also marked as LIQUID accounts
        const drawerAccountIds = new Set(drawers.map(d => d.id));
        const additionalLiquidAccounts = liquidAccounts.filter(a => !drawerAccountIds.has(a.id));
        
        return [...drawers, ...additionalLiquidAccounts];
    }, [accounts, cashDrawers]);

    const defaultPaymentAccountId = React.useMemo(() => {
        const cashAccount = paidFromAccounts.find((account) =>
            account.name.toLowerCase().includes('cash')
        );
        return cashAccount?.id || paidFromAccounts[0]?.id || null;
    }, [paidFromAccounts]);

    React.useEffect(() => {
        if (!paymentAccountId && defaultPaymentAccountId) {
            setPaymentAccountId(defaultPaymentAccountId);
        }
    }, [defaultPaymentAccountId, paymentAccountId]);

    React.useEffect(() => {
        if (isPaymentDialogOpen) {
            setPaymentCheckEnabled(false);
            setPaymentCheckAmount(paymentAmount);
            setPaymentCheckDate(paymentDate);
        }
    }, [isPaymentDialogOpen, paymentAmount, paymentDate]);

    const handleClearDue = async () => {
        if (!staffMember || !paymentAmount) return;
        if (!paymentAccountId) {
            toast({
                variant: 'destructive',
                title: 'Select an account',
                description: 'Choose where the payment was received.',
            });
            return;
        }
        if (paymentCheckEnabled) {
            if (!paymentCheckDate) {
                toast({
                    variant: 'destructive',
                    title: 'Check date required',
                    description: 'Please set the check passing date.',
                });
                return;
            }
            if (paymentCheckAmount <= 0 || paymentCheckAmount > paymentAmount) {
                toast({
                    variant: 'destructive',
                    title: 'Invalid check amount',
                    description: 'Check amount must be between 0 and the payment amount.',
                });
                return;
            }
            if (!paymentCheckNo) {
                toast({
                    variant: 'destructive',
                    title: 'Check No Required',
                    description: 'Please enter the check number.',
                });
                return;
            }
        }

        const updatedStaffMember = await makePayment(
            staffId,
            paymentAmount,
            paymentNotes,
            paymentAccountId,
            paymentDate || undefined,
            paymentCheckEnabled ? paymentCheckAmount : 0,
            paymentCheckEnabled ? paymentCheckDate : null,
            paymentCheckEnabled ? paymentCheckNo : undefined,
        );
        if (updatedStaffMember) {
            setStaffMember(updatedStaffMember);
            toast({
                title: "Payment Successful",
                description: `Paid Tk ${paymentAmount} to ${staffMember.name}.`,
            });
        }
        setIsPaymentDialogOpen(false);
        setPaymentNotes('');
    };

    const now = new Date();
    const todayKey = format(now, 'yyyy-MM-dd');
    const isTodayRange = (() => {
        const from = dateRange?.from;
        const to = dateRange?.to ?? dateRange?.from;
        if (!from || !to) return false;
        return format(from, 'yyyy-MM-dd') === todayKey && format(to, 'yyyy-MM-dd') === todayKey;
    })();

    const periodLabel = React.useMemo(() => {
        const from = dateRange?.from;
        const to = dateRange?.to ?? dateRange?.from;
        if (!from || !to) return 'All time';
        const fromKey = format(from, 'yyyy-MM-dd');
        const toKey = format(to, 'yyyy-MM-dd');
        if (fromKey === toKey) return format(from, 'MMM d, yyyy');
        return `${format(from, 'MMM d, yyyy')} - ${format(to, 'MMM d, yyyy')}`;
    }, [dateRange]);

    const formatMinutes = (minutes?: number | null) => {
        if (minutes === null || minutes === undefined) return 'N/A';
        const safe = Math.max(0, Math.floor(minutes));
        const hours = Math.floor(safe / 60);
        const mins = safe % 60;
        return `${hours}h ${mins}m`;
    };

    const attendanceSummary = React.useMemo(() => {
        const summary = {
            present: 0,
            absent: 0,
            onLeave: 0,
            totalWorkMinutes: 0,
        };
        attendanceHistory.forEach((rec) => {
            if (rec.status === 'Present') summary.present += 1;
            if (rec.status === 'Absent') summary.absent += 1;
            if (rec.status === 'On Leave') summary.onLeave += 1;
            if (typeof rec.totalWorkDuration === 'number') {
                summary.totalWorkMinutes += Math.max(0, rec.totalWorkDuration);
            }
        });
        return summary;
    }, [attendanceHistory]);

    const todayAttendance = isTodayRange
        ? attendanceHistory.find((rec) => format(new Date(rec.date), 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd'))
        : null;

    const performanceChartData = React.useMemo(() => {
        if (!staffMember || !staffMember.performance) return [];
        return Object.entries(staffMember.performance.statusBreakdown)
            .filter(([, value]) => value > 0)
            .map(([status, value], index) => ({
                status: status as OrderStatus,
                value,
                fill: chartColors[index % chartColors.length]
            }));
    }, [staffMember]);

    const chartConfig: ChartConfig = React.useMemo(() => {
        if (!performanceChartData) return {};
        return performanceChartData.reduce((acc, { status, fill }) => {
            acc[status] = { label: status, color: fill };
            return acc;
        }, {} as ChartConfig);
    }, [performanceChartData]);


    const stats = React.useMemo(() => {
        if (!staffMember) return {
            createdTotal: 0, createdConfirmed: 0, createdCanceled: 0, createdDelivered: 0, createdReturned: 0,
            createdConfirmationRate: 0, createdCancellationRate: 0, createdDeliveryRate: 0, createdReturnRate: 0,

            confirmedTotal: 0, confirmedDelivered: 0, confirmedReturned: 0, confirmedCanceled: 0,
            deliveryRate: 0, returnRate: 0, confirmedCancellationRate: 0,

            incompleteWorked: 0, incompleteConverted: 0, incompleteConversionRate: 0,
            ordersWorked: 0, totalActions: 0, combinedCancellationRate: 0, combinedDeliveryRate: 0
        };

        const performance = staffMember.performance || {};

        // 1. Creation Metrics
        const createdTotal = performance.ordersCreated || 0;
        const createdStats = performance.createdStatusBreakdown || {};
        const createdConfirmed = createdStats['Confirmed'] || 0;
        const createdCanceled = createdStats['Canceled'] || 0;
        const createdDelivered = createdStats['Delivered'] || 0;
        const createdReturned = (createdStats['Returned'] || 0) + (createdStats['Paid_Return' as any] || 0);

        const createdConfirmationRate = createdTotal > 0 ? (createdConfirmed / createdTotal) * 100 : 0;
        const createdCancellationRate = createdTotal > 0 ? (createdCanceled / createdTotal) * 100 : 0;
        const createdDeliveryRate = createdTotal > 0 ? (createdDelivered / createdTotal) * 100 : 0;
        const createdReturnRate = createdTotal > 0 ? (createdReturned / createdTotal) * 100 : 0;

        // 2. Confirmation Metrics (Processing)
        const confirmedTotal = performance.ordersConfirmed || 0;
        const confirmedStats = performance.confirmedStatusBreakdown || {};
        const confirmedDelivered = confirmedStats['Delivered'] || 0;
        const confirmedReturned = (confirmedStats['Returned'] || 0) + (confirmedStats['Paid_Return' as any] || 0);
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

        // 4. Overall
        const totalActions = performance.totalOrderActions ?? (createdTotal + confirmedTotal);
        const ordersWorked = performance.ordersWorked ?? totalActions;
        const totalCanceled = createdCanceled + confirmedCanceled;
        const totalDelivered = createdDelivered + confirmedDelivered;

        const combinedCancellationRate = totalActions > 0 ? (totalCanceled / totalActions) * 100 : 0;
        const combinedDeliveryRate = totalActions > 0 ? (totalDelivered / totalActions) * 100 : 0;

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

            ordersWorked,
            totalActions,
            combinedCancellationRate,
            combinedDeliveryRate
        };
    }, [staffMember]);


    const createdBadge = getBadgeForValue(
        badgeRules.staffOrdersCreated,
        stats.createdTotal
    );

    const confirmedBadge = getBadgeForValue(
        badgeRules.staffOrdersConfirmed,
        stats.confirmedTotal
    );

    const deliveryBadge = getBadgeForValue(
        badgeRules.staffDeliverySuccess,
        stats.deliveryRate
    );
    const staffBadges = [createdBadge, confirmedBadge, deliveryBadge].filter(Boolean);

    if (isLoading) {
        return (
            <div className="flex flex-1 flex-col gap-6 p-4 lg:gap-8 lg:p-6">
                <Skeleton className="h-10 w-1/2" />
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    <Skeleton className="h-48" />
                    <Skeleton className="h-48" />
                    <Skeleton className="h-48" />
                </div>
                <div className="grid gap-6 md:grid-cols-2">
                    <Skeleton className="h-64" />
                    <Skeleton className="h-64" />
                </div>
                <Skeleton className="h-80" />
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 lg:gap-6 lg:p-6">
                <p className="text-muted-foreground">{loadError}</p>
                <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                    Retry
                </Button>
                <Button asChild variant="ghost">
                    <Link href="/dashboard/staff">Back to Staff List</Link>
                </Button>
            </div>
        );
    }

    if (!staffMember) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 lg:gap-6 lg:p-6">
                <p>Staff member not found.</p>
                <Button asChild variant="outline">
                    <Link href="/dashboard/staff">Back to Staff List</Link>
                </Button>
            </div>
        );
    }


    return (
        <div className="flex flex-1 flex-col gap-6 p-4 lg:gap-8 lg:p-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                    <Button variant="outline" size="icon" className="h-7 w-7" asChild>
                        <Link href="/dashboard/staff">
                            <ChevronLeft className="h-4 w-4" />
                            <span className="sr-only">Back</span>
                        </Link>
                    </Button>
                    <div className="flex-1">
                        <h1 className="font-headline text-xl font-semibold sm:text-2xl">{staffMember.name}</h1>
                        <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-2 mt-1">
                            <Badge variant="outline">{staffMember.role}</Badge>
                            {staffMember.designation && (
                                <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
                                    {staffMember.designation}
                                </Badge>
                            )}
                            {staffBadges.map((badge) => (
                                badge ? (
                                    <Badge key={badge.id} variant="outline" className={badge.color}>
                                        {badge.label}
                                    </Badge>
                                ) : null
                            ))}
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-2 sm:ml-auto sm:items-end">
                    <span className="text-sm text-muted-foreground">Showing {periodLabel}</span>
                    <DateRangePicker
                        date={dateRange}
                        onDateChange={setDateRange}
                        placeholder="Filter by date"
                        className="w-full sm:w-auto"
                    />
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Main Column (2/3) */}
                <div className="lg:col-span-2 space-y-6">

                    {/* Performance Banners */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                        {/* Confirmation Performance */}
                        <Card className="h-full shadow-md rounded-xl border-border/60 overflow-hidden">
                            <CardHeader className="bg-muted/10 pb-4">
                                <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground/80">
                                    <CheckCircle className="h-5 w-5 text-sky-600" />
                                    Confirmation Performance
                                </CardTitle>
                                <CardDescription className="text-[11px]">Orders confirmed by {staffMember.name.split(' ')[0]}.</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="flex items-baseline justify-between mb-4 border-b border-border/40 pb-4">
                                    <div className="space-y-1">
                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Confirmed</span>
                                        <div className="text-3xl font-extrabold text-foreground">{stats.confirmedTotal}</div>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Success</span>
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

                        {/* Creation Performance */}
                        <Card className="h-full shadow-md rounded-xl border-border/60 overflow-hidden">
                            <CardHeader className="bg-muted/10 pb-4">
                                <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground/80">
                                    <PlusCircle className="h-5 w-5 text-blue-600" />
                                    Creation Performance
                                </CardTitle>
                                <CardDescription className="text-[11px]">Orders created by {staffMember.name.split(' ')[0]}.</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="flex items-baseline justify-between mb-4 border-b border-border/40 pb-4">
                                    <div className="space-y-1">
                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Created</span>
                                        <div className="text-3xl font-extrabold text-foreground">{stats.createdTotal}</div>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Success</span>
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

                        {/* Incomplete Performance */}
                        <Card className="h-full shadow-md rounded-xl border-border/60 overflow-hidden">
                            <CardHeader className="bg-muted/10 pb-4">
                                <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground/80">
                                    <Clock className="h-5 w-5 text-amber-600" />
                                    Incomplete Performance
                                </CardTitle>
                                <CardDescription className="text-[11px]">Lead handling from Incomplete Orders only.</CardDescription>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="flex items-baseline justify-between mb-4 border-b border-border/40 pb-4">
                                    <div className="space-y-1">
                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Worked</span>
                                        <div className="text-3xl font-extrabold text-foreground">{stats.incompleteWorked}</div>
                                    </div>
                                    <div className="text-right space-y-1">
                                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">Conversion</span>
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
                                        <p className="text-sm text-muted-foreground">Aggregate performance across all activities.</p>
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

                    {/* Status Mix Chart */}
                    {performanceChartData.length > 0 && (
                        <Card className="shadow-md rounded-xl border-border/60">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base font-semibold">Status Mix</CardTitle>
                                <CardDescription className="text-xs text-muted-foreground">Distribution of order statuses handled.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ChartContainer
                                    config={chartConfig}
                                    className="mx-auto aspect-[3/1] h-[200px] w-full"
                                >
                                    <PieChart>
                                        <ChartTooltip
                                            cursor={false}
                                            content={<ChartTooltipContent hideLabel />}
                                        />
                                        <Pie
                                            data={performanceChartData}
                                            dataKey="value"
                                            nameKey="status"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={2}
                                        >
                                            <RechartsLabel
                                                content={({ viewBox }) => {
                                                    if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                                                        return (
                                                            <text
                                                                x={viewBox.cx}
                                                                y={viewBox.cy}
                                                                textAnchor="middle"
                                                                dominantBaseline="middle"
                                                            >
                                                                <tspan
                                                                    x={viewBox.cx}
                                                                    y={viewBox.cy}
                                                                    className="fill-foreground text-3xl font-bold"
                                                                >
                                                                    {stats.totalActions}
                                                                </tspan>
                                                                <tspan
                                                                    x={viewBox.cx}
                                                                    y={(viewBox.cy || 0) + 24}
                                                                    className="fill-muted-foreground text-xs"
                                                                >
                                                                    Actions
                                                                </tspan>
                                                            </text>
                                                        )
                                                    }
                                                }}
                                            />
                                            {performanceChartData.map((entry) => (
                                                <Cell key={entry.status as string} fill={entry.fill} />
                                            ))}
                                        </Pie>
                                    </PieChart>
                                </ChartContainer>
                            </CardContent>
                        </Card>
                    )}

                    {/* Bottom Dynamic Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {/* Attendance Summary */}
                        <Card className="shadow-md rounded-xl border-border/60">
                            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
                                <div className="flex items-center gap-3">
                                    <Clock className="w-5 h-5 text-muted-foreground" />
                                    <CardTitle className="text-base">Attendance</CardTitle>
                                </div>
                                <AttendanceHistoryDialog title="Attendance History" data={attendanceHistory}>
                                    <Button variant="ghost" size="sm" className="h-7 text-[10px] px-2 h-auto py-0 opacity-70 hover:opacity-100">View Log</Button>
                                </AttendanceHistoryDialog>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm pt-4">
                                {isTodayRange && (
                                    <>
                                        <div className="flex justify-between items-center bg-muted/30 p-2 rounded-lg mb-2">
                                            <span className="text-xs text-muted-foreground font-medium uppercase tracking-tight">Today</span>
                                            {todayAttendance ? <Badge variant="outline" className="text-[10px] h-5">{todayAttendance.status}</Badge> : <Badge variant="secondary" className="text-[10px] h-5">N/A</Badge>}
                                        </div>
                                        <Separator className="my-3 opacity-40" />
                                    </>
                                )}
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-muted-foreground">Present Days</span>
                                        <span className="font-semibold">{attendanceSummary.present}</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-muted-foreground">Absent/Leave</span>
                                        <span className="font-semibold">{attendanceSummary.absent + attendanceSummary.onLeave}</span>
                                    </div>
                                    <div className="flex justify-between text-xs font-bold pt-1 border-t border-border/40">
                                        <span className="text-muted-foreground lowercase">Total Work</span>
                                        <span className="text-primary">{formatMinutes(attendanceSummary.totalWorkMinutes)}</span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Permissions */}
                        <Card className="shadow-md rounded-xl border-border/60 lg:col-span-2">
                            <CardHeader className="flex flex-row items-center gap-4 space-y-0 pb-4">
                                <KeyRound className="w-5 h-5 text-muted-foreground" />
                                <CardTitle className="text-base">Module Permissions</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {staffMember.role === 'Custom' ? (
                                    <div className="max-h-[200px] overflow-y-auto rounded-md border border-border/40">
                                        <Table className="text-xs">
                                            <TableHeader className="bg-muted/30">
                                                <TableRow>
                                                    <TableHead className="h-8">Module</TableHead>
                                                    <TableHead className="text-center h-8">C</TableHead>
                                                    <TableHead className="text-center h-8">R</TableHead>
                                                    <TableHead className="text-center h-8">U</TableHead>
                                                    <TableHead className="text-center h-8">D</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {['pos', 'delivery', 'accounting', 'inventory', 'customer', 'staff', 'settings'].map(module => (
                                                    <TableRow key={module} className="h-8">
                                                        <TableCell className="py-1 font-medium capitalize">{module}</TableCell>
                                                        {['create', 'read', 'update', 'delete'].map(action => (
                                                            <TableCell key={action} className="text-center py-1">
                                                                {(staffMember.permissions as any)?.[module]?.[action]
                                                                    ? <CheckCircle className="w-3.5 h-3.5 text-green-500 mx-auto" />
                                                                    : <XCircle className="w-3.5 h-3.5 text-red-500/40 mx-auto" />}
                                                            </TableCell>
                                                        ))}
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center p-8 bg-muted/20 rounded-lg border border-dashed border-border/60">
                                        <div className="text-center">
                                            <p className="text-xs font-medium text-muted-foreground mb-2">Managed by Role</p>
                                            <Badge variant="secondary" className="px-4 py-1">{staffMember.role}</Badge>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
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
                                    <div className="text-sm font-semibold truncate">{staffMember.staffCode}</div>
                                </div>
                                <div className="space-y-1">
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Designation</div>
                                    <div className="text-sm font-semibold truncate">{staffMember.designation || 'N/A'}</div>
                                </div>
                                <div className="space-y-1 col-span-2">
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Join Date</div>
                                    <div className="text-sm font-semibold">
                                        {(() => {
                                            const raw = staffMember.jobStartDate ?? staffMember.createdAt;
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
                                <Badge variant="secondary" className="font-bold">{staffMember.role}</Badge>
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
                                    <span className="text-xs text-muted-foreground font-medium">{staffMember.salaryDetails?.frequency || 'Monthly'} Salary</span>
                                    <span className="text-lg font-bold">
                                        Tk {(staffMember.salaryDetails?.amount || 0).toLocaleString()}
                                    </span>
                                </div>
                                <Progress value={100} className="h-1 bg-muted" />
                            </div>
                            <div className="space-y-2 px-1">
                                <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Commission Policy (Rates)</div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="flex justify-between p-2 rounded bg-muted/30">
                                        <span className="text-muted-foreground">Create:</span>
                                        <span className="font-mono font-bold">Tk {staffMember.commissionDetails?.onOrderCreate || 0}</span>
                                    </div>
                                    <div className="flex justify-between p-2 rounded bg-muted/30">
                                        <span className="text-muted-foreground">Confirm:</span>
                                        <span className="font-mono font-bold">Tk {staffMember.commissionDetails?.onOrderConfirm || 0}</span>
                                    </div>
                                    <div className="flex justify-between p-2 rounded bg-muted/30">
                                        <span className="text-muted-foreground">Pack:</span>
                                        <span className="font-mono font-bold">Tk {staffMember.commissionDetails?.onOrderPacked || 0}</span>
                                    </div>
                                    <div className="flex justify-between p-2 rounded bg-muted/30">
                                        <span className="text-muted-foreground">Convert:</span>
                                        <span className="font-mono font-bold">Tk {staffMember.commissionDetails?.onOrderConvert || 0}</span>
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
                                    <span className="font-semibold font-mono">Tk {staffMember.financials.totalEarned.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">Total Payments Made</span>
                                    <span className="font-semibold text-green-600 font-mono">Tk {staffMember.financials.totalPaid.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span className="text-muted-foreground">Total Fines</span>
                                    <span className="font-semibold text-destructive font-mono">Tk {(staffMember.financials.totalFines || 0).toLocaleString()}</span>
                                </div>
                                <Separator className="bg-border/40" />
                                <div className="flex justify-between items-center pt-1">
                                    <span className={cn("text-xs font-bold uppercase tracking-wider", staffMember.financials.dueAmount > 0 ? "text-destructive" : "text-muted-foreground")}>Current Due</span>
                                    <span className={cn("text-xl font-black font-mono", staffMember.financials.dueAmount > 0 ? "text-destructive" : "text-foreground")}>Tk {staffMember.financials.dueAmount.toLocaleString()}</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <HistoryDialog title="Payment History" data={paymentHistory}>
                                    <Button variant="outline" size="sm" className="w-full text-[10px] h-8">Payments</Button>
                                </HistoryDialog>
                                <HistoryDialog title="Income History" data={incomeHistory} frequency={staffMember.salaryDetails?.frequency}>
                                    <Button variant="outline" size="sm" className="w-full text-[10px] h-8">Income</Button>
                                </HistoryDialog>
                                <FineHistoryDialog title="Fine History" data={fineHistory} onVoid={handleVoidFine}>
                                    <Button variant="outline" size="sm" className="w-full text-[10px] h-8 col-span-2 sm:col-span-1">Fines</Button>
                                </FineHistoryDialog>
                            </div>

                            <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button className="w-full shadow-lg shadow-primary/20" disabled={staffMember.financials.dueAmount <= 0}>
                                        <CheckCircle className="mr-2 h-4 w-4" /> Clear Due Amount
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle>Make a Payment to {staffMember.name}</DialogTitle>
                                        <DialogDescription>
                                            Enter the amount you want to pay. The current due is Tk {staffMember.financials.dueAmount.toLocaleString()}.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="grid gap-4 py-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="payment-amount" className="text-xs font-bold uppercase tracking-tighter opacity-70">Payment Amount</Label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-2.5 text-muted-foreground font-mono">Tk</span>
                                                <Input
                                                    id="payment-amount"
                                                    type="number"
                                                    className="pl-8 text-lg font-bold font-mono"
                                                    value={paymentAmount}
                                                    onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                                                    max={staffMember.financials.dueAmount}
                                                />
                                            </div>
                                        </div>
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label htmlFor="payment-account" className="text-xs font-bold uppercase tracking-tighter opacity-70">Paid From Account</Label>
                                                <Select
                                                    value={paymentAccountId ?? ''}
                                                    onValueChange={(value) => setPaymentAccountId(value || null)}
                                                >
                                                    <SelectTrigger id="payment-account" className="text-xs h-9">
                                                        <SelectValue placeholder="Account" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {paidFromAccounts.map((account) => (
                                                            <SelectItem key={account.id} value={account.id} className="text-xs">
                                                                {account.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="payment-date" className="text-xs font-bold uppercase tracking-tighter opacity-70">Paid Date</Label>
                                                <Input
                                                    id="payment-date"
                                                    type="date"
                                                    className="text-xs h-9"
                                                    value={paymentDate}
                                                    onChange={(e) => setPaymentDate(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div className="rounded-lg border border-muted p-4 space-y-3 bg-muted/10">
                                            <div className="flex items-center space-x-2">
                                                <Checkbox
                                                    id="payment-check"
                                                    checked={paymentCheckEnabled}
                                                    onCheckedChange={(checked) => {
                                                        const enableCheck = Boolean(checked);
                                                        setPaymentCheckEnabled(enableCheck);
                                                        setPaymentCheckAmount(enableCheck ? paymentAmount : 0);
                                                        setPaymentCheckDate(enableCheck ? (paymentCheckDate || paymentDate) : '');
                                                    }}
                                                />
                                                <label
                                                    htmlFor="payment-check"
                                                    className="text-xs font-semibold leading-none cursor-pointer"
                                                >
                                                    Payment by Check
                                                </label>
                                            </div>
                                            {paymentCheckEnabled && (
                                                <div className="grid grid-cols-1 gap-3 animate-in fade-in slide-in-from-top-1">
                                                    <div className="grid grid-cols-2 gap-3">
                                                        <div className="space-y-1.5">
                                                            <Label htmlFor="payment-check-amount" className="text-[10px] font-bold uppercase opacity-60">Check Amount</Label>
                                                            <Input
                                                                id="payment-check-amount"
                                                                type="number"
                                                                step="0.01"
                                                                className="h-8 text-xs font-mono"
                                                                value={paymentCheckAmount}
                                                                onChange={(e) => {
                                                                    const nextValue = Number(e.target.value || 0);
                                                                    setPaymentCheckAmount(nextValue > paymentAmount ? paymentAmount : nextValue);
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="space-y-1.5">
                                                            <Label htmlFor="payment-check-date" className="text-[10px] font-bold uppercase opacity-60">Passing Date</Label>
                                                            <Input
                                                                id="payment-check-date"
                                                                type="date"
                                                                className="h-8 text-xs"
                                                                value={paymentCheckDate}
                                                                onChange={(e) => setPaymentCheckDate(e.target.value)}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label htmlFor="payment-check-no" className="text-[10px] font-bold uppercase opacity-60">Check Number</Label>
                                                        <Input
                                                            id="payment-check-no"
                                                            className="h-8 text-xs font-mono"
                                                            value={paymentCheckNo}
                                                            onChange={(e) => setPaymentCheckNo(e.target.value)}
                                                            placeholder="Cheque No."
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="payment-notes" className="text-xs font-bold uppercase tracking-tighter opacity-70">Optional Notes</Label>
                                            <Textarea
                                                id="payment-notes"
                                                className="text-xs min-h-[60px]"
                                                placeholder="e.g., Target bonus, Advance salary"
                                                value={paymentNotes}
                                                onChange={(e) => setPaymentNotes(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <DialogFooter className="gap-2 sm:gap-0">
                                        <Button variant="outline" className="text-xs h-9" onClick={() => setIsPaymentDialogOpen(false)}>Cancel</Button>
                                        <Button className="text-xs h-9" onClick={handleClearDue}>Confirm & Record Payment</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>

                            <Dialog open={isFineDialogOpen} onOpenChange={setIsFineDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button variant="outline" className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive">
                                        <XCircle className="mr-2 h-4 w-4" /> Record Fine
                                    </Button>
                                </DialogTrigger>
                                <DialogContent className="sm:max-w-[425px]">
                                    <DialogHeader>
                                        <DialogTitle className="text-destructive flex items-center gap-2">
                                            <XCircle className="h-5 w-5" />
                                            Record Staff Fine
                                        </DialogTitle>
                                        <DialogDescription>
                                            Record a fine for {staffMember.name}. This will be deducted from their due amount.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="grid gap-4 py-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="fine-amount" className="text-xs font-bold uppercase tracking-tighter opacity-70">Fine Amount</Label>
                                            <div className="relative">
                                                <span className="absolute left-3 top-2.5 text-muted-foreground font-mono">Tk</span>
                                                <Input
                                                    id="fine-amount"
                                                    type="number"
                                                    className="pl-8 text-lg font-bold font-mono"
                                                    value={fineAmount}
                                                    onChange={(e) => setFineAmount(parseFloat(e.target.value) || 0)}
                                                />
                                            </div>
                                            <p className="text-[10px] text-muted-foreground">
                                                Max valid fine: Tk {Math.max(0, staffMember.financials.dueAmount).toLocaleString()}
                                            </p>
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="fine-date" className="text-xs font-bold uppercase tracking-tighter opacity-70">Date</Label>
                                            <Input
                                                id="fine-date"
                                                type="date"
                                                className="text-xs h-9"
                                                value={fineDate}
                                                onChange={(e) => setFineDate(e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="fine-reason" className="text-xs font-bold uppercase tracking-tighter opacity-70">Reason</Label>
                                            <Input
                                                id="fine-reason"
                                                placeholder="e.g. Late Arrival, Lost Inventory"
                                                value={fineReason}
                                                onChange={(e) => setFineReason(e.target.value)}
                                                className="text-xs"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="fine-notes" className="text-xs font-bold uppercase tracking-tighter opacity-70">Optional Notes</Label>
                                            <Textarea
                                                id="fine-notes"
                                                className="text-xs min-h-[60px]"
                                                placeholder="Additional details..."
                                                value={fineNotes}
                                                onChange={(e) => setFineNotes(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button variant="outline" onClick={() => setIsFineDialogOpen(false)}>Cancel</Button>
                                        <Button variant="destructive" onClick={handleCreateFine}>Confirm Fine</Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </CardContent>
                    </Card>
                </aside>

            </div>
        </div>
    );
}
