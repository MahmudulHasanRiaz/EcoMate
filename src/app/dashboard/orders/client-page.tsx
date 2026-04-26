'use client';

import * as React from "react";
import { useTransition } from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MoreHorizontal, PlusCircle, ScanLine, Edit, RotateCw, Check, ChevronsUpDown, File as FileIcon, X as XIcon, ChevronDown, ExternalLink, AlertCircle } from "lucide-react";
import { format, formatDistanceToNow, differenceInHours } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatLabel } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { getOrders, getStatuses, updateOrder, deleteOrder as deleteOrderService, getOrderChanges, subscribeToOrderUpdates } from '@/services/orders';
import { getAvailableStatuses, getCommonAvailableStatuses } from '@/lib/order-status-flow';
import { getBusinesses, getCourierServices } from "@/services/partners";
import { getAssignableStaff, getStaffMemberByClerkId } from "@/services/staff";
import type { Order, OrderProduct, OrderStatus, StaffMember, Permission } from "@/types";
import { usePermissions } from '@/hooks/use-permissions';
import { useToast } from "@/hooks/use-toast";
import { useAuthErrorHandler } from "@/hooks/use-auth-error-handler";
import { AuthError } from "@/lib/api-helper";
import { Separator } from "@/components/ui/separator";
import { DEFAULT_IMAGE_PLACEHOLDER, resolveImageSrc } from "@/lib/image";
import { useUser } from "@clerk/nextjs";
import useSWR, { mutate, preload } from 'swr';
import { NewOrderDialog } from '@/components/orders/new-order-dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { OrderDetailsView } from "@/components/orders/order-details-view";
import { StaffCombobox } from "@/components/orders/staff-combobox";
import { acquireOrderOpenLock, releaseOrderOpenLock } from '@/services/order-open-locks';
import type { OrderOpenLock } from '@/types';

const statusColors: Partial<Record<OrderStatus, string>> = {
  'Draft': 'bg-slate-400/20 text-slate-700',
  'New': 'bg-blue-500/20 text-blue-700',
  'Confirmed': 'bg-sky-500/20 text-sky-700',
  'Confirmed_Waiting': 'bg-teal-500/20 text-teal-700',
  'Confirmed Waiting': 'bg-teal-500/20 text-teal-700',
  'Packing_Hold': 'bg-amber-500/20 text-amber-700',
  'Packing Hold': 'bg-amber-500/20 text-amber-700',
  'Canceled': 'bg-red-500/20 text-red-700',
  'C2C': 'bg-red-500/20 text-red-700',
  'Hold': 'bg-yellow-500/20 text-yellow-700',
  'In_Courier': 'bg-orange-500/20 text-orange-700',
  'In-Courier': 'bg-orange-500/20 text-orange-700',
  'RTS__Ready_to_Ship_': 'bg-purple-500/20 text-purple-700',
  'RTS (Ready to Ship)': 'bg-purple-500/20 text-purple-700',
  'Shipped': 'bg-cyan-500/20 text-cyan-700',
  'Delivered': 'bg-green-500/20 text-green-700',
  'Return_Pending': 'bg-pink-500/20 text-pink-700',
  'Return Pending': 'bg-pink-500/20 text-pink-700',
  'Returned': 'bg-gray-500/20 text-gray-700',
  'Paid_Return': 'bg-gray-500/20 text-gray-700',
  'Paid Return': 'bg-gray-500/20 text-gray-700',
  'Partial': 'bg-fuchsia-500/20 text-fuchsia-700',
  'Damaged': 'bg-rose-500/20 text-rose-700',
  'Incomplete': 'bg-gray-500/20 text-gray-700',
  'Incomplete_Cancelled': 'bg-red-500/20 text-red-700',
  'Incomplete-Cancelled': 'bg-red-500/20 text-red-700',
  'No_Response': 'bg-orange-400/20 text-orange-700',
  'No Response': 'bg-orange-400/20 text-orange-700',
};

const EXCLUDED_ORDER_LIST_STATUSES: OrderStatus[] = ['Incomplete', 'Incomplete_Cancelled', 'Incomplete-Cancelled'];

function dedupeOrdersById(orders: Order[]) {
  const map = new Map<string, Order>();
  orders.forEach((order) => {
    if (order?.id) map.set(order.id, order);
  });
  return Array.from(map.values());
}

function deriveTrackingInfo(order: Order) {
  const meta = (order as any).courierMeta || {};
  const provider =
    order.courierService ||
    meta.provider ||
    meta?.response?.provider ||
    meta?.payload?.provider;

  const code =
    (order as any).courierTrackingCode ||
    (order as any).courierConsignmentId ||
    meta?.response?.consignment?.consignment_id ||
    meta?.response?.consignment_id ||
    meta?.response?.data?.consignment_id ||
    meta?.payload?.consignment_id ||
    meta?.payload?.invoice ||
    meta?.payload?.tracking_code;

  return { provider, code };
}

function buildTrackingUrl(order: Order) {
  const { provider, code } = deriveTrackingInfo(order);
  if (!code) return null;
  const service = (provider || '').toString();
  switch (service) {
    case 'Steadfast':
      return `https://steadfast.com.bd/t/${encodeURIComponent(code)}`;
    case 'Pathao':
    case 'pathao':
      return `https://merchant.pathao.com/tracking?consignment_id=${encodeURIComponent(code)}`;
    case 'RedX':
    case 'redx':
      return `https://redx.com.bd/track?tracking_id=${encodeURIComponent(code)}`;
    case 'Carrybee':
    case 'carrybee':
      return `https://merchant.carrybee.com/order-track/${encodeURIComponent(code)}`;
    default:
      return null;
  }
}

function getOrderUpdateErrorMessage(err: any, intendedStatus?: string) {
  const raw = String(err?.message || '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('insufficient stock')) {
    return intendedStatus === 'Confirmed'
      ? 'Insufficient stock. Add stock, then confirm again.'
      : 'Insufficient stock for this status change.';
  }
  return raw || 'Could not update status.';
}

function formatOrderTime(order: Order) {
  const isWoo = order.source?.toLowerCase().includes('woo') || !!(order as any).externalOrderId;
  const raw = (isWoo ? (order.date || order.createdAt) : (order.createdAt || order.date)) || order.updatedAt;
  if (!raw) return "";
  const dt = new Date(raw as any);
  if (Number.isNaN(dt.getTime())) return "";
  const hours = differenceInHours(new Date(), dt);
  if (hours < 24) return formatDistanceToNow(dt, { addSuffix: true });
  return format(dt, "dd MMM, hh:mm a");
}

function OrderImages({ products, orderId }: { products: OrderProduct[], orderId?: string }) {
  const OrderThumb = ({ item, alt }: { item: any; alt: string }) => {
    const resolvedSrc = React.useMemo(() => resolveImageSrc(item.image ?? item.product?.image), [item]);
    const [src, setSrc] = React.useState(resolvedSrc);
    const [show404, setShow404] = React.useState(resolvedSrc === DEFAULT_IMAGE_PLACEHOLDER);

    React.useEffect(() => {
      setSrc(resolvedSrc);
      setShow404(resolvedSrc === DEFAULT_IMAGE_PLACEHOLDER);
    }, [resolvedSrc]);

    return (
      <div className="relative h-16 w-16 overflow-hidden rounded-md bg-muted">
        <Image
          src={src}
          alt={alt || 'Product image'}
          width={64}
          height={64}
          className="h-16 w-16 object-cover"
          onError={() => {
            setSrc(DEFAULT_IMAGE_PLACEHOLDER);
            setShow404(true);
          }}
          unoptimized
        />
        {show404 && (
          <div className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">404</div>
        )}
      </div>
    );
  };

  const firstProduct = products[0];
  if (!firstProduct) return null;

  if (products.length > 1) {
    return (
      <div className="relative inline-block">
        <OrderThumb item={firstProduct} alt={firstProduct.name || (firstProduct as any).product?.name} />
        <Dialog>
          <DialogTrigger asChild>
            <button className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold shadow">
              +{products.length - 1}
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Products in Order {orderId ?? ''}</DialogTitle>
              <DialogDescription>All products included in this customer order.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {products.map((product, index) => (
                <div key={`${product.productId}-${product.variantId ?? 'none'}-${index}`} className="flex items-center gap-4">
                  <OrderThumb item={product} alt={product.name || (product as any).product?.name} />
                  <div className="flex-1">
                    <p className="font-medium">{product.name}</p>
                    <p className="text-sm text-muted-foreground">Quantity: {product.quantity}</p>
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }
  return <OrderThumb item={firstProduct} alt={firstProduct.name || (firstProduct as any).product?.name} />;
}

export default function OrdersClientPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const permissions = usePermissions();
  const { toast } = useToast();
  const { user } = useUser();
  const { handleError } = useAuthErrorHandler();

  const canOrders = (action: keyof Permission) => {
    const perms = permissions?.orders;
    return perms === true || (perms && typeof perms === 'object' && !!perms[action]);
  };

  // SWR Hooks
  const { data: businessesData } = useSWR('businesses', getBusinesses);
  const { data: statusesData } = useSWR('statuses', getStatuses);
  const { data: staffData } = useSWR('assignable-staff', getAssignableStaff);
  const { data: currentStaffData } = useSWR(user?.id ? `staff-me-${user.id}` : null, () => getStaffMemberByClerkId(user!.id));

  const allStaff = Array.isArray(staffData) ? staffData : [];
  const allStatuses = statusesData || [];
  const orderListStatuses = React.useMemo(
    () => (allStatuses as OrderStatus[]).filter((status) => !EXCLUDED_ORDER_LIST_STATUSES.includes(status)),
    [allStatuses]
  );
  const [loggedInStaff, setLoggedInStaff] = React.useState<StaffMember | null>(null);
  React.useEffect(() => { if (currentStaffData) setLoggedInStaff(currentStaffData); }, [currentStaffData]);

  const staffIdForFilters = currentStaffData?.id || loggedInStaff?.id || (user?.publicMetadata?.staffId as string);
  const isAdminUser = (currentStaffData?.role || loggedInStaff?.role || (user?.publicMetadata?.role as string)) === 'Admin';
  const scopedBusinesses = React.useMemo(() => {
    const all = businessesData || [];
    if (isAdminUser) return all;
    const allowedIds = new Set(
      (currentStaffData?.accessibleBusinessIds || loggedInStaff?.accessibleBusinessIds || []).filter(Boolean)
    );
    if (allowedIds.size === 0) return [];
    return all.filter((b: any) => allowedIds.has(b.id));
  }, [businessesData, isAdminUser, currentStaffData?.accessibleBusinessIds, loggedInStaff?.accessibleBusinessIds]);

  const [allOrders, setAllOrders] = React.useState<Order[]>([]);
  const [totalOrders, setTotalOrders] = React.useState(0);
  const [statusFilter, setStatusFilter] = React.useState(searchParams.get('status') || "all");
  const [businessFilter, setBusinessFilter] = React.useState("all");
  const [assigneeFilter, setAssigneeFilter] = React.useState("all");
  const initialSearch = searchParams.get('search') || "";
  const [searchTerm, setSearchTerm] = React.useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = React.useState(initialSearch);
  const [platformFilter, setPlatformFilter] = React.useState("all");
  const [isCustomRowsDialogOpen, setIsCustomRowsDialogOpen] = React.useState(false);
  const [tempCustomRows, setTempCustomRows] = React.useState("");
  const [sortField, setSortField] = React.useState<'total' | 'createdAt' | 'id'>("createdAt");
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("desc");

  React.useEffect(() => {
    if (statusFilter !== 'all' && EXCLUDED_ORDER_LIST_STATUSES.includes(statusFilter as OrderStatus)) {
      setStatusFilter('all');
      setCurrentPage(1);
    }
  }, [statusFilter]);

  React.useEffect(() => {
    if (businessFilter === 'all') return;
    const existsInScope = scopedBusinesses.some((b: any) => b.id === businessFilter);
    if (!existsInScope) {
      setBusinessFilter('all');
      setCurrentPage(1);
    }
  }, [businessFilter, scopedBusinesses]);

  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
      setCurrentPage(1);
    }, 350);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  const [selectedOrders, setSelectedOrders] = React.useState<string[]>([]);
  const [itemsPerPage, setItemsPerPage] = React.useState(10);
  const [customRowsInput, setCustomRowsInput] = React.useState("");
  const [currentPage, setCurrentPage] = React.useState(1);
  const [isLoading, setIsLoading] = React.useState(true);
  const [inlineSaving, setInlineSaving] = React.useState<Record<string, boolean>>({});
  const [isNewOrderDialogOpen, setIsNewOrderDialogOpen] = React.useState(false);
  const [viewOrderId, setViewOrderId] = React.useState<string | null>(null);
  const [viewOrderLockToken, setViewOrderLockToken] = React.useState<string | undefined>(undefined);
  const [deleteDialog, setDeleteDialog] = React.useState<{ isOpen: boolean, orderId: string | null }>({ isOpen: false, orderId: null });
  const [confirmDialog, setConfirmDialog] = React.useState<{ isOpen: boolean; title?: string; description: string; onConfirm: () => void }>({ isOpen: false, description: '', onConfirm: () => { } });

  // Real-time Poll State
  const [lastCheckTime, setLastCheckTime] = React.useState<string>(new Date().toISOString());
  const [isPolling] = React.useState(true);

  // Bulk Actions State
  const [isBulkActing, setIsBulkActing] = React.useState(false);
  const [bulkActionProgress, setBulkActionProgress] = React.useState(0);
  const [bulkActionLabel, setBulkActionLabel] = React.useState("");
  const [bulkAssignPickerValue, setBulkAssignPickerValue] = React.useState("__bulk__");

  // Courier Summary State (P47 R5)
  const [courierSummaries, setCourierSummaries] = React.useState<Record<string, { total: number; success: number; failed: number; successPct: number; failedPct: number }>>({});
  const courierCache = React.useRef<Record<string, any>>({});
  const lastOrdersErrorRef = React.useRef<string>("");
  const parentRef = React.useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: allOrders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // estimated row height
    overscan: 5,
  });

  React.useEffect(() => {
    if (selectedOrders.length === 0) setBulkAssignPickerValue("__bulk__");
  }, [selectedOrders.length]);

  const selectedOrderItems = React.useMemo(
    () => allOrders.filter((order) => selectedOrders.includes(order.id)),
    [allOrders, selectedOrders]
  );

  const selectedOrderStatuses = React.useMemo(
    () => Array.from(new Set(selectedOrderItems.map((order) => order.status as OrderStatus))),
    [selectedOrderItems]
  );

  const bulkAvailableStatuses = React.useMemo(() => {
    if (selectedOrderStatuses.length === 0) return [] as OrderStatus[];
    if (selectedOrderStatuses.length === 1) {
      const current = selectedOrderStatuses[0];
      return getAvailableStatuses(current, orderListStatuses as OrderStatus[]).filter((s) => s !== current);
    }
    return getCommonAvailableStatuses(selectedOrderStatuses, orderListStatuses as OrderStatus[]);
  }, [selectedOrderStatuses, orderListStatuses]);

  React.useEffect(() => {
    if (allOrders.length === 0) return;
    const phonesToFetch = allOrders
      .map(o => o.customerPhone)
      .filter(p => !!p && !courierCache.current[p]);
    if (phonesToFetch.length === 0) return;
    const uniquePhones = Array.from(new Set(phonesToFetch));
    if (uniquePhones.length === 0) return;

    // Use dynamic import or direct call to avoid dependency issues if needed, but getCourierSummaries is already imported
    import('@/services/orders').then(({ getCourierSummaries }) => {
      getCourierSummaries(uniquePhones).then(results => {
        Object.assign(courierCache.current, results);
        setCourierSummaries(prev => ({ ...prev, ...results }));
      }).catch(err => console.error('[COURIER_SUMMARY_LOAD_FAIL]', err));
    });
  }, [allOrders]);

  const buildKey = (page: number) => {
    const params = new URLSearchParams();
    params.set('pageSize', itemsPerPage.toString());
    params.set('page', page.toString());
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (businessFilter !== 'all') params.set('businessId', businessFilter);
    if (platformFilter !== 'all') params.set('platform', platformFilter);
    if (debouncedSearch) params.set('search', debouncedSearch);
    params.set('includeTotal', 'true');
    if (assigneeFilter === 'me') params.set('assignedToId', staffIdForFilters || '__NO_STAFF__');
    else if (assigneeFilter !== 'all') params.set('assignedToId', assigneeFilter);
    params.set('sortField', sortField);
    params.set('sortOrder', sortOrder);
    return `/api/orders?${params.toString()}`;
  };

  const ordersKey = buildKey(currentPage);
  const { data: ordersData, error: ordersError, mutate: mutateOrders, isValidating } = useSWR(ordersKey, async () => {
    return getOrders({
      pageSize: itemsPerPage,
      page: currentPage,
      status: statusFilter !== 'all' ? statusFilter : undefined,
      businessId: businessFilter !== 'all' ? businessFilter : undefined,
      platform: platformFilter !== 'all' ? platformFilter : undefined,
      search: debouncedSearch || undefined,
      assignedToId: assigneeFilter === 'me' ? (staffIdForFilters || '__NO_STAFF__') : (assigneeFilter !== 'all' ? assigneeFilter : undefined),
      includeTotal: true,
      sortField,
      sortOrder,
    });
  }, { revalidateOnFocus: false, keepPreviousData: false });

  React.useEffect(() => {
    setIsLoading(true);
  }, [ordersKey]);

  React.useEffect(() => {
    if (ordersData) {
      const list = (ordersData as any)?.items || [];
      setAllOrders(dedupeOrdersById(list));
      setTotalOrders((ordersData as any)?.total || list.length);
      setIsLoading(false);
    } else if (ordersError) setIsLoading(false);
  }, [ordersData, ordersError]);

  React.useEffect(() => {
    if (!ordersError) return;
    const checkAuth = async () => {
        if (await handleError(ordersError)) return;
        const message = ordersError instanceof Error ? ordersError.message : 'Failed to load orders for current filters.';
        if (lastOrdersErrorRef.current !== message) {
            lastOrdersErrorRef.current = message;
            toast({ variant: "destructive", title: "Filter failed", description: message });
        }
        setAllOrders([]);
        setTotalOrders(0);
    };
    checkAuth();
  }, [ordersError, toast, router, handleError]);

  // -- Real-time Polling Logic --
  React.useEffect(() => {
    if (!isPolling || viewOrderId) return;
    const interval = setInterval(async () => {
      // Pause polling if the tab is not visible to prevent Nginx 504 Gateway Timeouts
      if (document.hidden) return;
      
      try {
        const visibleIds = allOrders.map(o => o.id);
        const result = await getOrderChanges(lastCheckTime, visibleIds);
        if (result.changedIds.length > 0) {
          const hasVisibleChanges = result.changedIds.some(id => visibleIds.includes(id));
          if (hasVisibleChanges) mutateOrders();
        }
        setLastCheckTime(result.serverTime);
      } catch (err) {
        console.error('[REALTIME] Polling error:', err);
      }
    }, 8000 + Math.random() * 2000);
    return () => clearInterval(interval);
  }, [isPolling, lastCheckTime, allOrders, viewOrderId, mutateOrders]);

  // -- Instant refresh on tab focus --
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        mutateOrders();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [mutateOrders]);

  // -- Multi-Tab Sync Logic --
  React.useEffect(() => {
    const unsub = subscribeToOrderUpdates((event) => {
      if (allOrders.some(o => o.id === event.orderId)) mutateOrders();
    });
    return unsub;
  }, [allOrders, mutateOrders]);

  const handleOpenOrder = async (orderId: string, force = false) => {
    try {
      const result = await acquireOrderOpenLock(orderId, force);
      if (result.success && result.acquired) {
        setViewOrderLockToken(result.lock.token);
        setViewOrderId(orderId);
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Cannot open order", description: error.message });
    }
  };

  const handleCloseView = () => {
    if (viewOrderId && viewOrderLockToken) releaseOrderOpenLock(viewOrderId, viewOrderLockToken).catch(console.error);
    setViewOrderId(null);
    setViewOrderLockToken(undefined);
    mutateOrders();
  };

  const handleInlineAssign = async (orderId: string, staffIdVal: string) => {
    let id: string | null = staffIdVal;
    let name: string | null = null;
    if (staffIdVal === 'me') {
      id = staffIdForFilters;
      name = loggedInStaff?.name || 'Me';
    } else if (staffIdVal === 'unassigned') {
      id = null;
      name = null;
    } else {
      const s = allStaff.find(x => x.id === staffIdVal);
      id = staffIdVal;
      name = s?.name || null;
    }
    setInlineSaving(prev => ({ ...prev, [orderId]: true }));
    try {
      const updated = await updateOrder(orderId, { assignedToId: id as any });
      setAllOrders(prev => prev.map(o => o.id === orderId ? { ...o, assignedTo: (updated as any)?.assignedTo ?? o.assignedTo, assignedToId: (updated as any)?.assignedToId ?? id } : o));
      toast({ title: "Order Assigned" });
    } catch {
      toast({ variant: "destructive", title: "Assignment failed" });
    } finally {
      setInlineSaving(prev => ({ ...prev, [orderId]: false }));
    }
  };

  const handleStatusUpdate = async (orderId: string, newStatus: OrderStatus) => {
    setInlineSaving(prev => ({ ...prev, [orderId]: true }));
    try {
      await updateOrder(orderId, { status: newStatus });
      setAllOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
      toast({ title: "Status Updated", description: `Order marked as ${formatLabel(newStatus)}` });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: getOrderUpdateErrorMessage(err, newStatus)
      });
    } finally {
      setInlineSaving(prev => ({ ...prev, [orderId]: false }));
    }
  };

  const confirmBulkChange = (actionText: string, count: number, onConfirm: () => void) => {
    if (count <= 0) return;
    const noun = count > 1 ? 'orders' : 'order';
    setConfirmDialog({
      isOpen: true,
      title: 'Confirm Bulk Action',
      description: `Are you sure you want to ${actionText} for ${count} selected ${noun}?`,
      onConfirm: () => {
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        onConfirm();
      }
    });
  };

  const openAfterMenuSettles = (fn: () => void) => {
    setTimeout(() => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
            fn();
          });
        });
      } else {
        try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
        fn();
      }
    }, 0);
  };

  const handleBulkAssign = (assignedToId: string | 'me' | 'unassigned') => {
    if (selectedOrders.length === 0) return;
    const assigneeName =
      assignedToId === 'me'
        ? 'yourself'
        : assignedToId === 'unassigned'
          ? 'Unassigned'
          : (allStaff.find((staff) => staff.id === assignedToId)?.name || 'selected staff');

    confirmBulkChange(`assign to ${assigneeName}`, selectedOrders.length, async () => {
      setIsBulkActing(true);
      setBulkActionLabel("Bulk Assigning...");
      setBulkActionProgress(0);
      try {
        const res = await fetch('/api/orders/bulk-assign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderIds: selectedOrders, assignedToId }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payload?.error || payload?.message || 'Bulk assignment failed');
        toast({ title: "Bulk Assignment Complete", description: `Updated ${payload.updated} orders.` });
        setSelectedOrders([]);
        setBulkAssignPickerValue("__bulk__");
        mutateOrders();
      } catch (error: any) {
        toast({ variant: "destructive", title: "Error", description: error.message });
      } finally {
        setIsBulkActing(false);
      }
    });
  };

  const handleBulkStatus = (status: OrderStatus) => {
    if (selectedOrders.length === 0) return;
    confirmBulkChange(`change status to ${formatLabel(status)}`, selectedOrders.length, async () => {
      setIsBulkActing(true);
      setBulkActionLabel(`Marking as ${status}`);
      try {
        if (status === 'Canceled' || status === 'Delivered') {
          const action = status === 'Canceled' ? 'cancel' : 'deliver';
          const res = await fetch('/api/orders/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: selectedOrders, action, user: 'System' }),
          });
          if (!res.ok) throw new Error(await res.text());
        } else {
          for (let i = 0; i < selectedOrders.length; i++) {
            setBulkActionProgress(Math.round(((i + 1) / selectedOrders.length) * 100));
            await updateOrder(selectedOrders[i], { status });
          }
        }
        setSelectedOrders([]);
        mutateOrders();
        toast({ title: "Status Updated" });
      } catch (err: any) {
        toast({ variant: "destructive", title: "Bulk update failed", description: getOrderUpdateErrorMessage(err, status) });
      } finally {
        setTimeout(() => setIsBulkActing(false), 500);
      }
    });
  };

  const handleBulkDispatch = (courier: string) => {
    if (selectedOrders.length === 0) return;
    confirmBulkChange(`dispatch via ${courier}`, selectedOrders.length, async () => {
      setIsBulkActing(true);
      setBulkActionLabel(`Dispatching via ${courier}`);
      try {
        const endpoint = courier === 'Steadfast' ? '/api/orders/dispatch/steadfast'
          : courier === 'Pathao' ? '/api/orders/dispatch/pathao'
            : courier === 'Carrybee' ? '/api/orders/dispatch/carrybee' : null;
        if (endpoint) {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderIds: selectedOrders, user: loggedInStaff?.name || 'System' }),
          });
          if (!res.ok) throw new Error('Dispatch failed');
        } else {
          for (let i = 0; i < selectedOrders.length; i++) {
            await updateOrder(selectedOrders[i], { status: 'In_Courier' as OrderStatus, courierService: courier } as any);
          }
        }
        setSelectedOrders([]);
        mutateOrders();
        toast({ title: "Dispatched Successfully" });
      } catch (err: any) {
        toast({ variant: "destructive", title: "Dispatch failed", description: err.message });
      } finally {
        setIsBulkActing(false);
      }
    });
  };

  const handleBulkDelete = () => {
    const idsToDelete = deleteDialog.orderId ? [deleteDialog.orderId] : selectedOrders;
    if (idsToDelete.length === 0) return;
    const invalid = allOrders.filter(o => idsToDelete.includes(o.id) && o.status !== 'Canceled');
    if (invalid.length > 0) {
      toast({ variant: "destructive", title: "Cancel first", description: "Only canceled orders can be deleted." });
      return;
    }

    const executeDelete = async () => {
      setIsBulkActing(true);
      setBulkActionLabel("Deleting Orders...");
      try {
        for (const id of idsToDelete) await deleteOrderService(id);
        setSelectedOrders([]);
        setDeleteDialog({ isOpen: false, orderId: null });
        mutateOrders();
        toast({ title: "Orders Deleted" });
      } catch (err: any) {
        toast({ variant: "destructive", title: "Delete failed", description: err.message });
      } finally {
        setIsBulkActing(false);
      }
    };

    if (!deleteDialog.orderId) {
      // Bulk Delete Flow
      confirmBulkChange('delete', idsToDelete.length, executeDelete);
    } else {
      // Single Delete Flow (invoked from deleteDialog Action Button)
      executeDelete();
    }
  };

  const [printWarning, setPrintWarning] = React.useState<{ isOpen: boolean, type: 'invoice' | 'sticker' | null }>({ isOpen: false, type: null });
  const [isBulkPrinting, setIsBulkPrinting] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportTemplate, setExportTemplate] = React.useState("default");
  const MAX_CUSTOM_ROWS = 5000;
  const handleBulkPrint = (type: 'invoice' | 'sticker') => {
    if (selectedOrders.length > 300) setPrintWarning({ isOpen: true, type });
    else executeBulkPrint(type);
  };
  const executeBulkPrint = async (type: 'invoice' | 'sticker') => {
    setIsBulkPrinting(true);
    try {
      const res = await fetch('/api/print/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedOrders }),
      });
      const { token } = await res.json();
      window.open(`/print/bulk?type=${type}&token=${token}`, '_blank');
    } catch (err: any) {
      toast({ variant: "destructive", title: "Print error", description: err.message });
    } finally { setIsBulkPrinting(false); }
  };

  const handleExport = async () => {
    if (statusFilter === 'all') {
      toast({
        variant: "destructive",
        title: "Select one status",
        description: "Please select a single status first, then export.",
      });
      return;
    }

    setIsExporting(true);
    try {
      const payload: Record<string, any> = {
        format: 'csv',
        status: statusFilter,
        template: exportTemplate !== 'default' ? exportTemplate : undefined,
      };

      if (businessFilter !== 'all') payload.businessId = businessFilter;
      if (debouncedSearch) payload.search = debouncedSearch;

      const startRes = await fetch('/api/exports/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const startData = await startRes.json().catch(() => ({}));
      if (!startRes.ok) {
        throw new Error(startData?.message || 'Failed to start export');
      }

      const jobId = startData?.data?.jobId || startData?.jobId;
      if (!jobId) throw new Error('Export job creation failed');

      toast({ title: "Export Started", description: "Preparing CSV. It may take time for large data." });

      const startTs = Date.now();
      const timeoutMs = 15 * 60 * 1000;

      while (Date.now() - startTs < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const statusRes = await fetch(`/api/exports/${jobId}`, { cache: 'no-store' });
        const statusData = await statusRes.json().catch(() => ({}));

        if (!statusRes.ok) {
          throw new Error(statusData?.message || 'Failed to check export status');
        }

        const job = statusData?.data || statusData;
        if (job?.status === 'Completed') {
          const downloadUrl = `/api/exports/${jobId}/download`;
          window.open(downloadUrl, '_blank');
          toast({ title: "Export Ready", description: "CSV download started." });
          return;
        }

        if (job?.status === 'Failed') {
          throw new Error(job?.error || 'Export failed');
        }
      }

      throw new Error('Export timed out. Please try again.');
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Export Failed",
        description: err?.message || 'Could not export orders.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleSort = (field: 'total' | 'createdAt' | 'id') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
    setCurrentPage(1);
  };

  const applyCustomRowsValue = (value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      toast({
        variant: "destructive",
        title: "Invalid rows value",
        description: "Please enter a valid number greater than 0.",
      });
      return;
    }

    const next = Math.min(Math.floor(parsed), MAX_CUSTOM_ROWS);
    if (next !== Math.floor(parsed)) {
      toast({
        title: "Rows clamped",
        description: `Maximum allowed rows per page is ${MAX_CUSTOM_ROWS}.`,
      });
    }

    setItemsPerPage(next);
    setCurrentPage(1);
    setSelectedOrders([]);
    setIsCustomRowsDialogOpen(false);
  };

  const totalPages = Math.ceil(totalOrders / itemsPerPage);
  const getPaginationRange = () => {
    const delta = 2;
    const range = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) range.push(i);
    }
    const result = [];
    let l;
    for (let i of range) {
      if (l) {
        if (i - l === 2) result.push(l + 1);
        else if (i - l !== 1) result.push('...');
      }
      result.push(i);
      l = i;
    }
    return result;
  };

  return (
    <div className="flex flex-col gap-4 p-4 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-muted-foreground">Manage and track customer orders.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Desktop Button */}
          <Button 
            onClick={() => setIsNewOrderDialogOpen(true)}
            className="hidden md:flex"
          >
            <PlusCircle className="mr-2 h-4 w-4" /> New Order
          </Button>
          
          {/* Mobile Button - Links to POS Page */}
          <Button 
            onClick={() => router.push('/dashboard/orders/create')}
            className="flex md:hidden h-10 w-10 p-0 rounded-full shadow-lg"
            variant="default"
            size="icon"
          >
            <PlusCircle className="h-6 w-6" />
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="px-4 py-3 md:px-6">
          {isValidating && (
            <div className="mb-2 text-xs text-muted-foreground">Applying filters...</div>
          )}
          {/* Filters row */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
            <div className="relative flex-1 min-w-0 max-w-sm">
              <Input placeholder="Search order/customer/phone/SKU..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 h-9 text-sm" />
              <ScanLine className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-[130px] h-9 text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {orderListStatuses.map(s => <SelectItem key={s} value={s}>{formatLabel(s)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={businessFilter} onValueChange={(v) => { setBusinessFilter(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-[130px] h-9 text-sm"><SelectValue placeholder="Business" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Businesses</SelectItem>
                  {scopedBusinesses?.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="w-[140px]">
                <StaffCombobox
                  value={assigneeFilter}
                  onChange={(v) => { setAssigneeFilter(v); setCurrentPage(1); }}
                  staffMembers={allStaff}
                  mode="filter"
                />
              </div>
              <div className="hidden lg:block w-[130px]">
                <Select value={platformFilter} onValueChange={(v) => { setPlatformFilter(v); setCurrentPage(1); }}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Platform" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Platforms</SelectItem>
                    <SelectItem value="Website">Website</SelectItem>
                    <SelectItem value="Messenger">Messenger</SelectItem>
                    <SelectItem value="Facebook">Facebook</SelectItem>
                    <SelectItem value="Instagram">Instagram</SelectItem>
                    <SelectItem value="TikTok">TikTok</SelectItem>
                    <SelectItem value="Call">Call</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Select 
                value={![10, 25, 50, 100].includes(itemsPerPage) ? "custom" : itemsPerPage.toString()} 
                onValueChange={(v) => {
                  if (v === "custom") {
                    setTempCustomRows(itemsPerPage.toString());
                    setIsCustomRowsDialogOpen(true);
                  } else {
                    setItemsPerPage(Number(v));
                    setCurrentPage(1);
                    setSelectedOrders([]);
                    setCustomRowsInput("");
                  }
                }}
              >
                <SelectTrigger className="w-[110px] h-9 text-sm">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-xs">Rows:</span>
                    {![10, 25, 50, 100].includes(itemsPerPage) ? (
                      <span className="text-sm font-medium">{itemsPerPage}</span>
                    ) : (
                      <SelectValue />
                    )}
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map(n => (
                    <SelectItem key={n} value={n.toString()}>{n}</SelectItem>
                  ))}
                  <SelectItem value="custom">
                    {![10, 25, 50, 100].includes(itemsPerPage) ? `${itemsPerPage} (custom)` : "Custom..."}
                  </SelectItem>
                </SelectContent>
              </Select>

              {/* Export — inline, desktop only, only when status filter active */}
              {statusFilter !== 'all' && (
                <>
                  <div className="hidden md:contents">
                    <Select value={exportTemplate} onValueChange={setExportTemplate}>
                      <SelectTrigger className="w-[130px] h-9 text-sm"><SelectValue placeholder="Template" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Default CSV</SelectItem>
                        <SelectItem value="pathao-manual">Pathao Manual</SelectItem>
                        <SelectItem value="carrybee-manual">Carrybee Manual</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 text-sm px-3"
                      onClick={handleExport}
                      disabled={isExporting}
                    >
                      {isExporting ? <RotateCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                      Export
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex h-[400px] items-center justify-center"><RotateCw className="h-8 w-8 animate-spin" /></div>
          ) : allOrders.length === 0 ? (
            <div className="flex h-[400px] flex-col items-center justify-center gap-2"><FileIcon className="h-10 w-10 text-muted-foreground" /><h3>No orders found</h3></div>
          ) : (
            <div className="space-y-4">

              <div className={cn("rounded-md border overflow-x-auto", itemsPerPage > 100 && "max-h-[70vh] overflow-y-auto")} ref={parentRef}>
              <Table className="min-w-[900px] sm:min-w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]"><Checkbox checked={selectedOrders.length === allOrders.length} onCheckedChange={(c) => setSelectedOrders(c ? allOrders.map(o => o.id) : [])} /></TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Assigned</TableHead>
                      <TableHead 
                        className="text-right cursor-pointer hover:text-primary transition-colors"
                        onClick={() => handleSort('total')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          Total
                          <ChevronsUpDown className="h-3 w-3" />
                        </div>
                      </TableHead>
                      <TableHead className="text-center">Track</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemsPerPage > 100 ? (
                      (() => {
                        const virtualItems = rowVirtualizer.getVirtualItems();
                        const paddingTop = virtualItems.length > 0 ? (virtualItems[0].start ?? 0) : 0;
                        const paddingBottom = virtualItems.length > 0
                          ? rowVirtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1].end ?? 0)
                          : 0;
                        return (
                          <>
                            {paddingTop > 0 && (
                              <tr><td colSpan={8} style={{ height: paddingTop, padding: 0, border: 'none' }} /></tr>
                            )}
                            {virtualItems.map((virtualRow) => {
                              const order = allOrders[virtualRow.index];
                              if (!order) return null;
                              return (
                          <TableRow
                            key={order.id}
                          >
                            <TableCell><Checkbox checked={selectedOrders.includes(order.id)} onCheckedChange={(c) => setSelectedOrders(prev => c ? [...prev, order.id] : prev.filter(id => id !== order.id))} /></TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <OrderImages products={order.products || []} orderId={order.orderNumber || undefined} />
                                <div className="flex flex-col gap-0.5 overflow-hidden">
                                  <div className="flex items-center gap-1.5">
                                    <button onClick={() => handleOpenOrder(order.id)} className="font-medium hover:underline text-left">
                                      {order.orderNumber}
                                    </button>
                                    {order.shipmentStale && (
                                      <span title="Shipment stale: No update for 12h+">
                                        <AlertCircle className="h-4 w-4 text-red-600 animate-pulse" />
                                      </span>
                                    )}
                                  </div>
                                  {(() => {
                                    const orderTime = formatOrderTime(order);
                                    return orderTime && (
                                      <div className="text-[10px] text-muted-foreground leading-tight">
                                        {orderTime}
                                      </div>
                                    );
                                  })()}
                                  {order.customerPhone && courierSummaries[order.customerPhone] ? (
                                    courierSummaries[order.customerPhone].total > 0 ? (
                                      <div
                                        className="flex flex-col gap-0.5 mt-0.5 cursor-help"
                                        onClick={(e) => { e.stopPropagation(); window.open(`/dashboard/courier-report?phone=${order.customerPhone}`, '_blank'); }}
                                        title={`Courier: Total ${courierSummaries[order.customerPhone].total} | Success ${courierSummaries[order.customerPhone].successPct}% | Failed ${courierSummaries[order.customerPhone].failedPct}%`}
                                      >
                                        <div className="text-[9px] whitespace-nowrap leading-tight flex items-center gap-1.5">
                                          <span className="text-muted-foreground font-medium">Tot: {courierSummaries[order.customerPhone].total}</span>
                                          <span className="text-emerald-600 font-bold">{courierSummaries[order.customerPhone].successPct}%</span>
                                          <span className="text-red-500 font-bold">{courierSummaries[order.customerPhone].failedPct}%</span>
                                        </div>
                                        <div className="flex h-[3px] w-20 overflow-hidden rounded-full bg-slate-100">
                                          <div
                                            className="h-full bg-emerald-500 transition-all duration-300"
                                            style={{ width: `${courierSummaries[order.customerPhone].successPct}%` }}
                                          />
                                          <div
                                            className="h-full bg-red-500 transition-all duration-300"
                                            style={{ width: `${courierSummaries[order.customerPhone].failedPct}%` }}
                                          />
                                        </div>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        className="mt-1 text-[9px] text-muted-foreground/70 italic underline-offset-2 hover:underline"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          window.open(`/dashboard/courier-report?phone=${order.customerPhone}`, '_blank');
                                        }}
                                      >
                                        No report (check)
                                      </button>
                                    )
                                  ) : null}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-0.5 min-w-[180px] max-w-[250px]">
                                <span className="font-semibold truncate text-sm" title={order.customerName}>{order.customerName}</span>
                                <a
                                  href={`tel:${order.customerPhone}`}
                                  className="text-[11px] text-blue-600 hover:underline w-fit"
                                  onClick={e => e.stopPropagation()}
                                >
                                  {order.customerPhone}
                                </a>
                                <span
                                  className="text-[11px] text-muted-foreground truncate"
                                  title={order.shippingAddress?.address || ''}
                                >
                                  {order.shippingAddress?.address || 'No address'}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={order.status}
                                onValueChange={(v) => handleStatusUpdate(order.id, v as OrderStatus)}
                                disabled={inlineSaving[order.id]}
                              >
                                <SelectTrigger className={cn("h-7 w-fit border-none shadow-none p-0 bg-transparent hover:bg-muted/50 transition-colors uppercase font-bold text-[10px]", statusColors[order.status])}>
                                  <div className={cn("px-2.5 py-0.5 rounded-full flex items-center gap-1.5", statusColors[order.status])}>
                                    {formatLabel(order.status)}
                                    {inlineSaving[order.id] ? <RotateCw className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3 opacity-50" />}
                                  </div>
                                </SelectTrigger>
                                <SelectContent>
                                  {getAvailableStatuses(order.status, orderListStatuses).map(s => (
                                    <SelectItem key={s} value={s} className="text-[11px] uppercase font-bold">{formatLabel(s)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <StaffCombobox
                                value={order.assignedToId || 'unassigned'}
                                onChange={(v) => handleInlineAssign(order.id, v)}
                                staffMembers={allStaff}
                                mode="assign"
                              />
                            </TableCell>
                            <TableCell className="text-right font-mono text-sm font-medium">
                              Tk {order.total?.toLocaleString() || '0'}
                            </TableCell>
                            <TableCell className="text-center">
                              {(() => {
                                const url = buildTrackingUrl(order);
                                return url ? (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    title={`Open ${(order.courierService || 'Courier')} tracking`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      window.open(url, '_blank');
                                    }}
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">--</span>
                                );
                              })()}
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal /></Button></DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleOpenOrder(order.id)}>View / Edit</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleInlineAssign(order.id, 'me')}>Assign to Me</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => {
                                    const win = window.open(`/print/invoice/${order.id}`, '_blank');
                                    win?.focus();
                                  }}>Print Invoice</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => {
                                    const win = window.open(`/print/sticker/${order.id}`, '_blank');
                                    win?.focus();
                                  }}>Print Sticker</DropdownMenuItem>
                                  {isAdminUser && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem className="text-red-600" onClick={() => setDeleteDialog({ isOpen: true, orderId: order.id })}>Delete</DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                              );
                            })}
                            {paddingBottom > 0 && (
                              <tr><td colSpan={8} style={{ height: paddingBottom, padding: 0, border: 'none' }} /></tr>
                            )}
                          </>
                        );
                      })()
                    ) : (
                      allOrders.map((order) => (
                        <TableRow key={order.id}>
                           <TableCell><Checkbox checked={selectedOrders.includes(order.id)} onCheckedChange={(c) => setSelectedOrders(prev => c ? [...prev, order.id] : prev.filter(id => id !== order.id))} /></TableCell>
                           <TableCell>
                             <div className="flex items-center gap-3">
                               <OrderImages products={order.products || []} orderId={order.orderNumber || undefined} />
                               <div className="flex flex-col gap-0.5 overflow-hidden">
                                 <div className="flex items-center gap-1.5">
                                   <button onClick={() => handleOpenOrder(order.id)} className="font-medium hover:underline text-left">
                                     {order.orderNumber}
                                   </button>
                                   {order.shipmentStale && (
                                     <span title="Shipment stale: No update for 12h+">
                                       <AlertCircle className="h-4 w-4 text-red-600 animate-pulse" />
                                     </span>
                                   )}
                                 </div>
                                 {(() => {
                                   const orderTime = formatOrderTime(order);
                                   return orderTime && (
                                     <div className="text-[10px] text-muted-foreground leading-tight">
                                       {orderTime}
                                     </div>
                                   );
                                 })()}
                                 {order.customerPhone && courierSummaries[order.customerPhone] ? (
                                   courierSummaries[order.customerPhone].total > 0 ? (
                                     <div
                                       className="flex flex-col gap-0.5 mt-0.5 cursor-help"
                                       onClick={(e) => { e.stopPropagation(); window.open(`/dashboard/courier-report?phone=${order.customerPhone}`, '_blank'); }}
                                       title={`Courier: Total ${courierSummaries[order.customerPhone].total} | Success ${courierSummaries[order.customerPhone].successPct}% | Failed ${courierSummaries[order.customerPhone].failedPct}%`}
                                     >
                                       <div className="text-[9px] whitespace-nowrap leading-tight flex items-center gap-1.5">
                                         <span className="text-muted-foreground font-medium">Tot: {courierSummaries[order.customerPhone].total}</span>
                                         <span className="text-emerald-600 font-bold">{courierSummaries[order.customerPhone].successPct}%</span>
                                         <span className="text-red-500 font-bold">{courierSummaries[order.customerPhone].failedPct}%</span>
                                       </div>
                                       <div className="flex h-[3px] w-20 overflow-hidden rounded-full bg-slate-100">
                                         <div
                                           className="h-full bg-emerald-500 transition-all duration-300"
                                           style={{ width: `${courierSummaries[order.customerPhone].successPct}%` }}
                                         />
                                         <div
                                           className="h-full bg-red-500 transition-all duration-300"
                                           style={{ width: `${courierSummaries[order.customerPhone].failedPct}%` }}
                                         />
                                       </div>
                                     </div>
                                   ) : (
                                     <button
                                       type="button"
                                       className="mt-1 text-[9px] text-muted-foreground/70 italic underline-offset-2 hover:underline"
                                       onClick={(e) => {
                                         e.preventDefault();
                                         e.stopPropagation();
                                         window.open(`/dashboard/courier-report?phone=${order.customerPhone}`, '_blank');
                                       }}
                                     >
                                       No report (check)
                                     </button>
                                   )
                                 ) : null}
                               </div>
                             </div>
                           </TableCell>
                           <TableCell>
                             <div className="flex flex-col gap-0.5 min-w-[180px] max-w-[250px]">
                               <span className="font-semibold truncate text-sm" title={order.customerName}>{order.customerName}</span>
                               <a
                                 href={`tel:${order.customerPhone}`}
                                 className="text-[11px] text-blue-600 hover:underline w-fit"
                                 onClick={e => e.stopPropagation()}
                               >
                                 {order.customerPhone}
                               </a>
                               <span
                                 className="text-[11px] text-muted-foreground truncate"
                                 title={order.shippingAddress?.address || ''}
                               >
                                 {order.shippingAddress?.address || 'No address'}
                               </span>
                             </div>
                            </TableCell>
                           <TableCell>
                             <Select
                               value={order.status}
                               onValueChange={(v) => handleStatusUpdate(order.id, v as OrderStatus)}
                               disabled={inlineSaving[order.id]}
                             >
                               <SelectTrigger className={cn("h-7 w-fit border-none shadow-none p-0 bg-transparent hover:bg-muted/50 transition-colors uppercase font-bold text-[10px]", statusColors[order.status])}>
                                 <div className={cn("px-2.5 py-0.5 rounded-full flex items-center gap-1.5", statusColors[order.status])}>
                                   {formatLabel(order.status)}
                                   {inlineSaving[order.id] ? <RotateCw className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3 opacity-50" />}
                                 </div>
                               </SelectTrigger>
                               <SelectContent>
                                 {getAvailableStatuses(order.status, orderListStatuses).map(s => (
                                   <SelectItem key={s} value={s} className="text-[11px] uppercase font-bold">{formatLabel(s)}</SelectItem>
                                 ))}
                               </SelectContent>
                             </Select>
                           </TableCell>
                           <TableCell>
                             <StaffCombobox
                               value={order.assignedToId || 'unassigned'}
                               onChange={(v) => handleInlineAssign(order.id, v)}
                               staffMembers={allStaff}
                               mode="assign"
                             />
                           </TableCell>
                           <TableCell className="text-right font-mono text-sm font-medium">
                             Tk {order.total?.toLocaleString() || '0'}
                           </TableCell>
                           <TableCell className="text-center">
                            {(() => {
                              const url = buildTrackingUrl(order);
                              return url ? (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title={`Open ${(order.courierService || 'Courier')} tracking`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    window.open(url, '_blank');
                                  }}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">--</span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreHorizontal /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleOpenOrder(order.id)}>View / Edit</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleInlineAssign(order.id, 'me')}>Assign to Me</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => {
                                  const win = window.open(`/print/invoice/${order.id}`, '_blank');
                                  win?.focus();
                                }}>Print Invoice</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => {
                                  const win = window.open(`/print/sticker/${order.id}`, '_blank');
                                  win?.focus();
                                }}>Print Sticker</DropdownMenuItem>
                                {isAdminUser && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem className="text-red-600" onClick={() => setDeleteDialog({ isOpen: true, orderId: order.id })}>Delete</DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground w-full sm:w-auto text-center sm:text-left">
            Showing {allOrders.length} of {totalOrders}
          </div>

          <div className="flex items-center justify-center gap-2 w-full sm:w-auto">
            {/* Mobile View: Prev / Page X of Y / Next */}
            <div className="flex sm:hidden items-center gap-4 w-full justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="flex-1"
              >
                Prev
              </Button>
              <span className="text-sm font-medium whitespace-nowrap px-4">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="flex-1"
              >
                Next
              </Button>
            </div>

            {/* Desktop View: Numbered Pages */}
            <div className="hidden sm:flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Prev
              </Button>
              <div className="flex gap-1">
                {getPaginationRange().map((p, i) => (
                  <Button
                    key={i}
                    variant={p === currentPage ? "default" : "outline"}
                    size="sm"
                    className="w-9"
                    onClick={() => typeof p === 'number' && setCurrentPage(p)}
                    disabled={typeof p !== 'number'}
                  >
                    {p}
                  </Button>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </CardFooter>
      </Card>

      {selectedOrders.length > 0 && (
        <div className="fixed bottom-3 left-3 right-3 z-50 animate-in fade-in slide-in-from-bottom-4 sm:left-1/2 sm:-translate-x-1/2 sm:right-auto sm:w-auto">
          <Card className="flex flex-wrap items-center gap-1.5 sm:gap-2.5 p-2 sm:p-3 shadow-2xl border-primary/20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center gap-1.5 border-r pr-2 sm:pr-3">
              <span className="text-xs font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full min-w-[20px] text-center">{selectedOrders.length}</span>
              <Button variant="ghost" size="icon" className="h-5 w-5 sm:h-6 sm:w-6" onClick={() => setSelectedOrders([])}>
                <XIcon className="h-3 w-3 sm:h-4 sm:w-4" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-1 sm:gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2 sm:px-3">Status <ChevronDown className="ml-1 h-3 w-3" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {bulkAvailableStatuses.length > 0 ? (
                    bulkAvailableStatuses.map(s => (
                      <DropdownMenuItem key={s} onSelect={() => openAfterMenuSettles(() => handleBulkStatus(s))}>
                        {formatLabel(s)}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>
                      No valid common status
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="min-w-[150px] sm:min-w-[200px]">
                <StaffCombobox
                  value={bulkAssignPickerValue}
                  onChange={(value) => {
                    setBulkAssignPickerValue(value);
                    handleBulkAssign(value as string | 'me' | 'unassigned');
                  }}
                  staffMembers={allStaff}
                  mode="assign"
                  selectedLabel="Assign"
                />
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2 sm:px-3">Print <ChevronDown className="ml-1 h-3 w-3" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => openAfterMenuSettles(() => handleBulkPrint('invoice'))}>Invoices</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openAfterMenuSettles(() => handleBulkPrint('sticker'))}>Stickers</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 text-xs px-2 sm:px-3">Courier <ChevronDown className="ml-1 h-3 w-3" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => openAfterMenuSettles(() => handleBulkDispatch('Steadfast'))}>Steadfast</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openAfterMenuSettles(() => handleBulkDispatch('Pathao'))}>Pathao</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openAfterMenuSettles(() => handleBulkDispatch('Carrybee'))}>Carrybee</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {isAdminUser && (
                <Button size="sm" variant="destructive" className="h-7 text-xs px-2 sm:px-3" onClick={handleBulkDelete}>Delete</Button>
              )}
            </div>
          </Card>
        </div>
      )}

      <NewOrderDialog open={isNewOrderDialogOpen} onOpenChange={setIsNewOrderDialogOpen} onOrderCreated={mutateOrders} />
      <Sheet open={!!viewOrderId} onOpenChange={(o) => !o && handleCloseView()}>
        <SheetContent side="right" className="w-full sm:w-[96vw] sm:max-w-none lg:w-[92vw] p-0 overflow-y-auto">
          <SheetHeader className="sr-only">
            <SheetTitle>Order Details</SheetTitle>
            <SheetDescription>View and manage order details.</SheetDescription>
          </SheetHeader>
          {viewOrderId && <OrderDetailsView orderId={viewOrderId} lockToken={viewOrderLockToken ?? undefined} onClose={handleCloseView} onUpdated={mutateOrders} />}
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteDialog.isOpen} onOpenChange={(o) => !o && setDeleteDialog({ isOpen: false, orderId: null })}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Order</AlertDialogTitle><AlertDialogDescription>This will permanently remove the order. Ensure it is canceled first.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={printWarning.isOpen} onOpenChange={(o) => setPrintWarning(prev => ({ ...prev, isOpen: o }))}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Large Print Batch</AlertDialogTitle><AlertDialogDescription>You are printing {selectedOrders.length} docs. This might be slow.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => executeBulkPrint(printWarning.type!)}>Continue</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDialog.isOpen} onOpenChange={(o) => setConfirmDialog(prev => ({ ...prev, isOpen: o }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title || 'Confirm Action'}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDialog.onConfirm}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isBulkActing && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-md p-4">
          <Card className="shadow-2xl">
            <CardContent className="p-4 flex flex-col gap-2">
              <div className="flex justify-between text-sm font-medium"><span>{bulkActionLabel}</span><span>{bulkActionProgress}%</span></div>
              <Progress value={bulkActionProgress} />
            </CardContent>
          </Card>
        </div>
      )}
      <AlertDialog open={isCustomRowsDialogOpen} onOpenChange={setIsCustomRowsDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Custom Rows Per Page</AlertDialogTitle>
            <AlertDialogDescription>
              Enter the number of orders you want to see per page (Max: {MAX_CUSTOM_ROWS}).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input 
              type="number" 
              value={tempCustomRows} 
              onChange={(e) => setTempCustomRows(e.target.value)}
              placeholder="e.g. 150"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyCustomRowsValue(tempCustomRows);
                }
              }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsCustomRowsDialogOpen(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => applyCustomRowsValue(tempCustomRows)}>Set Amount</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
