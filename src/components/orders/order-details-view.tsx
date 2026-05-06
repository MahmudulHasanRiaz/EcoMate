'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    ChevronLeft,
    Copy,
    MoreVertical,
    Truck,
    Package,
    CheckCircle,
    XCircle,
    Lock,
    History,
    FileText,
    Save,
    Mail,
    Phone,
    Store,
    Globe,
    Edit,
    Printer,
    File as FileIcon,
    Loader2,
    Clock,
    PackageCheck,
    Ban,
    RotateCcw,
    MessageSquare,
    StickyNote,
    PackageSearch,
    AlertCircle,
    User,
    CreditCard,
    ClipboardList,
    UserCheck,
    Scissors,
    ArrowRightLeft,
    CircleCheck,
    Monitor,
} from 'lucide-react';
import { format, isAfter, subHours } from 'date-fns';
import * as React from 'react';
import { getAvailableStatuses } from "@/lib/order-status-flow"; // Import Logic
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from '@/components/ui/button';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

import {
    Card,
    // ...
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Separator } from '@/components/ui/separator';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getOrderById, getStatuses, getOrdersByCustomerPhone, updateOrder, getOrderChanges, subscribeToOrderUpdates } from '@/services/orders';
import { getBusinesses, getCourierServices } from '@/services/partners';
import { getIssuesByOrderId, updateIssue } from '@/services/issues';
import { getStaff, getStaffMemberById, getStaffMemberByClerkId } from '@/services/staff';
import { getDeliveryReport, type DeliveryReport } from '@/services/delivery-score';
import { getChartOfAccounts } from '@/services/accounting';
import { resolveImageSrc } from '@/lib/image';
import { formatTelHref, formatWhatsAppHref, normalizeBdPhoneForStorage } from '@/lib/phone';
import { acquireOrderOpenLock, heartbeatOrderOpenLock, releaseOrderOpenLock } from '@/services/order-open-locks';
import type { OrderProduct, OrderLog, Order as OrderType, OrderStatus, CourierService, Business, Issue, StaffMember, IssueStatus, Account, OrderOpenLock } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { OrderTimeline } from '@/components/ui/order-timeline';
import { defaultBadgeRules, getBadgeForValue, normalizeBadgeRules } from '@/lib/badges';
import { useUser } from '@clerk/nextjs';


import { NewOrderDialog } from '@/components/orders/new-order-dialog';
import { SplitOrderDialog } from '@/components/orders/split-order-dialog';

type StatusKey = OrderType['status'] | IssueStatus;

const statusColors: Record<string, string> = {
    // ... existing colors ...
    'Draft': 'bg-slate-400/20 text-slate-700',
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
    'Partial': 'bg-fuchsia-500/20 text-fuchsia-700',
    'Damaged': 'bg-rose-500/20 text-rose-700',
    'Incomplete': 'bg-gray-500/20 text-gray-700',
    'Incomplete-Cancelled': 'bg-red-500/20 text-red-700',
    'No Response': 'bg-orange-400/20 text-orange-700',
    'Open': 'bg-blue-500/20 text-blue-700',
    'In Progress': 'bg-amber-500/20 text-amber-700',
    'Resolved': 'bg-green-500/20 text-green-700',
    'Closed': 'bg-gray-500/20 text-gray-700',
    'Wholesale:Pending': 'bg-yellow-100 text-yellow-800 border-yellow-200',
    'Wholesale:Approved': 'bg-emerald-100 text-emerald-800 border-emerald-200',
    'Wholesale:EditedApproved': 'bg-blue-100 text-blue-800 border-blue-200',
    'Wholesale:Rejected': 'bg-rose-100 text-rose-800 border-rose-200',
};

// ... existing icons ...
const statusIcons: Record<string, React.ElementType> = {
    'New': Package,
    'Confirmed': CheckCircle,
    'Confirmed Waiting': Clock,
    'Canceled': XCircle,
    'C2C': XCircle,
    'Hold': History,
    'In-Courier': Truck,
    'RTS (Ready to Ship)': PackageSearch,
    'Shipped': Truck,
    'Delivered': CheckCircle,
    'Returned': History,
    'Return Pending': RotateCcw,
    'Partial': Truck,
    'Damaged': AlertCircle,
    'Notes updated': FileText,
    'Order Edited': Edit,
    'Sent to Pathao': Truck,
    'Packing Hold': Clock,
};

function getStatusUpdateErrorMessage(err: any, intendedStatus?: string) {
    const raw = String(err?.message || '').trim();
    const code = String(err?.code || '').toUpperCase();
    const lower = raw.toLowerCase();

    if (
        code === 'INSUFFICIENT_STOCK' ||
        lower.includes('insufficient stock') ||
        lower.includes('stock unavailable')
    ) {
        if (intendedStatus === 'Confirmed') {
            return 'Insufficient stock. Add stock, then confirm again.';
        }
        return 'Insufficient stock for this status change.';
    }

    return raw || 'Could not update order status.';
}

function CourierReport({ report, isLoading }: { report: DeliveryReport | null, isLoading: boolean }) {
    const courierStatsData = React.useMemo(() => {
        if (!report || !report.Summaries) return [];
        return Object.entries(report.Summaries).map(([name, data]) => ({
            name,
            total: (data as any)["Total Parcels"] || (data as any)["Total Delivery"] || 0,
            delivered: (data as any)["Delivered Parcels"] || (data as any)["Successful Delivery"] || 0,
            canceled: (data as any)["Canceled Parcels"] || (data as any)["Canceled Delivery"] || 0,
        }));
    }, [report]);

    const { totalParcels, totalDelivered, totalCanceled } = React.useMemo(() => {
        return courierStatsData.reduce((acc, courier) => {
            acc.totalParcels += courier.total;
            acc.totalDelivered += courier.delivered;
            acc.totalCanceled += courier.canceled;
            return acc;
        }, { totalParcels: 0, totalDelivered: 0, totalCanceled: 0 });
    }, [courierStatsData]);

    const deliveryRatio = totalParcels > 0 ? (totalDelivered / totalParcels) * 100 : 0;
    const cancelRatio = totalParcels > 0 ? (totalCanceled / totalParcels) * 100 : 0;

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className='flex items-center gap-2'><ClipboardList className='w-5 h-5 text-muted-foreground' />Courier Delivery Report</CardTitle>
                    <CardDescription>Fetching delivery history...</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                </CardContent>
            </Card>
        )
    }

    if (!report) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className='flex items-center gap-2'><ClipboardList className='w-5 h-5 text-muted-foreground' />Courier Delivery Report</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="text-center text-muted-foreground py-4 flex flex-col items-center gap-2">
                        <PackageSearch className="w-8 h-8" />
                        <span>No report found for this customer.</span>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="h-full flex flex-col justify-between">
            <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className='flex items-center gap-2 text-base'><ClipboardList className='w-4 h-4 text-muted-foreground' />Courier Delivery Report</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 px-4 pb-4 text-xs">
                {courierStatsData.length > 0 ? (
                    <>
                        <div className="grid grid-cols-4 gap-x-2 border-b pb-1 font-medium text-muted-foreground">
                            <div className="col-span-1">Courier</div>
                            <div className="col-span-1 text-center">Ttl</div>
                            <div className="col-span-1 text-center">Dlvr</div>
                            <div className="col-span-1 text-center">Cncl</div>
                        </div>
                        <div className='bg-muted/30 rounded-sm p-1 space-y-1'>
                            {courierStatsData.map(courier => (
                                <div key={courier.name} className="grid grid-cols-4 gap-x-2 items-center">
                                    <div className="col-span-1 font-semibold truncate">{courier.name}</div>
                                    <div className="col-span-1 text-center text-muted-foreground">{courier.total}</div>
                                    <div className="col-span-1 text-center font-medium text-green-600">{courier.delivered}</div>
                                    <div className="col-span-1 text-center font-medium text-red-500">{courier.canceled}</div>
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-4 gap-x-2 items-center font-bold pt-1 border-t">
                            <div className="col-span-1">Total</div>
                            <div className="col-span-1 text-center">{totalParcels}</div>
                            <div className="col-span-1 text-center text-green-600">{totalDelivered}</div>
                            <div className="col-span-1 text-center text-red-500">{totalCanceled}</div>
                        </div>

                        <div className="pt-1">
                            <div className="w-full bg-gray-100 rounded-full h-1.5 dark:bg-gray-800 flex overflow-hidden">
                                <div className="bg-green-500 h-full" style={{ width: `${deliveryRatio}%` }}></div>
                                <div className="bg-red-500 h-full" style={{ width: `${cancelRatio}%` }}></div>
                            </div>
                            <div className="flex justify-between text-[10px] mt-1 text-muted-foreground">
                                <div className="flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                                    <span>Success: <strong>{deliveryRatio.toFixed(0)}%</strong></span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 rounded-full bg-red-500"></span>
                                    <span>Cancel: <strong>{cancelRatio.toFixed(0)}%</strong></span>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="text-center text-muted-foreground py-2">No data.</div>
                )}
            </CardContent>
        </Card>
    );
}

const statusUpdateSchema = z.object({
    status: z.string().min(1, "Status is required."),
    officeNote: z.string().optional(),
});
type StatusUpdateFormValues = z.infer<typeof statusUpdateSchema>;

const CACHE_DURATION = 1000 * 60 * 5; // 5 minutes
const reportCache = new Map<string, { data: DeliveryReport, timestamp: number }>();

function WholesaleReviewBanner({ order, onAction, onEditClick }: { order: OrderType; onAction: () => void; onEditClick: () => void }) {
    const { toast } = useToast();
    const [isProcessing, setIsProcessing] = React.useState(false);
    const [reviewNote, setReviewNote] = React.useState('');
    const [actionType, setActionType] = React.useState<'Approved' | 'Rejected' | null>(null);

    const handleApproval = async () => {
        if (!actionType) return;
        if (!reviewNote.trim()) {
            toast({ variant: 'destructive', title: "Reason Required", description: `Please provide a reason for ${actionType === 'Approved' ? 'approval' : 'rejection'}.` });
            return;
        }

        setIsProcessing(true);
        try {
            const { processWholesaleApproval } = await import('@/services/wholesale');
            await processWholesaleApproval({
                orderId: order.id,
                action: actionType,
                note: reviewNote.trim()
            });
            toast({ title: `Order ${actionType}`, description: `The wholesale order has been ${actionType.toLowerCase()}.` });
            onAction();
            setActionType(null);
            setReviewNote('');
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Action failed", description: error.message });
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <Card className="border-yellow-200 bg-yellow-50 shadow-sm overflow-hidden">
            <CardContent className="p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-yellow-100 rounded-full">
                        <Monitor className="h-5 w-5 text-yellow-700" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-yellow-900 flex items-center gap-2">
                            Pending Wholesale Review
                            <Badge variant="outline" className="bg-yellow-200 text-yellow-800 border-yellow-300">
                                {order.WholesaleRule?.name || 'Manual'}
                            </Badge>
                        </h3>
                        <p className="text-sm text-yellow-700">
                            This order requires administrative approval before it can be processed.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Button
                        variant="outline"
                        size="sm"
                        className="bg-white hover:bg-yellow-100 text-yellow-700 border-yellow-200"
                        onClick={onEditClick}
                    >
                        <Edit className="h-4 w-4 mr-2" />
                        Edit & Approve
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white border-transparent"
                        onClick={() => { setActionType('Approved'); setReviewNote(''); }}
                    >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Approve
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200"
                        onClick={() => { setActionType('Rejected'); setReviewNote(''); }}
                    >
                        <XCircle className="h-4 w-4 mr-2" />
                        Reject
                    </Button>
                </div>
            </CardContent>

            <Dialog open={actionType !== null} onOpenChange={(open) => !open && setActionType(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{actionType === 'Approved' ? 'Approve' : 'Reject'} Wholesale Order</DialogTitle>
                        <DialogDescription>
                            Please provide a reason for {actionType === 'Approved' ? 'approving' : 'rejecting'} this order. This will be visible in the order logs.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="review-note">Review Note</Label>
                        <Textarea
                            id="review-note"
                            placeholder={actionType === 'Approved' ? "e.g., Verified prices, Checked with warehouse..." : "e.g., Minimum quantity not met, Price mismatch..."}
                            value={reviewNote}
                            onChange={(e) => setReviewNote(e.target.value)}
                            className="mt-2"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setActionType(null)}>Cancel</Button>
                        <Button
                            variant={actionType === 'Approved' ? 'default' : 'destructive'}
                            onClick={handleApproval}
                            disabled={isProcessing || !reviewNote.trim()}
                        >
                            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : actionType === 'Approved' ? <CheckCircle className="h-4 w-4 mr-2" /> : <XCircle className="h-4 w-4 mr-2" />}
                            Confirm {actionType}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

export function OrderDetailsView({ orderId, onClose, lockToken, onUpdated }: { orderId: string, onClose?: () => void, lockToken?: string, onUpdated?: () => void }) {

    const { user: clerkUser } = useUser();
    const LOGGED_IN_STAFF_ID = clerkUser?.id || '';

    const { toast } = useToast();
    const router = useRouter();

    const [order, setOrder] = React.useState<OrderType | undefined>(undefined);
    const [staffRecords, setStaffRecords] = React.useState<StaffMember[]>([]);
    const [currentUser, setCurrentUser] = React.useState<StaffMember | null>(null);
    const [customerHistory, setCustomerHistory] = React.useState<OrderType[]>([]);
    const [issues, setIssues] = React.useState<Issue[]>([]);
    const [deliveryReport, setDeliveryReport] = React.useState<DeliveryReport | null>(null);
    const [isReportLoading, setIsReportLoading] = React.useState(true);
    const [allStatuses, setAllStatuses] = React.useState<OrderStatus[]>([]);
    const [businesses, setBusinesses] = React.useState<Business[]>([]);
    const [courierServices, setCourierServices] = React.useState<CourierService[]>([]);
    const [accounts, setAccounts] = React.useState<Account[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isSending, setIsSending] = React.useState(false);

    // -- Real-time Sync State --
    const [lastCheckTime, setLastCheckTime] = React.useState<string>(new Date().toISOString());
    const [isExternalChecking, setIsExternalChecking] = React.useState(false);
    const [isRefundDialogOpen, setIsRefundDialogOpen] = React.useState(false);
    const [wholesaleReviewMode, setWholesaleReviewMode] = React.useState(false);

    const handleWholesaleEditAndApprove = async (data: any) => {
        if (!order) return;
        try {
            const { editAndApproveWholesaleOrder } = await import('@/services/wholesale');
            await editAndApproveWholesaleOrder({
                orderId: order.id,
                note: data.reviewNote || 'Approved with edits via review',
                editedFields: {
                    products: data.products,
                    shipping: data.shipping,
                    discount: data.discount,
                    paymentMethod: data.paymentMethod,
                    customerName: data.customerName,
                    customerPhone: data.customerPhone,
                    shippingAddress: data.shippingAddress
                }
            });
            toast({
                title: "Wholesale Order Approved",
                description: "The order has been updated and approved.",
            });
            setWholesaleReviewMode(false);
            getOrderById(orderId).then(updated => { if (updated) setOrder(updated); });
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: "Failed to approve wholesale order",
                description: error.message,
            });
        }
    };

    const [refundAmount, setRefundAmount] = React.useState(0);
    const [refundAccountId, setRefundAccountId] = React.useState('');
    const [isRefundSaving, setIsRefundSaving] = React.useState(false);
    const [isNotFound, setIsNotFound] = React.useState(false);
    const [generalSettings, setGeneralSettings] = React.useState<any>(null);

    const badgeRules = React.useMemo(
        () => normalizeBadgeRules(generalSettings?.badgeRules, defaultBadgeRules),
        [generalSettings]
    );

    const [selectedCourier, setSelectedCourier] = React.useState<string | undefined>();
    const [isReassignDialogOpen, setIsReassignDialogOpen] = React.useState(false);
    const [issueSaving, setIssueSaving] = React.useState<Record<string, boolean>>({});
    const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
    const [isSplitDialogOpen, setIsSplitDialogOpen] = React.useState(false);
    const [isExchangeDialogOpen, setIsExchangeDialogOpen] = React.useState(false);
    const [menuResetKey, setMenuResetKey] = React.useState(0);
    const [ipBlocked, setIpBlocked] = React.useState<boolean>(false);
    const [phoneBlocked, setPhoneBlocked] = React.useState<boolean>(false);
    const [lockStatus, setLockStatus] = React.useState<{ active: boolean, token?: string, owner?: OrderOpenLock }>({
        active: false,
        token: undefined
    });
    const [isReadOnly, setIsReadOnly] = React.useState(false);
    const [overrideLoading, setOverrideLoading] = React.useState(false);
    const [ownsLock, setOwnsLock] = React.useState(false); // Track if this component owns the lock

    // Effect A: Lock acquisition (on mount or orderId change)
    React.useEffect(() => {
        // If lockToken passed from parent, use it (parent manages the lock)
        if (lockToken) {
            setLockStatus({ active: true, token: lockToken });
            setOwnsLock(false); // Parent owns it
            return;
        }

        // Otherwise, try to acquire our own lock
        let mounted = true;

        const initLock = async () => {
            try {
                const result = await acquireOrderOpenLock(orderId);
                if (!mounted) return;

                if (result.success && result.acquired) {
                    setLockStatus({ active: true, token: result.lock.token });
                    setOwnsLock(true); // We acquired it
                } else if (result.lock) {
                    // Locked by another
                    setIsReadOnly(true);
                    setLockStatus({ active: false, owner: result.lock });
                    setOwnsLock(false);
                }
            } catch (error: any) {
                if (!mounted) return;

                if (error.code === 'LOCKED') {
                    setIsReadOnly(true);
                    setLockStatus({ active: false, owner: error.lock });
                    setOwnsLock(false);
                } else if (error.code === 'FORBIDDEN') {
                    // User doesn't have update permission, open read-only
                    setIsReadOnly(true);
                    setLockStatus({ active: false });
                    setOwnsLock(false);
                } else {
                    console.error('Lock acquire failed', error);
                }
            }
        };

        initLock();

        return () => {
            mounted = false;
        };
    }, [orderId, lockToken]);

    // Effect B: Heartbeat (only if we have an active lock)
    React.useEffect(() => {
        if (!lockStatus.active || !lockStatus.token) return;

        const heartbeatInterval = setInterval(async () => {
            if (document.hidden) return;
            const res = await heartbeatOrderOpenLock(orderId, lockStatus.token!);
            if (!res.active) {
                setLockStatus(prev => ({ ...prev, active: false }));
                toast({
                    variant: "destructive",
                    title: "Edit Lock Lost",
                    description: "Your session validation failed. Please refresh.",
                });
            }
        }, 20000); // 20s heartbeat

        return () => {
            clearInterval(heartbeatInterval);
        };
    }, [lockStatus.active, lockStatus.token, orderId]);

    // Effect C: Release lock on unmount (only if we own it)
    React.useEffect(() => {
        return () => {
            if (ownsLock && lockStatus.token) {
                releaseOrderOpenLock(orderId, lockStatus.token).catch(() => { });
            }
        };
    }, [ownsLock, lockStatus.token, orderId]);

    const handleOverride = async () => {
        setOverrideLoading(true);
        try {
            const result = await acquireOrderOpenLock(orderId, true);
            if (result.success && result.acquired) {
                setLockStatus({ active: true, token: result.lock.token });
                setIsReadOnly(false);
                setOwnsLock(true); // We now own the lock
                toast({ title: "Lock Acquired", description: "You have overridden the lock." });
            }
        } catch (err: any) {
            toast({ variant: "destructive", title: "Override failed", description: err.message });
        } finally {
            setOverrideLoading(false);
        }
    };

    // ... existing restrictions logic ...

    const [isCheckingRestrictions, setIsCheckingRestrictions] = React.useState(false);
    // ...

    const [blockScope, setBlockScope] = React.useState<'SITE' | 'GLOBAL'>('SITE');

    const checkRestrictions = React.useCallback(async (ip?: string, phone?: string, integrationId?: string) => {
        setIsCheckingRestrictions(true);
        try {
            if (ip) {
                const res = await fetch(`/api/restrictions?targetType=IP&targetValue=${ip}`);
                if (res.ok) {
                    const data = await res.json();
                    setIpBlocked(data.length > 0);
                }
            }
            if (phone) {
                const query = new URLSearchParams({
                    targetType: 'PHONE',
                    targetValue: phone
                });
                if (integrationId) query.append('integrationId', integrationId);

                const res = await fetch(`/api/restrictions?${query.toString()}`);
                if (res.ok) {
                    const data = await res.json();
                    setPhoneBlocked(data.length > 0);
                }
            }
        } catch (e) {
            console.error('Failed to check restrictions', e);
        } finally {
            setIsCheckingRestrictions(false);
        }
    }, []);

    React.useEffect(() => {
        if (order) {
            checkRestrictions(order.rawPayload?.customer_ip_address, order.customerPhone, order.integrationId ?? undefined);
        }
    }, [order, checkRestrictions]);

    const releaseFocusAndOpen = (openFn: () => void) => {
        try {
            (document.activeElement as HTMLElement | null)?.blur?.();
        } catch { }
        window.setTimeout(() => {
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
            setMenuResetKey(k => k + 1);
        }, 0);
    };

    const handleEditOpenChange = (open: boolean) => {
        setIsEditDialogOpen(open);
        if (!open) resetMenuFocus();
    };

    const handleSplitOpenChange = (open: boolean) => {
        setIsSplitDialogOpen(open);
        if (!open) resetMenuFocus();
    };

    const handleExchangeOpenChange = (open: boolean) => {
        setIsExchangeDialogOpen(open);
        if (!open) resetMenuFocus();
    };

    const handleRefundOpenChange = (open: boolean) => {
        setIsRefundDialogOpen(open);
        if (open && order) {
            setRefundAmount(Number(order.paidAmount || 0));
            if (!refundAccountId) {
                const fallback = order.paidFromAccountId || accounts[0]?.id || '';
                if (fallback) setRefundAccountId(fallback);
            }
        }
    };

    const productImageSrc = React.useCallback((product: OrderProduct) => {
        const image = (product as any).image ?? (product as any).imageUrl ?? (product as any).product?.image;
        return resolveImageSrc(image);
    }, []);

const ProductThumb = React.useCallback(({ product, size = 64 }: { product: OrderProduct; size?: number }) => {
        const imgSrc = productImageSrc(product);
        const alt = product.name && product.name.trim().length > 0 ? product.name : 'Product image';

        return (
            <div className="relative" style={{ width: size, height: size }}>
                <Image
                    alt={alt}
                    className="h-full w-full rounded-md object-cover"
                    height={size}
                    width={size}
                    src={imgSrc}
                    onError={() => {
                        // fallback handled by parent
                    }}
                />
            </div>
        );
    }, [productImageSrc]);

    const deriveShippingAddress = React.useCallback((shippingAddress: any) => {
        const topLevel = shippingAddress && typeof shippingAddress === 'object'
            ? {
                address: typeof shippingAddress.address === 'object' ? shippingAddress.address?.address : shippingAddress.address,
                zone: shippingAddress.zoneName || shippingAddress.zone,
                city: shippingAddress.cityName || shippingAddress.city || shippingAddress.district,
                country: shippingAddress.country,
            }
            : null;
        if (topLevel?.address) {
            return [topLevel.address, topLevel.zone, topLevel.city, topLevel.country].filter(Boolean).join(', ');
        }
        const ship = shippingAddress?.shipping || shippingAddress?.billing || shippingAddress || {};
        const line1 = ship.address_1 || ship.address || '';
        const line2 = ship.address_2 || '';
        const city = ship.city || shippingAddress?.cityName || shippingAddress?.district || '';
        const zone = ship.zone || shippingAddress?.zoneName || '';
        const country = ship.country || 'BD';
        return [line1, line2, zone, city, country].filter(Boolean).join(', ');
    }, []);

    const renderUtmBox = React.useCallback((payload: any) => {
        if (!payload) return null;
        let utmSource = '';
        let utmMedium = '';
        let utmCampaign = '';

        try {
            const scanMeta = (meta: any) => {
                const k = (meta?.key || '').toString().toLowerCase();
                const v = typeof meta?.value === 'string' ? decodeURIComponent(meta.value).trim() : meta?.value;
                if (k === 'utm_source') utmSource = utmSource || v;
                if (k === 'utm_medium') utmMedium = utmMedium || v;
                if (k === 'utm_campaign' || k === 'utm_id' || k === '_wc_order_attribution_utm_campaign') utmCampaign = utmCampaign || v;
            };
            if (Array.isArray(payload.meta_data)) {
                payload.meta_data.forEach(scanMeta);
            } else if (payload.meta_data && typeof payload.meta_data === 'object') {
                Object.entries(payload.meta_data).forEach(([key, value]) => scanMeta({ key, value }));
            }
            if (payload.landingPage) {
                const url = new URL(payload.landingPage);
                utmSource = utmSource || url.searchParams.get('utm_source') || '';
                utmMedium = utmMedium || url.searchParams.get('utm_medium') || '';
                utmCampaign = utmCampaign || url.searchParams.get('utm_campaign') || url.searchParams.get('utm_id') || '';
            }
        } catch { }

        if (!utmSource && !utmMedium && !utmCampaign) return null;

        return (
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <Globe className="w-4 h-4 text-muted-foreground" /> Marketing Attribution
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm pt-0">
                    <div className="grid grid-cols-[1fr_2fr] gap-1">
                        <span className="text-muted-foreground">Campaign:</span>
                        <span className="font-medium truncate" title={utmCampaign || 'None'}>{utmCampaign || '-'}</span>
                    </div>
                    <div className="grid grid-cols-[1fr_2fr] gap-1">
                        <span className="text-muted-foreground">Source:</span>
                        <span className="font-medium truncate capitalize">{utmSource || '-'}</span>
                    </div>
                    <div className="grid grid-cols-[1fr_2fr] gap-1">
                        <span className="text-muted-foreground">Medium:</span>
                        <span className="font-medium truncate capitalize">{utmMedium || '-'}</span>
                    </div>
                </CardContent>
            </Card>
        );
    }, []);


    const statusForm = useForm<StatusUpdateFormValues>({
        defaultValues: {
            status: undefined,
            officeNote: '',
        },
    });
    const [isStatusSaving, setIsStatusSaving] = React.useState(false);

    React.useEffect(() => {
        const fetchData = async () => {
            if (!orderId) return;
            setIsLoading(true);
            const id = orderId;
            try {
                const [
                    orderData,
                    statusData,
                    businessData,
                    courierData,
                    issueData,
                    staffData,
                    userData,
                    accountingData,
                    generalSettingsData
                ] = await Promise.all([
                    getOrderById(id).catch(e => { console.error('Error fetching order:', e); return undefined; }),
                    getStatuses().catch(e => { console.error('Error fetching statuses:', e); return []; }),
                    getBusinesses().catch(e => { console.error('Error fetching businesses:', e); return []; }),
                    getCourierServices().catch(e => { console.error('Error fetching courier services:', e); return []; }),
                    getIssuesByOrderId(id).catch(e => { console.error('Error fetching issues:', e); return []; }),
                    getStaff().catch(e => { console.error('Error fetching staff:', e); return { items: [] }; }),
                    LOGGED_IN_STAFF_ID ? getStaffMemberByClerkId(LOGGED_IN_STAFF_ID).catch(e => { console.error('Error fetching user:', e); return undefined; }) : Promise.resolve(undefined),
                    getChartOfAccounts().catch(e => { console.error('Error fetching accounts:', e); return []; }),
                    fetch('/api/settings/general').then(res => res.json()).catch(e => { console.error('Error fetching general settings:', e); return null; })
                ]);

                if (!orderData) {
                    setIsNotFound(true);
                    return;
                }

                setOrder(orderData);
                // Fix: statusData might be string array, need to normalize to string array for allStatuses
                const normalizedStatuses = statusData.map(s => typeof s === 'string' ? s : (s as any).name);
                setAllStatuses(normalizedStatuses);
                setBusinesses(businessData);
                setCourierServices(courierData);
                setIssues(issueData);
                setStaffRecords(staffData.items);
                setCurrentUser(userData as any);
                setAccounts(accountingData);
                setGeneralSettings(generalSettingsData);

                // FIX: Pre-fill status form with the order's current state
                statusForm.reset({
                    status: orderData.status,
                    officeNote: orderData.officeNote || '',
                });

                if (orderData.customerPhone) {
                    setIsReportLoading(true);
                    getDeliveryReport(orderData.customerPhone).then(report => {
                        setDeliveryReport(report);
                    }).finally(() => {
                        setIsReportLoading(false);
                    });

                    // Fetch customer order history
                    getOrdersByCustomerPhone(orderData.customerPhone).then(orders => {
                        setCustomerHistory(orders);
                    }).catch(e => {
                        console.error('Error fetching customer history:', e);
                    });

                    // Check restrictions
                    checkRestrictions(
                        orderData.rawPayload?.customer_ip_address,
                        orderData.customerPhone,
                        orderData.integrationId ?? undefined
                    );
                }
            } catch (error: any) {
                console.error("Critical error in OrderDetailsPage data fetch:", error);
                toast({
                    variant: 'destructive',
                    title: 'Failed to load order details',
                    description: error.message || 'Unknown error',
                });
                setIsNotFound(true);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [orderId, statusForm.reset, LOGGED_IN_STAFF_ID]);

    // -- Real-time Polling for specific order --
    React.useEffect(() => {
        if (!orderId || !order) return;

        const interval = setInterval(async () => {
            if (document.hidden || isExternalChecking) return;
            try {
                const result = await getOrderChanges(lastCheckTime, [orderId]);
                if (result.changedIds.includes(orderId)) {
                    console.log('[REALTIME] Order updated externally:', orderId);
                    toast({
                        title: "Order Updated",
                        description: "This order has been updated by another user. Refreshing view...",
                    });
                    const refreshed = await getOrderById(orderId);
                    if (refreshed) setOrder(refreshed);
                }
                setLastCheckTime(result.serverTime);
            } catch (err) {
                console.error('[REALTIME] Polling error:', err);
            }
        }, 5000 + Math.random() * 2000); // 5-7s jittered

        return () => clearInterval(interval);
    }, [orderId, order, lastCheckTime, isExternalChecking, toast]);

    // -- Multi-Tab Sync Logic --
    React.useEffect(() => {
        if (!orderId) return;
        const unsub = subscribeToOrderUpdates((event) => {
            if (event.orderId === orderId && event.source !== 'client-update') {
                console.log('[SYNC] Order updated in another tab:', orderId);
                getOrderById(orderId).then(refreshed => {
                    if (refreshed) setOrder(refreshed);
                });
            }
        });
        return unsub;
    }, [orderId]);

    // -- Instant refresh on tab focus --
    React.useEffect(() => {
        const handleVisibilityChange = () => {
            if (!document.hidden && orderId) {
                getOrderById(orderId).then(refreshed => {
                    if (refreshed) setOrder(refreshed);
                });
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [orderId]);

    const handleFetchReport = React.useCallback(async (phone: string) => {
        if (!phone) return;

        const cached = reportCache.get(phone);
        if (cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
            setDeliveryReport(cached.data);
            setIsReportLoading(false);
            return;
        }

        setIsReportLoading(true);
        try {
            const report = await getDeliveryReport(phone);
            if (report) {
                reportCache.set(phone, { data: report, timestamp: Date.now() });
                setDeliveryReport(report);
            }
        } finally {
            setIsReportLoading(false);
        }
    }, []);

    const customerHistoryStats = React.useMemo(() => {
        const totalOrders = customerHistory.length;
        const delivered = customerHistory.filter(o => o.status === 'Delivered').length;
        const canceled = customerHistory.filter(o => o.status === 'Canceled').length;
        const returned = customerHistory.filter(o => o.status === 'Returned' || o.status === 'Return Pending').length;
        const processing = totalOrders - (delivered + canceled + returned);
        const recentDate = subHours(new Date(), 48);
        const recentOrders = customerHistory.filter(o => isAfter(new Date(o.date), recentDate));

        return { totalOrders, delivered, canceled, returned, processing, recentOrders };
    }, [customerHistory]);

    const customerBadge = React.useMemo(() => {
        return getBadgeForValue(badgeRules.customerOrders, customerHistoryStats.totalOrders);
    }, [badgeRules, customerHistoryStats.totalOrders]);

    async function onStatusSubmit(data: StatusUpdateFormValues) {
        if (!order) return;

        // FIX: Guard against empty / missing status
        if (!data.status) {
            toast({
                variant: 'destructive',
                title: 'Invalid Status',
                description: 'Please select a status before saving.',
            });
            return;
        }

        setIsStatusSaving(true);
        try {
            const updated = await updateOrder(order.id, {
                status: data.status as OrderStatus,
                officeNote: data.officeNote,
                expectedUpdatedAt: order.updatedAt?.toString(),
                lockToken: lockToken,
            });
            if (!updated) throw new Error('Failed to update order');

            // Some status transitions trigger server-side side effects (e.g., courier cancel API + webhook),
            // so re-fetch once to ensure Order History reflects the latest logs.
            const refreshed = await getOrderById(order.id);
            setOrder(refreshed || updated);
            toast({
                title: "Order Updated",
                // FIX: Use server-returned status in description
                description: `Status changed to ${updated.status}.`,
            });
            onUpdated?.();
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Update failed',
                description: getStatusUpdateErrorMessage(err, data.status as string),
            });
        } finally {
            setIsStatusSaving(false);
        }
    }

    const handleRefundSubmit = async () => {
        if (!order) return;
        const amount = Number(refundAmount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
            toast({
                variant: 'destructive',
                title: 'Invalid amount',
                description: 'Enter a valid refund amount.',
            });
            return;
        }
        if (amount > Number(order.paidAmount || 0)) {
            toast({
                variant: 'destructive',
                title: 'Refund exceeds paid amount',
                description: 'Refund amount cannot be greater than paid amount.',
            });
            return;
        }
        if (!refundAccountId) {
            toast({
                variant: 'destructive',
                title: 'Select an account',
                description: 'Choose an account to record the refund.',
            });
            return;
        }

        setIsRefundSaving(true);
        try {
            const updated = await updateOrder(order.id, {
                paidAmount: Number((Number(order.paidAmount || 0) - amount).toFixed(2)),
                refundAccountId,
            });
            if (!updated) throw new Error('Failed to update order');
            setOrder(updated);
            toast({
                title: 'Refund recorded',
                description: `Refunded Tk${amount.toFixed(2)}.`,
            });
            onUpdated?.();
            setIsRefundDialogOpen(false);
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Refund failed',
                description: err?.message || 'Could not record refund.',
            });
        } finally {
            setIsRefundSaving(false);
        }
    };
    async function handleSendToCourier() {
        if (!order || !selectedCourier) return;
        setIsSending(true);
        try {
            if (selectedCourier === 'Steadfast') {
                const res = await fetch('/api/orders/dispatch/steadfast', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderIds: [order.id], user: currentUser?.name || 'System' }),
                });
                const raw = await res.json();
                if (!res.ok) throw new Error(raw?.message || 'Dispatch failed');
                const data = raw?.data || raw;
                const result = Array.isArray(data?.results) ? data.results[0] : null;
                if (!result?.ok) throw new Error(result?.message || 'Dispatch failed');
                setOrder(prev => prev ? {
                    ...prev,
                    courierService: 'Steadfast',
                    courierTrackingCode: result.trackingCode || prev.courierTrackingCode,
                    courierConsignmentId: result.consignmentId || prev.courierConsignmentId,
                    courierStatus: result.courierStatus || prev.courierStatus,
                } : prev);
                toast({
                    title: "Sent to Steadfast",
                    description: result.trackingCode
                        ? `Tracking code: ${result.trackingCode}`
                        : `Order ${order.id} dispatched.`,
                });
                onUpdated?.();
            } else if (selectedCourier === 'Pathao') {
                const res = await fetch('/api/orders/dispatch/pathao', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderIds: [order.id], user: currentUser?.name || 'System' }),
                });
                const raw = await res.json();
                if (!res.ok) throw new Error(raw?.message || 'Dispatch failed');
                const data = raw?.data || raw;
                const result = Array.isArray(data?.results) ? data.results[0] : null;
                if (!result?.ok) throw new Error(result?.message || 'Dispatch failed');
                setOrder(prev => prev ? {
                    ...prev,
                    courierService: 'Pathao',
                    courierTrackingCode: result.trackingCode || prev.courierTrackingCode,
                    courierConsignmentId: result.consignmentId || prev.courierConsignmentId,
                    courierStatus: result.courierStatus || prev.courierStatus,
                } : prev);
                toast({
                    title: "Sent to Pathao",
                    description: result.trackingCode
                        ? `Tracking: ${result.trackingCode}`
                        : `Order ${order.id} dispatched.`,
                });
                onUpdated?.();
            } else if (selectedCourier === 'Carrybee') {
                const res = await fetch('/api/orders/dispatch/carrybee', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderIds: [order.id], user: currentUser?.name || 'System' }),
                });
                const raw = await res.json();
                if (!res.ok) throw new Error(raw?.message || 'Dispatch failed');
                const data = raw?.data || raw;
                const result = Array.isArray(data?.results) ? data.results[0] : null;
                if (!result?.ok) {
                    const detail = (() => {
                        const message = result?.message || '';
                        const payload = result?.responsePayload;
                        let payloadText = '';
                        if (typeof payload === 'string') payloadText = payload;
                        else if (payload && typeof payload === 'object') {
                            try { payloadText = JSON.stringify(payload); } catch { /* ignore */ }
                        }
                        if (payloadText) return message ? `${message} | ${payloadText}` : payloadText;
                        return message || '';
                    })();
                    throw new Error(detail || 'Dispatch failed');
                }
                setOrder(prev => prev ? {
                    ...prev,
                    courierService: 'Carrybee',
                    courierTrackingCode: result.trackingCode || prev.courierTrackingCode,
                    courierConsignmentId: result.consignmentId || prev.courierConsignmentId,
                    courierStatus: result.courierStatus || prev.courierStatus,
                } : prev);
                toast({
                    title: "Sent to Carrybee",
                    description: result.trackingCode
                        ? `Tracking: ${result.trackingCode}`
                        : `Order ${order.id} dispatched.`,
                });
                onUpdated?.();
            } else {
                // Placeholder for other couriers
                const updated = await updateOrder(order.id, { status: 'In-Courier' as OrderStatus, courierService: selectedCourier } as any);
                if (updated) setOrder(updated);
                toast({
                    title: "Order Sent",
                    description: `Order ${order.id} marked In-Courier via ${selectedCourier}.`,
                });
                onUpdated?.();
            }
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Dispatch failed',
                description: err?.message || `Could not send to ${selectedCourier}.`,
            });
        } finally {
            setIsSending(false);
        }
    }

    const handleAssignToMe = async () => {
        if (!order || !currentUser) return;
        try {
            const updated = await updateOrder(order.id, { assignedTo: currentUser.name, assignedToId: currentUser.id });
            if (updated) {
                setOrder(updated);
                toast({
                    title: "Order Assigned",
                    description: `Order ${order.id} has been assigned to you.`,
                });
                onUpdated?.();
            } else {
                throw new Error('Failed to assign order');
            }
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Assign failed',
                description: err?.message || 'Could not assign order.',
            });
        }
    };

    const formatIssueId = (id: string) => `ISS-${id.slice(-6).toUpperCase()}`;

    const handleIssueStatusInline = async (issueId: string, status: IssueStatus) => {
        setIssueSaving(prev => ({ ...prev, [issueId]: true }));
        try {
            const updated = await updateIssue(issueId, { status });
            if (updated) {
                setIssues(prev => prev.map(i => i.id === issueId ? { ...i, status: updated.status } : i));
                toast({ title: 'Issue updated', description: `Status set to ${status}.` });
            } else {
                throw new Error('Failed to update issue');
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Issue update failed', description: err?.message || 'Could not update issue.' });
        } finally {
            setIssueSaving(prev => ({ ...prev, [issueId]: false }));
        }
    };

    // Check for related issues
    const relatedIssues = React.useMemo(() => {
        return issues.filter(i => i.orderId === orderId);
    }, [issues, orderId]);

    if (isLoading) {
        return <div className="p-6">Loading order details...</div>;
    }

    if (!order) {
        return (
            <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 justify-center items-center">
                <p>Order not found.</p>
                {!onClose && (
                    <Button asChild>
                        <Link href="/dashboard/orders/all">Go Back to Orders</Link>
                    </Button>
                )}
            </div>
        );
    }

    const whatsappMessage = `Hello ${order.customerName}, regarding your order ${order.orderNumber || order.id}:\n- Total: ?${Number(order.total ?? 0).toFixed(2)}\n- Status: ${order.status}\n\nWe will update you shortly. Thank you!`;
    const phoneMeta = normalizeBdPhoneForStorage(order.customerPhone);
    const phoneDisplay = phoneMeta.isValid ? phoneMeta.last11 : (phoneMeta.value || order.customerPhone);
    const telHref = formatTelHref(order.customerPhone);
    const whatsappHref = formatWhatsAppHref(order.customerPhone, whatsappMessage);
    const subtotal = order.products.reduce((acc, p) => acc + p.price * p.quantity, 0);
    const siteDiscountTotal = order.products.reduce((sum, p) => sum + (p.siteDiscount || 0), 0);
    const fallbackTotal = subtotal + Number(order.shipping || 0) - Number(order.discount || 0) - siteDiscountTotal;
    const total = Number.isFinite(Number(order.total)) ? Number(order.total) : fallbackTotal;
    const effectiveDiscount = Math.max(subtotal + Number(order.shipping || 0) - total, 0);
    const paidAmount = Number(order.paidAmount || 0);
    const shippingPaidAmount = order.shippingPaid ? Number(order.shippingPaidAmount || 0) : 0;
    const totalPaid = paidAmount + shippingPaidAmount;
    const amountDue = Math.max(total - totalPaid, 0);

    return (
        <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6 xl:p-8">
            {order.channel === 'Wholesale' && order.wholesaleApprovalStatus === 'Pending' && (
                <WholesaleReviewBanner
                    order={order}
                    onAction={() => getOrderById(orderId).then(updated => { if (updated) setOrder(updated); })}
                    onEditClick={() => setWholesaleReviewMode(true)}
                />
            )}

            {wholesaleReviewMode && (
                <NewOrderDialog
                    open={wholesaleReviewMode}
                    onOpenChange={setWholesaleReviewMode}
                    orderToEdit={order}
                    onSubmitOverride={async (payload) => {
                        const note = window.prompt("Please enter a note for approving with these edits:");
                        if (note === null) throw new Error("Approval cancelled");
                        if (!note.trim()) {
                            toast({ variant: 'destructive', title: "Reason Required", description: "Approval note is mandatory." });
                            throw new Error("Approval note is mandatory");
                        }

                        try {
                            const { editAndApproveWholesaleOrder } = await import('@/services/wholesale');
                            await editAndApproveWholesaleOrder({
                                orderId: order.id,
                                note: note.trim(),
                                editedFields: payload
                            });
                            toast({ title: 'Order Approved', description: 'Edits saved and order approved.' });
                        } catch (e: any) {
                            toast({ variant: 'destructive', title: 'Approval Error', description: e.message });
                            throw e; // Rethrow so NewOrderDialog stays open/submitting state handled
                        }
                        getOrderById(orderId).then(updated => { if (updated) setOrder(updated); });
                        setWholesaleReviewMode(false);
                    }}
                />
            )}
            <div className="flex items-center gap-4 pr-10 sm:pr-0">
                {onClose ? (
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={onClose}>
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">Close</span>
                    </Button>
                ) : (
                    <Button variant="outline" size="icon" className="h-7 w-7" asChild>
                        <Link href="/dashboard/orders/all">
                            <ChevronLeft className="h-4 w-4" />
                            <span className="sr-only">Back</span>
                        </Link>
                    </Button>
                )}

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h1 className="shrink-0 whitespace-nowrap text-xl font-semibold tracking-tight sm:grow-0">
                            Order No: {order.orderNumber || order.id}
                        </h1>
                        {order.shipmentStale && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <AlertCircle className="h-5 w-5 text-red-600 animate-pulse cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Shipment stale: No update for 12h+</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                    {(order.platform || order.businessName) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                            {order.platform && (
                                <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5">
                                    <Monitor className="h-3 w-3" />
                                    Plt: {order.platform}
                                </span>
                            )}
                            {order.businessName && (
                                <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5">
                                    <Globe className="h-3 w-3" />
                                    {order.businessName}
                                </span>
                            )}
                        </div>
                    )}
                    {/* {order.orderNumber && (
                        <div className="flex gap-2 text-sm text-muted-foreground">
                            {order.id}
                        </div>
                    )} */}
                </div>
                <Badge
                    variant="outline"
                    className={cn('ml-auto sm:ml-0', statusColors[order.status])}
                >
                    {order.status}
                </Badge>
                <div className="hidden items-center gap-2 md:ml-auto md:flex">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsEditDialogOpen(true)}
                        disabled={order.status === 'Delivered' || order.status === 'Returned' || isReadOnly || !lockStatus.active}
                    >
                        <Edit className="mr-2 h-4 w-4" />
                        Edit Order
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setIsSplitDialogOpen(true)} disabled={isReadOnly || !lockStatus.active}>
                        <Scissors className="mr-2 h-4 w-4" />
                        Split Order
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setIsExchangeDialogOpen(true)} disabled={isReadOnly || !lockStatus.active}>
                        <ArrowRightLeft className="mr-2 h-4 w-4" />
                        Exchange
                    </Button>
                    <Button variant="destructive" size="sm" asChild>
                        <Link href={`/dashboard/issues/new?orderId=${encodeURIComponent(order.orderNumber || order.id)}`}>
                            <AlertCircle className="mr-2 h-4 w-4" />
                            Report Issue
                        </Link>
                    </Button>
                </div>

                <DropdownMenu key={`order-actions-${menuResetKey}`}>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon" className="h-8 w-8 md:hidden">
                            <MoreVertical className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem
                            onSelect={() => releaseFocusAndOpen(() => setIsEditDialogOpen(true))}
                            disabled={order.status === 'Delivered' || order.status === 'Returned' || isReadOnly || !lockStatus.active}
                        >
                            Edit Order
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => releaseFocusAndOpen(() => setIsSplitDialogOpen(true))} disabled={isReadOnly || !lockStatus.active}>
                            Split Order
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => releaseFocusAndOpen(() => setIsExchangeDialogOpen(true))} disabled={isReadOnly || !lockStatus.active}>
                            Exchange
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild><Link href={`/print/invoice/${order.id}`} target="_blank">Print Invoice</Link></DropdownMenuItem>
                        <DropdownMenuItem asChild><Link href={`/print/sticker/${order.id}`} target="_blank">Print Sticker</Link></DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild className="text-destructive">
                            <Link href={`/dashboard/issues/new?orderId=${encodeURIComponent(order.orderNumber || order.id)}`}>Report Issue</Link>
                        </DropdownMenuItem>
                    </DropdownMenuContent>

                </DropdownMenu>

                <NewOrderDialog
                    open={isEditDialogOpen}
                    onOpenChange={handleEditOpenChange}
                    orderToEdit={order}
                    onOrderCreated={() => {
                        // Refresh order data
                        getOrderById(orderId).then(updated => {
                            if (updated) setOrder(updated);
                        });
                        onUpdated?.();
                    }}
                />

                <SplitOrderDialog
                    open={isSplitDialogOpen}
                    onOpenChange={handleSplitOpenChange}
                    order={order}
                    onSuccess={() => {
                        getOrderById(orderId).then(updated => {
                            if (updated) setOrder(updated);
                        });
                        onUpdated?.();
                    }}
                />

                <NewOrderDialog
                    open={isExchangeDialogOpen}
                    onOpenChange={handleExchangeOpenChange}
                    baseOrderForExchange={order}
                    onOrderCreated={() => {
                        getOrderById(orderId).then(updated => {
                            if (updated) setOrder(updated);
                        });
                        onUpdated?.();
                    }}
                />
            </div>

            {isReadOnly && lockStatus.owner && (
                <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-2 dark:bg-amber-900/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            <Lock className="h-5 w-5 text-amber-500 mr-2" />
                            <div>
                                <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
                                    This order is currently being edited by {lockStatus.owner.staffName} ({lockStatus.owner.staffCode})
                                </p>
                                <p className="text-xs text-amber-700 dark:text-amber-300">
                                    You are in read-only mode.
                                </p>
                            </div>
                        </div>
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleOverride}
                            disabled={overrideLoading}
                        >
                            {overrideLoading ? 'Overriding...' : 'Override Lock'}
                        </Button>
                    </div>
                </div>
            )}
            {!lockStatus.active && !isReadOnly && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-2 dark:bg-red-900/20">
                    <div className="flex items-center">
                        <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
                        <p className="text-sm font-medium text-red-800 dark:text-red-200">
                            Connection to lock server lost. Editing is disabled. Please refresh.
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 xl:gap-8 relative">
                <div className="lg:col-span-2">
                    <Tabs defaultValue="items" className="w-full">
                        <TabsList className="grid w-full grid-cols-3 mb-4">
                            <TabsTrigger value="items">Order Items</TabsTrigger>
                            <TabsTrigger value="timeline">Timeline & Notes</TabsTrigger>
                            <TabsTrigger value="issues">
                                Related Issues
                                {issues.length > 0 && <Badge variant="secondary" className="ml-2 h-5 px-1.5">{issues.length}</Badge>}
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="items" className="space-y-6">
                            <Card>
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <CardTitle>Order Items</CardTitle>
                                        <Badge variant="outline">{order.products.length} Items</Badge>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="hidden sm:block">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="w-[80px]">Image</TableHead>
                                                    <TableHead>Name</TableHead>
                                                    <TableHead>SKU</TableHead>
                                                    <TableHead className="text-right">Qty</TableHead>
                                                    <TableHead className="text-right">Price</TableHead>
                                                    <TableHead className="text-right">Site Disc.</TableHead>
                                                    <TableHead className="text-right">Total</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {order.products.map((product, index) => (
                                                    <TableRow key={`${product.productId}-${product.variantId ?? 'none'}-${index}`} className={product.stock !== undefined && product.stock <= 0 ? "bg-red-50 hover:bg-red-50/80" : undefined}>
                                                        <TableCell>
                                                            <ProductThumb product={product} />
                                                        </TableCell>
                                                        <TableCell className="font-medium space-y-1">
                                                            <div>{product.name}</div>
                                                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-1">
                                                                {product.variantAttributes && Object.keys(product.variantAttributes).length > 0 && (
                                                                    Object.entries(product.variantAttributes).map(([key, val]) => (
                                                                        <Badge key={key} variant="outline" className="text-[11px]">
                                                                            {key}: {val}
                                                                        </Badge>
                                                                    ))
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2">
                                                                {product.sku || 'N/A'}
                                                                {product.productType === 'variable' && !product.variantId ? (
                                                                    <Badge variant="destructive" className="bg-orange-600 text-[10px] px-1.5 py-0 h-4 uppercase tracking-wider cursor-help" title="Click 'Edit Order' to select a variant">Variant Missing</Badge>
                                                                ) : product.stock !== undefined && product.stock <= 0 && (
                                                                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 uppercase tracking-wider">Out of Stock</Badge>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right">{product.quantity}</TableCell>
                                                        <TableCell className="text-right font-mono">Tk{Number(product.price ?? 0).toFixed(2)}</TableCell>
                                                        <TableCell className="text-right font-mono text-amber-600">
                                                            {product.siteDiscount ? `Tk${Number(product.siteDiscount).toFixed(2)}` : 'Tk0.00'}
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono">Tk{(Number(product.price ?? 0) * (product.quantity ?? 1) - (product.siteDiscount || 0)).toFixed(2)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                    <div className="sm:hidden grid gap-4">
                                        {order.products.map((product, index) => (
                                            <Card key={`${product.productId}-${product.variantId ?? 'none'}-${index}`} className={cn("overflow-hidden", product.stock !== undefined && product.stock <= 0 && "border-red-200 bg-red-50")}>
                                                <CardContent className="p-4 flex gap-4">
                                                    <ProductThumb product={product} />
                                                    <div className="flex-1">
                                                        <p className="font-medium">{product.name}</p>
                                                        <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                                                            {product.sku || 'N/A'}
                                                            {product.productType === 'variable' && !product.variantId ? (
                                                                <Badge variant="destructive" className="bg-orange-600 text-[10px] px-1.5 py-0 h-4 uppercase tracking-wider cursor-help" title="Click 'Edit Order' to select a variant">Variant Missing</Badge>
                                                            ) : product.stock !== undefined && product.stock <= 0 && (
                                                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 uppercase tracking-wider">Out of Stock</Badge>
                                                            )}
                                                        </div>
                                                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mt-1">
                                                            {product.variantAttributes && Object.keys(product.variantAttributes).length > 0 && (
                                                                Object.entries(product.variantAttributes).map(([key, val]) => (
                                                                    <Badge key={key} variant="outline" className="text-[11px]">
                                                                        {key}: {val}
                                                                    </Badge>
                                                                ))
                                                            )}
                                                        </div>
                                                        <div className="flex justify-between items-center mt-2">
                                                            <p className="text-sm">Qty: {product.quantity}</p>
                                                            <p className="font-medium font-mono">Tk{(Number(product.price ?? 0) * (product.quantity ?? 1) - (product.siteDiscount || 0)).toFixed(2)}</p>
                                                        </div>
                                                        <p className="text-xs text-amber-600 mt-1">Site Disc: Tk{product.siteDiscount?.toFixed(2) || '0.00'}</p>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <CourierReport report={deliveryReport} isLoading={isReportLoading} />
                                <Card className="h-full">
                                    <CardHeader className="pb-2 pt-4 px-4"><CardTitle className='flex items-center gap-2 text-base'><CreditCard className='w-4 h-4 text-muted-foreground' />Payment</CardTitle></CardHeader>
                                    <CardContent className='space-y-2 text-sm px-4 pb-4'>
                                        <div className="flex items-center justify-between"><span className="text-muted-foreground">Subtotal</span><span className='font-mono'>Tk{subtotal.toFixed(0)}</span></div>
                                        <div className="flex items-center justify-between"><span className="text-muted-foreground">Discount</span><span className='font-mono text-red-500'>- Tk{effectiveDiscount.toFixed(0)}</span></div>
                                        <div className="flex items-center justify-between"><span className="text-muted-foreground">Shipping</span><span className='font-mono'>Tk{Number(order.shipping ?? 0).toFixed(0)}</span></div>
                                        <Separator className="my-1" />
                                        <div className="flex items-center justify-between font-bold text-base"><span className="">Total</span><span className='font-mono'>Tk{total.toFixed(0)}</span></div>
                                        <div className="flex items-center justify-between"><span className="text-muted-foreground">Paid</span><span className='font-mono text-green-600'>Tk{paidAmount.toFixed(0)}</span></div>
                                        <div className="flex items-center justify-between font-semibold mt-2 pt-2 border-t border-dashed">
                                            <span className={cn(amountDue > 0 && "text-destructive")}>Due</span>
                                            <span className={cn("font-mono text-lg", amountDue > 0 && "text-destructive")}>Tk{amountDue.toFixed(0)}</span>
                                        </div>

                                        {paidAmount > 0 && (
                                            <div className="pt-2">
                                                <Dialog open={isRefundDialogOpen} onOpenChange={handleRefundOpenChange}>
                                                    <DialogTrigger asChild>
                                                        <Button variant="ghost" size="sm" className="w-full text-xs h-7 text-muted-foreground hover:text-destructive" disabled={isReadOnly || !lockStatus.active}>Record Refund</Button>
                                                    </DialogTrigger>
                                                    <DialogContent className="sm:max-w-md">
                                                        <DialogHeader>
                                                            <DialogTitle>Refund Payment</DialogTitle>
                                                            <DialogDescription>
                                                                Enter refund amount and the account to deduct from.
                                                            </DialogDescription>
                                                        </DialogHeader>
                                                        <div className="space-y-4">
                                                            <div className="space-y-2">
                                                                <Label>Amount</Label>
                                                                <Input
                                                                    type="number"
                                                                    value={refundAmount}
                                                                    onChange={(e) => setRefundAmount(Number(e.target.value || 0))}
                                                                />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label>Account</Label>
                                                                <Select value={refundAccountId} onValueChange={setRefundAccountId}>
                                                                    <SelectTrigger>
                                                                        <SelectValue placeholder="Select account" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {accounts.map((account) => (
                                                                            <SelectItem key={account.id} value={account.id}>
                                                                                {account.name}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        </div>
                                                        <DialogFooter>
                                                            <Button onClick={handleRefundSubmit} disabled={isRefundSaving}>Save Refund</Button>
                                                        </DialogFooter>
                                                    </DialogContent>
                                                </Dialog>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>
                        </TabsContent>

                        <TabsContent value="timeline" className="space-y-6">
                            <Card>
                                <CardHeader><CardTitle className='flex items-center gap-2'><StickyNote className='w-5 h-5 text-muted-foreground' /> Notes</CardTitle></CardHeader>
                                <CardContent className="space-y-4">
                                    <div><Label className='text-muted-foreground'>Customer Note</Label><p className="text-sm">{order.customerNote || 'No customer note provided.'}</p></div>
                                    <Separator />
                                    <div><Label className='text-muted-foreground'>Office Note</Label><p className="text-sm">{order.officeNote || 'No office note provided.'}</p></div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader>
                                    <CardTitle>Order History</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <OrderTimeline logs={order.logs} />
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="issues" className="space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Related Issues</CardTitle>
                                    <CardDescription>
                                        All issues associated with this order.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {issues.length > 0 ? (
                                        <>
                                            <div className="hidden sm:block">
                                                <Table>
                                                    <TableHeader>
                                                        <TableRow>
                                                            <TableHead>Issue ID</TableHead>
                                                            <TableHead>Title</TableHead>
                                                            <TableHead>Status</TableHead>
                                                            <TableHead>Priority</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {issues.map(issue => (
                                                            <TableRow key={issue.id}>
                                                                <TableCell className="font-medium">
                                                                    <Link href={`/dashboard/issues/${issue.id}`} className="text-primary hover:underline">{issue.id.substring(0, 8)}...</Link>
                                                                </TableCell>
                                                                <TableCell>{issue.title}</TableCell>
                                                                <TableCell>
                                                                    <Badge variant="outline">{issue.status}</Badge>
                                                                </TableCell>
                                                                <TableCell>
                                                                    <Badge variant={issue.priority === 'High' ? 'destructive' : 'secondary'}>{issue.priority}</Badge>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                            <div className="sm:hidden space-y-4">
                                                {issues.map(issue => (
                                                    <Card key={issue.id}>
                                                        <CardContent className="p-4 space-y-3">
                                                            <div className="flex justify-between items-start">
                                                                <div>
                                                                    <Link href={`/dashboard/issues/${issue.id}`} className="font-semibold hover:underline">{issue.id.substring(0, 8)}...</Link>
                                                                    <p className="text-sm text-muted-foreground">{issue.title}</p>
                                                                </div>
                                                                <Badge variant={issue.priority === 'High' ? 'destructive' : 'secondary'}>{issue.priority}</Badge>
                                                            </div>
                                                            <Separator className="my-3" />
                                                            <div className="flex justify-between items-center">
                                                                <Badge variant="outline">{issue.status}</Badge>
                                                                <p className="text-xs text-muted-foreground">
                                                                    Assigned to: {issue.assignedTo || 'Unassigned'}
                                                                </p>
                                                            </div>
                                                        </CardContent>
                                                    </Card>
                                                ))}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-center py-8 text-muted-foreground flex flex-col items-center gap-2">
                                            <div className="h-10 w-10 bg-muted/50 rounded-full flex items-center justify-center">
                                                <AlertCircle className="h-5 w-5 text-muted-foreground/50" />
                                            </div>
                                            <p>No issues reported for this order.</p>
                                            <Button variant="outline" size="sm" className="mt-2" onClick={() => router.push(`/dashboard/issues/new?orderId=${encodeURIComponent(order.orderNumber || order.id)}`)}>
                                                Create Issue
                                            </Button>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>

                {/* Right Column - Sticky */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="sticky top-4 space-y-6 h-fit overflow-y-auto max-h-[calc(100vh-2rem)] pb-4">
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle>Customer Details</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center gap-4 pr-10 sm:pr-0">
                                    <div className="h-10 w-10 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0 relative">
                                        <User className="h-5 w-5 text-gray-500" />
                                        {customerBadge && (
                                            <div className={cn("absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white", customerBadge.color.replace('bg-', 'bg-').replace('text-', 'bg-'))} title={customerBadge.label} />
                                        )}
                                    </div>
                                    <div className="overflow-hidden flex-1">
                                        <div className="flex items-center gap-2">
                                            <div className="font-semibold truncate" title={order.customerName}>{order.customerName}</div>
                                            {customerBadge && (
                                                <Badge className={cn("px-1.5 py-0 text-[10px] h-4 leading-none font-normal", customerBadge.color)}>
                                                    {customerBadge.label}
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex flex-col text-sm text-muted-foreground">
                                            <div className="flex items-center gap-2">
                                                <a href={telHref || undefined} className="hover:text-primary transition-colors flex items-center gap-1 truncate">
                                                    <Phone className="h-3 w-3" />
                                                    {phoneDisplay}
                                                </a>
                                                {phoneMeta.isValid && (
                                                    <a
                                                        href={whatsappHref || undefined}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center justify-center rounded-full bg-green-100 p-1 hover:bg-green-200 transition-colors flex-shrink-0"
                                                        title="Chat on WhatsApp"
                                                    >
                                                        <Image src="/whatsapp.png" alt="WhatsApp" width={16} height={16} className="h-4 w-4" />
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Restrictions Warnings */}
                                {ipBlocked && (
                                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-3 border border-destructive/20">
                                        <Ban className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <span className="font-semibold block">IP Blocked</span>
                                            <span className="text-xs opacity-90">IP address is in the blocklist.</span>
                                        </div>
                                    </div>
                                )}
                                {phoneBlocked && (
                                    <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-3 border border-destructive/20">
                                        <Ban className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <span className="font-semibold block">Phone Blocked</span>
                                            <span className="text-xs opacity-90">Phone number is in the blocklist.</span>
                                        </div>
                                    </div>
                                )}

                                <Separator />
                                <div className="grid gap-2 text-sm">
                                    <div className="grid grid-cols-4 gap-2 text-center">
                                        <TooltipProvider delayDuration={100}>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className="bg-secondary/50 p-2 rounded flex flex-col items-center justify-center hover:bg-secondary/70 transition-colors cursor-help group">
                                                        <span className="font-bold text-sm mb-0.5 group-hover:scale-105 transition-transform">{customerHistoryStats.totalOrders}</span>
                                                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase font-medium">
                                                            <Package className="w-3 h-3" /> Total
                                                        </div>
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent><p>Total Orders Placed</p></TooltipContent>
                                            </Tooltip>

                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className="bg-green-500/10 p-2 rounded flex flex-col items-center justify-center text-green-700 border border-green-500/20 hover:bg-green-500/20 transition-colors cursor-help group">
                                                        <span className="font-bold text-sm mb-0.5 group-hover:scale-105 transition-transform">{customerHistoryStats.delivered}</span>
                                                        <div className="flex items-center gap-1 text-[10px] opacity-90 uppercase font-medium">
                                                            <CheckCircle className="w-3 h-3" /> Dlvr
                                                        </div>
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent><p>Total Delivered Orders</p></TooltipContent>
                                            </Tooltip>

                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className="bg-red-500/10 p-2 rounded flex flex-col items-center justify-center text-red-700 border border-red-500/20 hover:bg-red-500/20 transition-colors cursor-help group">
                                                        <span className="font-bold text-sm mb-0.5 group-hover:scale-105 transition-transform">{customerHistoryStats.canceled}</span>
                                                        <div className="flex items-center gap-1 text-[10px] opacity-90 uppercase font-medium">
                                                            <XCircle className="w-3 h-3" /> Cncl
                                                        </div>
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent><p>Total Canceled Orders</p></TooltipContent>
                                            </Tooltip>

                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className="bg-orange-500/10 p-2 rounded flex flex-col items-center justify-center text-orange-700 border border-orange-500/20 hover:bg-orange-500/20 transition-colors cursor-help group">
                                                        <span className="font-bold text-sm mb-0.5 group-hover:scale-105 transition-transform">{customerHistoryStats.returned}</span>
                                                        <div className="flex items-center gap-1 text-[10px] opacity-90 uppercase font-medium">
                                                            <RotateCcw className="w-3 h-3" /> Rtrn
                                                        </div>
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent><p>Total Returned Orders</p></TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </div>
                                </div>
                                <Separator />
                                <div className="grid gap-2">
                                    <div className="font-medium flex items-center gap-2">
                                        <Store className="h-4 w-4 text-muted-foreground" />
                                        Shipping Address
                                    </div>
                                    <address className="not-italic text-sm text-muted-foreground pl-6 border-l-2 ml-1">
                                        {deriveShippingAddress(order.shippingAddress)}
                                    </address>
                                </div>
                            </CardContent>
                        </Card>

                        {renderUtmBox(order.rawPayload)}

                        <Card className="border-l-4 border-l-primary/50">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2">
                                    <PackageCheck className="h-5 w-5" />
                                    Manage Fulfillment
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <Form {...statusForm}>
                                    <div className="space-y-3">
                                        <FormField control={statusForm.control} name="status" render={({ field }) => (
                                            <FormItem className="space-y-1">
                                                <FormLabel className="text-xs">Update Status</FormLabel>
                                                <div className="flex gap-2">
                                                    <Select onValueChange={field.onChange} value={field.value ?? ''}>
                                                        <FormControl>
                                                            <SelectTrigger className="h-9">
                                                                <SelectValue placeholder="Status..." />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            {getAvailableStatuses(order.status, allStatuses).map(status => (
                                                                <SelectItem key={status} value={status}>
                                                                    <div className="flex items-center gap-2">
                                                                        <div className={cn("h-2 w-2 rounded-full", statusColors[status]?.split(' ')[0].replace('/20', ''))} />
                                                                        {status}
                                                                    </div>
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <Button size="icon" className="h-9 w-9 shrink-0" onClick={statusForm.handleSubmit(onStatusSubmit)} disabled={isStatusSaving || isReadOnly || !lockStatus.active}>
                                                        {isStatusSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                                    </Button>
                                                </div>
                                            </FormItem>
                                        )} />

                                        {/* Quick Actions for Assign */}
                                        <div className="pt-2">
                                            <Button
                                                variant={order.assignedToId === currentUser?.id ? "secondary" : "outline"}
                                                size="sm"
                                                className="w-full justify-start h-8 text-xs"
                                                onClick={handleAssignToMe}
                                                disabled={!currentUser || order.assignedToId === currentUser.id || isReadOnly || !lockStatus.active}
                                            >
                                                {order.assignedToId === currentUser?.id ? (
                                                    <><CheckCircle className="mr-2 h-3.5 w-3.5 text-green-600" /> Assigned to You</>
                                                ) : (
                                                    <><UserCheck className="mr-2 h-3.5 w-3.5" /> Assign to Me</>
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                </Form>

                                <Separator />

                                <div className="space-y-3">
                                    <Label className="text-xs">Courier</Label>
                                    <div className="flex gap-2">
                                        <Select value={selectedCourier} onValueChange={setSelectedCourier}>
                                            <SelectTrigger className="h-9">
                                                <SelectValue placeholder="Service..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {courierServices.map(c => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                                            </SelectContent>
                                        </Select>
                                        {selectedCourier && (
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button size="sm" className="h-9 shrink-0" disabled={isSending}>
                                                        {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Send to {selectedCourier}?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            Dispatch order <strong>{order.orderNumber || order.id}</strong> via {selectedCourier}.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={handleSendToCourier}>Confirm</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                </div>
            </div>
        </div>
    );
}

