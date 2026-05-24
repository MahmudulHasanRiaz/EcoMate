'use client';

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    Bell,
    Home,
    Package,
    PackageCheck,
    ShoppingCart,
    Users,
    Warehouse,
    Truck,
    Settings,
    User,
    PanelLeft,
    Building,
    Handshake,
    Landmark,
    Wallet,
    BarChartHorizontal,
    Archive,
    FileSearch,
    ClipboardList,
    ChevronDown,
    RotateCcw,
    AlertCircle,
    Clock,
    Play,
    Pause,
    Coffee,
    LogOut,
    LogIn,
    BookOpen,
    MonitorSmartphone,
    Megaphone,
    ListTodo,
    CalendarDays,
    Search,
    PanelLeftClose,
    PanelLeftOpen,
    Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuFooter,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import React, { Suspense, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { UserButton, useUser } from "@clerk/nextjs";
import { Skeleton } from "@/components/ui/skeleton";
import { getNotifications, markAllAsRead, markAsRead } from "@/services/notifications";
import type { Notification, StaffMember, StaffRole, Permission } from "@/types";
import { PermissionsProvider, usePermissions } from "@/hooks/use-permissions";
import { PageLoader } from "@/components/ui/page-loader";
import { formatDistanceToNow } from "date-fns";
import { NotificationIcon } from "@/components/notification-icon";
import { getCurrentStaff } from "@/services/staff";
import { clockIn, clockOut, endBreak, getMyTodayAttendance, startBreak, startInactive, endInactive } from "@/services/attendance";
import { useToast } from "@/hooks/use-toast";
import { SWRProvider } from "@/providers/swr-provider";
import useSWR, { useSWRConfig } from "swr";
import { getOrders } from "@/services/orders";
import { getPageAccessKey, normalizePageAccess } from "@/lib/page-access";


const isPublicRoute = (pathname: string) => {
    return pathname.startsWith('/shop') || pathname.startsWith('/track-order');
}

const hasReadAccess = (permission: Permission | boolean | undefined): boolean => {
    if (permission === undefined) return false;
    if (typeof permission === 'boolean') return permission;
    return permission.read;
}

const hasPageAccess = (
    pageAccess: StaffMember['permissions']['pageAccess'] | undefined,
    key: string,
    fallback?: Permission | boolean,
) => {
    if (pageAccess) return Boolean(pageAccess[key]);
    return hasReadAccess(fallback);
};

const navItems = (permissions: StaffMember['permissions'] | null, role?: string) => {
    const pageAccess = normalizePageAccess(permissions?.pageAccess as any, role, permissions);
    return [
        {
            group: "Workspace",
            items: [
                { href: "/dashboard", icon: Home, label: "Dashboard", access: hasPageAccess(pageAccess, 'pages.dashboard') },
                { href: "/dashboard/tasks", icon: ListTodo, label: "Tasks", access: hasPageAccess(pageAccess, 'pages.tasks', permissions?.tasks) },
                { href: "/dashboard/issues", icon: AlertCircle, label: "Issues", access: hasPageAccess(pageAccess, 'pages.issues', permissions?.issues) },
                { href: "/dashboard/account/leave", icon: CalendarDays, label: "My Leave", access: true },
            ]
        },
        {
            group: "Sales & CRM",
            items: [
                { href: "/pos", icon: MonitorSmartphone, label: "POS", access: hasPageAccess(pageAccess, 'pages.orders', permissions?.orders) },
                {
                    label: "Orders",
                    icon: ShoppingCart,
                    access: hasPageAccess(pageAccess, 'pages.orders', permissions?.orders) || hasPageAccess(pageAccess, 'pages.saleReport'),
                    subItems: [
                        { href: "/dashboard/orders/all", label: "All Orders", access: hasPageAccess(pageAccess, 'pages.orders', permissions?.orders) },
                        { href: "/dashboard/orders/transactions", label: "Transactions", access: hasPageAccess(pageAccess, 'pages.orders', permissions?.orders) },
                        { href: "/dashboard/orders/incomplete", label: "Incomplete Orders", access: hasPageAccess(pageAccess, 'pages.orders', permissions?.orders) },
                        { href: "/dashboard/orders/scan", label: "Scan Orders", access: hasPageAccess(pageAccess, 'pages.orders', permissions?.orders) },
                        { href: "/dashboard/orders/sale-report", label: "Sale Report", access: hasPageAccess(pageAccess, 'pages.saleReport') },
                        { href: "/dashboard/orders/trash", label: "Trash Orders", access: role === 'Admin' },
                    ]
                },
                { href: "/dashboard/customers", icon: Users, label: "Customers", access: hasPageAccess(pageAccess, 'pages.customers', permissions?.customers) },
            ]
        },
        {
            group: "Inventory & Sourcing",
            items: [
                {
                    label: "Products",
                    icon: Package,
                    access: hasPageAccess(pageAccess, 'pages.products', permissions?.products),
                    subItems: [
                        { href: "/dashboard/products", label: "All Products", access: hasPageAccess(pageAccess, 'pages.products', permissions?.products) },
                        { href: "/dashboard/settings/categories?tab=product", label: "Categories", access: hasPageAccess(pageAccess, 'pages.products', permissions?.products) },
                    ]
                },
                {
                    label: "Inventory",
                    icon: Warehouse,
                    access: hasPageAccess(pageAccess, 'pages.inventory', permissions?.inventory),
                    subItems: [
                        { href: "/dashboard/inventory", label: "All Inventory", access: hasPageAccess(pageAccess, 'pages.inventory', permissions?.inventory) },
                        { href: "/dashboard/inventory/reserved-transfers", label: "Reserved Transfers", access: hasPageAccess(pageAccess, 'pages.inventory', permissions?.inventory) },
                    ]
                },
                { href: "/dashboard/purchases", icon: PackageCheck, label: "Purchases", access: hasPageAccess(pageAccess, 'pages.purchases', permissions?.purchases) },
            ]
        },
        {
            group: "Wholesale Management",
            items: [
                {
                    label: "Wholesale",
                    icon: Building,
                    access: hasPageAccess(pageAccess, 'pages.wholesaleManagement', (permissions as any)?.wholesaleManagement),
                    subItems: [
                        { href: "/dashboard/wholesale/orders", label: "Orders", access: hasPageAccess(pageAccess, 'pages.wholesaleManagement', (permissions as any)?.wholesaleManagement) },
                        { href: "/dashboard/wholesale/queue", label: "Approval Queue", access: hasPageAccess(pageAccess, 'pages.wholesaleManagement', (permissions as any)?.wholesaleManagement) },
                        { href: "/dashboard/wholesale/rules", label: "Qualification Rules", access: hasPageAccess(pageAccess, 'pages.wholesaleManagement', (permissions as any)?.wholesaleManagement) },
                        { href: "/dashboard/wholesale/product-requests", label: "Product Requests", access: hasPageAccess(pageAccess, 'pages.wholesaleManagement', (permissions as any)?.wholesaleManagement) },
                        { href: "/dashboard/wholesale/settings/pricing", label: "Pricing Settings", access: hasPageAccess(pageAccess, 'pages.wholesaleManagement', (permissions as any)?.wholesaleManagement) },
                    ]
                }
            ]
        },
        {
            group: "Fulfillment & Logistics",
            items: [
                { href: "/dashboard/packing-orders", icon: ClipboardList, label: "Packing Orders", access: hasPageAccess(pageAccess, 'pages.packingOrders', permissions?.packingOrders) },
                {
                    label: "Courier",
                    icon: Truck,
                    access: hasPageAccess(pageAccess, 'pages.courierManagement', permissions?.courierManagement),
                    subItems: [
                        { href: "/dashboard/courier", label: "All Couriers", access: hasPageAccess(pageAccess, 'pages.courierManagement', permissions?.courierManagement) },
                        { href: "/dashboard/courier/steadfast", label: "Steadfast", access: hasPageAccess(pageAccess, 'pages.courierManagement', permissions?.courierManagement) },
                        { href: "/dashboard/courier/carrybee", label: "Carrybee", access: hasPageAccess(pageAccess, 'pages.courierManagement', permissions?.courierManagement) },
                        { href: "/dashboard/courier/pathao", label: "Pathao", access: hasPageAccess(pageAccess, 'pages.courierManagement', permissions?.courierManagement) },
                    ]
                },
                { href: "/dashboard/courier-report", icon: FileSearch, label: "Courier Report", access: hasPageAccess(pageAccess, 'pages.courierReport', permissions?.courierReport) },
            ]
        },
        {
            group: "Finance & Analytics",
            items: [
                {
                    label: "Accounting",
                    icon: BookOpen,
                    access: hasPageAccess(pageAccess, 'pages.accounting', permissions?.accounting),
                    subItems: [
                        { href: "/dashboard/accounting", label: "Ledger & Journal", access: hasPageAccess(pageAccess, 'pages.accounting', permissions?.accounting) },
                        { href: "/dashboard/accounting/cash-drawers", label: "Cash Drawers", access: hasPageAccess(pageAccess, 'pages.accounting', permissions?.accounting) },
                    ]
                },
                {
                    label: "Expenses",
                    icon: Wallet,
                    access: hasPageAccess(pageAccess, 'pages.expenses', permissions?.expenses),
                    subItems: [
                        { href: "/dashboard/expenses", label: "All Expenses", access: hasPageAccess(pageAccess, 'pages.expenses', permissions?.expenses) },
                        { href: "/dashboard/settings/categories?tab=expense", label: "Categories", access: hasPageAccess(pageAccess, 'pages.expenses', permissions?.expenses) },
                    ]
                },
                { href: "/dashboard/check-passing", icon: Landmark, label: "Check Passing", access: hasPageAccess(pageAccess, 'pages.checkPassing', permissions?.checkPassing) },
                { href: "/dashboard/analytics", icon: BarChartHorizontal, label: "Analytics", access: hasPageAccess(pageAccess, 'pages.analytics', permissions?.analytics) },
            ]
        },
        {
            group: "Management & System",
            items: [
                {
                    label: "Staff & HR",
                    icon: User,
                    access: hasPageAccess(pageAccess, 'pages.staff', permissions?.staff) || hasPageAccess(pageAccess, 'pages.staffAssignmentReport'),
                    subItems: [
                        { href: "/dashboard/staff/analytics", label: "Staff Analytics", access: hasPageAccess(pageAccess, 'pages.staffAnalytics') },
                        { href: "/dashboard/staff", label: "All Staff", access: hasPageAccess(pageAccess, 'pages.staff', permissions?.staff) },
                        { href: "/dashboard/staff/off-days", label: "Off Day Schedule", access: hasPageAccess(pageAccess, 'pages.staff', permissions?.staff) },
                        { href: "/dashboard/staff/assignment-report", label: "Assignment Report", access: hasPageAccess(pageAccess, 'pages.staffAssignmentReport') },
                        { href: "/dashboard/staff/payroll", label: "Payroll", access: hasPageAccess(pageAccess, 'pages.staff', permissions?.staff) },
                        { href: "/dashboard/attendance", label: "Attendance Report", access: hasPageAccess(pageAccess, 'pages.attendance', permissions?.attendance) },
                        { href: "/dashboard/attendance/leaves", label: "Leave Management", access: hasPageAccess(pageAccess, 'pages.attendance', permissions?.attendance) },
                        { href: "/dashboard/attendance/calendar", label: "Attendance Calendar", access: true },
                    ]
                },
                { href: "/dashboard/partners", icon: Handshake, label: "Partners", access: hasPageAccess(pageAccess, 'pages.partners', permissions?.partners) },
                {
                    label: "Marketing",
                    icon: Megaphone,
                    access: hasPageAccess(pageAccess, 'pages.marketing', permissions?.marketing) || hasPageAccess(pageAccess, 'pages.marketingAdmin'),
                    subItems: [
                        { href: "/dashboard/marketing", label: "Marketing", access: hasPageAccess(pageAccess, 'pages.marketing', permissions?.marketing) },
                        { href: "/dashboard/marketing/admin", label: "Marketing Admin", access: hasPageAccess(pageAccess, 'pages.marketingAdmin') },
                    ]
                },
                { href: "/dashboard/webhook-failures", icon: AlertCircle, label: "Webhook Failures", access: hasPageAccess(pageAccess, 'pages.webhookFailures', permissions?.integrations) },
                { href: "/dashboard/help", icon: BookOpen, label: "Help & Tutorial", access: true },
                { href: "/dashboard/settings", icon: Settings, label: "Settings", access: hasPageAccess(pageAccess, 'pages.settings', permissions?.settings) },
            ]
        }
    ];
};


function NavLinks({ permissions, isCollapsed }: { permissions: StaffMember['permissions'] | null, isCollapsed: boolean }) {
    const { user } = useUser();
    const role = (user?.publicMetadata?.role as string || '').trim();
    const pathname = usePathname();
    const groupedNavItems = navItems(permissions, role);

    return (
        <TooltipProvider delayDuration={0}>
            <nav className="grid items-start px-2 text-sm font-medium lg:px-4 py-2 gap-4">
                {groupedNavItems.map((groupObj) => {
                    const accessibleNavItems = groupObj.items.filter(item => item.access);
                    if (accessibleNavItems.length === 0) return null;

                    return (
                        <div key={groupObj.group} className="flex flex-col gap-1">
                            {!isCollapsed && (
                                <h4 className="px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">
                                    {groupObj.group}
                                </h4>
                            )}
                            {accessibleNavItems.map((item) => {
                                if ('subItems' in item) {
                                    const accessibleSubItems = item.subItems?.filter(sub => sub.access);
                                    if (!accessibleSubItems || accessibleSubItems.length === 0) return null;
                                    const isGroupActive = accessibleSubItems.some(subItem => pathname.startsWith(subItem.href));

                                    // If collapsed, render as a Dropdown/Tooltip or just an icon that clicks to expand (for simplicity let's stick to tooltip)
                                    if (isCollapsed) {
                                        return (
                                            <Tooltip key={`group-col-${item.label}`}>
                                                <TooltipTrigger asChild>
                                                    <div className={cn(
                                                        "flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-primary mx-auto cursor-pointer",
                                                        isGroupActive && "bg-primary/10 text-primary"
                                                    )}>
                                                        <item.icon className="h-5 w-5" />
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent side="right" className="flex flex-col gap-1 p-2">
                                                    <p className="font-semibold mb-1 text-xs">{item.label}</p>
                                                    {accessibleSubItems.map(subItem => (
                                                        <Link key={subItem.href} href={subItem.href} className="text-xs text-muted-foreground hover:text-foreground">
                                                            {subItem.label}
                                                        </Link>
                                                    ))}
                                                </TooltipContent>
                                            </Tooltip>
                                        );
                                    }

                                    return (
                                        <Collapsible key={`group-${item.label}`} defaultOpen={isGroupActive}>
                                            <CollapsibleTrigger asChild>
                                                <div
                                                    className={cn(
                                                        "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-primary cursor-pointer",
                                                        isGroupActive && "text-primary font-medium"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <item.icon className="h-4 w-4" />
                                                        {item.label}
                                                    </div>
                                                    <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform duration-200", isGroupActive && "rotate-180")} />
                                                </div>
                                            </CollapsibleTrigger>
                                            <CollapsibleContent className="pl-6 pt-1">
                                                <nav className="border-l-2 border-muted grid items-start text-sm font-medium ml-2">
                                                    {accessibleSubItems.map(subItem => (
                                                        <Link
                                                            key={subItem.href}
                                                            href={subItem.href}
                                                            className={cn(
                                                                "flex items-center gap-3 rounded-r-lg px-4 py-2 text-muted-foreground transition-all hover:bg-muted/50 hover:text-primary -ml-[2px] border-l-2 border-transparent",
                                                                pathname === subItem.href && "border-primary text-primary bg-primary/5 font-medium"
                                                            )}
                                                        >
                                                            {subItem.label}
                                                        </Link>
                                                    ))}
                                                </nav>
                                            </CollapsibleContent>
                                        </Collapsible>
                                    )
                                }

                                if (isCollapsed) {
                                    return (
                                        <Tooltip key={`col-${item.href}`}>
                                            <TooltipTrigger asChild>
                                                <Link
                                                    href={item.href!}
                                                    className={cn(
                                                        "flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-primary mx-auto",
                                                        pathname === item.href && "bg-primary/10 text-primary"
                                                    )}
                                                >
                                                    <item.icon className="h-5 w-5" />
                                                </Link>
                                            </TooltipTrigger>
                                            <TooltipContent side="right">
                                                {item.label}
                                            </TooltipContent>
                                        </Tooltip>
                                    );
                                }

                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href!}
                                        className={cn(
                                            "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:bg-muted hover:text-primary",
                                            pathname === item.href && "bg-primary/10 text-primary font-medium"
                                        )}
                                    >
                                        <item.icon className="h-4 w-4" />
                                        {item.label}
                                    </Link>
                                )
                            })}
                        </div>
                    );
                })}
            </nav>
        </TooltipProvider>
    );
}

function MobileNavLinks({ onLinkClick, permissions }: { onLinkClick: () => void, permissions: StaffMember['permissions'] | null }) {
    const { user } = useUser();
    const role = (user?.publicMetadata?.role as string || '').trim();
    const pathname = usePathname();
    const groupedNavItems = navItems(permissions, role);

    return (
        <nav className="grid items-start px-2 text-sm font-medium py-2 gap-4">
            {groupedNavItems.map((groupObj) => {
                const accessibleNavItems = groupObj.items.filter(item => item.access);
                if (accessibleNavItems.length === 0) return null;

                return (
                    <div key={`mobile-${groupObj.group}`} className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0">
                        <h4 className="px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                            {groupObj.group}
                        </h4>
                        {accessibleNavItems.map((item) => {
                            if ('subItems' in item) {
                                const accessibleSubItems = item.subItems?.filter(sub => sub.access);
                                if (!accessibleSubItems || accessibleSubItems.length === 0) return null;
                                const isGroupActive = accessibleSubItems.some(subItem => pathname.startsWith(subItem.href));

                                return (
                                    <Collapsible key={`group-${item.label}`} defaultOpen={isGroupActive}>
                                        <CollapsibleTrigger asChild>
                                            <div className={cn("mx-[-0.65rem] flex items-center justify-between gap-4 rounded-xl px-4 py-2 text-muted-foreground hover:text-foreground cursor-pointer transition-colors", isGroupActive && "text-foreground font-medium")}>
                                                <div className="flex items-center gap-4">
                                                    <item.icon className="h-5 w-5" />
                                                    {item.label}
                                                </div>
                                                <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform duration-200", isGroupActive && "rotate-180")} />
                                            </div>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent className="pl-6 pt-1">
                                            <div className="border-l-2 border-border/50 flex flex-col items-start gap-1 ml-2">
                                                {accessibleSubItems.map(subItem => (
                                                    <Link
                                                        key={subItem.href}
                                                        href={subItem.href}
                                                        onClick={onLinkClick}
                                                        className={cn(
                                                            "w-full flex items-center gap-4 rounded-r-xl px-4 py-2 text-muted-foreground hover:bg-muted hover:text-foreground -ml-[2px] border-l-2 border-transparent",
                                                            pathname === subItem.href && "border-primary bg-primary/10 text-primary font-medium"
                                                        )}
                                                    >
                                                        {subItem.label}
                                                    </Link>
                                                ))}
                                            </div>
                                        </CollapsibleContent>
                                    </Collapsible>
                                )
                            }
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href!}
                                    onClick={onLinkClick}
                                    className={cn(
                                        "mx-[-0.65rem] flex items-center gap-4 rounded-xl px-4 py-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
                                        pathname.startsWith(item.href!) && item.href! !== "/dashboard" && "bg-primary/10 text-primary font-medium",
                                        pathname === item.href! && "bg-primary/10 text-primary font-medium"
                                    )}
                                >
                                    <item.icon className="h-5 w-5" />
                                    {item.label}
                                </Link>
                            )
                        })}
                    </div>
                );
            })}
        </nav>
    );
}

function UserMenu() {
    const [isMounted, setIsMounted] = React.useState(false);

    React.useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) {
        return <Skeleton className="h-8 w-8 rounded-full" />;
    }

    return <UserButton afterSignOutUrl="/" />;
}

function AttendanceWidget({ inSheet = false }: { inSheet?: boolean }) {
    const { toast } = useToast();
    const [status, setStatus] = React.useState<'clocked-out' | 'clocked-in' | 'on-break' | 'inactive-paused'>('clocked-out');
    const [timer, setTimer] = React.useState(0);
    const [breakTimer, setBreakTimer] = React.useState(0);
    const [inactiveTimer, setInactiveTimer] = React.useState(0);
    const [totalBreakMinutes, setTotalBreakMinutes] = React.useState(0);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const timerRef = React.useRef<NodeJS.Timeout | null>(null);
    const breakTimerRef = React.useRef<NodeJS.Timeout | null>(null);
    const inactiveTimerRef = React.useRef<NodeJS.Timeout | null>(null);

    const { user } = useUser();
    const rawRole = (user?.publicMetadata?.role as string || '').toLowerCase().trim();
    const isTargetRole = React.useMemo(() => {
        const normalized = rawRole.replace(/\s+/g, '');
        return ['moderator', 'modaratormanager', 'callassistant', 'callcentremanager'].includes(normalized);
    }, [rawRole]);

    const lastActivityRef = React.useRef(Date.now());
    const autoPausedRef = React.useRef(false);
    const statusRef = React.useRef(status);
    const isSubmittingRef = React.useRef(false);

    React.useEffect(() => {
        statusRef.current = status;
    }, [status]);

    const startTimer = () => {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
            setTimer(prev => prev + 1);
        }, 1000);
    };

    const stopTimer = () => {
        if (timerRef.current) clearInterval(timerRef.current);
    };

    const startBreakTimer = () => {
        if (breakTimerRef.current) clearInterval(breakTimerRef.current);
        breakTimerRef.current = setInterval(() => {
            setBreakTimer(prev => prev + 1);
        }, 1000);
    };

    const stopBreakTimer = () => {
        if (breakTimerRef.current) clearInterval(breakTimerRef.current);
    };

    const startInactiveTimer = () => {
        if (inactiveTimerRef.current) clearInterval(inactiveTimerRef.current);
        inactiveTimerRef.current = setInterval(() => {
            setInactiveTimer(prev => prev + 1);
        }, 1000);
    };

    const stopInactiveTimer = () => {
        if (inactiveTimerRef.current) clearInterval(inactiveTimerRef.current);
    };

    React.useEffect(() => {
        let isActiveCheck = true;
        const init = async () => {
            try {
                const record = await getMyTodayAttendance();
                if (!isActiveCheck) return;

                if (!record?.checkInTime || record.checkOutTime) {
                    setStatus('clocked-out');
                    setTimer(0);
                    setBreakTimer(0);
                    setInactiveTimer(0);
                    return;
                }

                const breaks = record.breaks || [];
                const inactives = record.inactiveRecords || [];
                const openBreak = [...breaks].reverse().find((b) => !b.endTime);
                const openInactive = [...inactives].reverse().find((b) => !b.endTime);
                
                const nowMs = Date.now();
                const checkInMs = new Date(record.checkInTime).getTime();
                
                const completedBreakSeconds = breaks
                    .filter((b) => b.endTime)
                    .reduce((acc, b) => acc + Math.floor((new Date(b.endTime as string).getTime() - new Date(b.startTime).getTime()) / 1000), 0);
                
                const completedInactiveSeconds = inactives
                    .filter((b) => b.endTime)
                    .reduce((acc, b) => acc + Math.floor((new Date(b.endTime as string).getTime() - new Date(b.startTime).getTime()) / 1000), 0);

                if (openBreak) {
                    const breakStartMs = new Date(openBreak.startTime).getTime();
                    const workSecondsAtBreakStart = Math.max(0, Math.floor((breakStartMs - checkInMs) / 1000) - completedBreakSeconds - completedInactiveSeconds);
                    setTimer(workSecondsAtBreakStart);
                    setBreakTimer(Math.max(0, Math.floor((nowMs - breakStartMs) / 1000)));
                    setTotalBreakMinutes(record.totalBreakDuration || 0);
                    setStatus('on-break');
                    stopTimer();
                    stopInactiveTimer();
                    startBreakTimer();
                } else if (openInactive) {
                    const inactiveStartMs = new Date(openInactive.startTime).getTime();
                    const workSecondsAtInactiveStart = Math.max(0, Math.floor((inactiveStartMs - checkInMs) / 1000) - completedBreakSeconds - completedInactiveSeconds);
                    setTimer(workSecondsAtInactiveStart);
                    setInactiveTimer(Math.max(0, Math.floor((nowMs - inactiveStartMs) / 1000)));
                    setTotalBreakMinutes(record.totalBreakDuration || 0);
                    setStatus('inactive-paused');
                    stopTimer();
                    stopBreakTimer();
                    startInactiveTimer();
                } else {
                    const workSeconds = Math.max(0, Math.floor((nowMs - checkInMs) / 1000) - completedBreakSeconds - completedInactiveSeconds);
                    setTimer(workSeconds);
                    setStatus('clocked-in');
                    setTotalBreakMinutes(record.totalBreakDuration || 0);
                    stopBreakTimer();
                    stopInactiveTimer();
                    startTimer();
                }
            } catch (err) {
                console.error('[ATTENDANCE_WIDGET_INIT]', err);
            }
        };
        init();
        return () => {
            isActiveCheck = false;
            if (timerRef.current) clearInterval(timerRef.current);
            if (breakTimerRef.current) clearInterval(breakTimerRef.current);
            if (inactiveTimerRef.current) clearInterval(inactiveTimerRef.current);
        };
    }, []);

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    };

    const handleClockIn = async () => {
        try {
            setIsSubmitting(true);
            await clockIn();
            setStatus('clocked-in');
            setBreakTimer(0);
            setInactiveTimer(0);
            setTimer(0);
            setTotalBreakMinutes(0);
            stopBreakTimer();
            stopInactiveTimer();
            startTimer();
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Clock in failed', description: err?.message || 'Unable to clock in.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClockOut = async () => {
        if (isSubmitting || isSubmittingRef.current) return; // Prevent race with auto-resume
        try {
            isSubmittingRef.current = true;
            setIsSubmitting(true);
            // Prevent the activity handler from auto-resuming while we're clocking out
            autoPausedRef.current = false;
            await clockOut();
            setStatus('clocked-out');
            stopTimer();
            stopBreakTimer();
            stopInactiveTimer();
            setTimer(0);
            setBreakTimer(0);
            setInactiveTimer(0);
            setTotalBreakMinutes(0);
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Clock out failed', description: err?.message || 'Unable to clock out.' });
        } finally {
            isSubmittingRef.current = false;
            setIsSubmitting(false);
        }
    };

    const handleBreak = async () => {
        if (status === 'clocked-in') {
            try {
                setIsSubmitting(true);
                const record = await startBreak();
                setTotalBreakMinutes(record?.totalBreakDuration || 0);
                setStatus('on-break');
                stopTimer();
                stopInactiveTimer();
                setBreakTimer(0);
                startBreakTimer();
            } catch (err: any) {
                toast({ variant: 'destructive', title: 'Break failed', description: err?.message || 'Unable to start break.' });
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        if (status === 'on-break' || status === 'inactive-paused') {
            try {
                setIsSubmitting(true);
                let record;
                if (status === 'on-break') {
                    record = await endBreak();
                } else {
                    record = await endInactive();
                }
                setTotalBreakMinutes(record?.totalBreakDuration || 0);
                setStatus('clocked-in');
                autoPausedRef.current = false;
                stopBreakTimer();
                stopInactiveTimer();
                startTimer();
            } catch (err: any) {
                toast({ variant: 'destructive', title: 'Resume failed', description: err?.message });
            } finally {
                setIsSubmitting(false);
            }
        }
    };

    React.useEffect(() => {
        if (!isTargetRole) return;

        const handleActivity = async () => {
             lastActivityRef.current = Date.now();

             // Skip auto-resume if user is already performing an action (e.g. clicking Clock Out)
             if (autoPausedRef.current && statusRef.current === 'inactive-paused' && !isSubmittingRef.current) {
                 autoPausedRef.current = false;
                 try {
                     isSubmittingRef.current = true;
                     setIsSubmitting(true);
                     const record = await endInactive();
                     setTotalBreakMinutes(record?.totalBreakDuration || 0);
                     setStatus('clocked-in');
                     stopInactiveTimer();
                     startTimer();
                     toast({ title: 'Resumed', description: 'Working time resumed due to activity.' });
                 } catch (err: any) {
                     toast({ variant: 'destructive', title: 'Resume failed', description: err?.message });
                 } finally {
                     isSubmittingRef.current = false;
                     setIsSubmitting(false);
                 }
             }
        };

        const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
        let throttleTimer: NodeJS.Timeout | null = null;
        const throttledHandler = () => {
            if (!throttleTimer) {
                throttleTimer = setTimeout(() => {
                    handleActivity();
                    throttleTimer = null;
                }, 1000);
            }
        };

        events.forEach(e => window.addEventListener(e, throttledHandler, { passive: true }));
        
        const inactivityChecker = setInterval(async () => {
            const now = Date.now();
            // Moderator gets 7 minutes, others get 2 minutes
            const isModerator = rawRole.replace(/\s+/g, '') === 'moderator';
            const inactivityMs = isModerator ? 420000 : 120000;
            if (now - lastActivityRef.current > inactivityMs && statusRef.current === 'clocked-in' && !autoPausedRef.current) {
                autoPausedRef.current = true;
                try {
                     setIsSubmitting(true);
                     const record = await startInactive();
                     setTotalBreakMinutes(record?.totalBreakDuration || 0);
                     setStatus('inactive-paused');
                     stopTimer();
                     setInactiveTimer(0);
                     startInactiveTimer();
                     toast({ title: 'Paused', description: 'Working time auto-paused due to inactivity.' });
                } catch (err: any) {
                     toast({ variant: 'destructive', title: 'Pause failed', description: err?.message });
                     autoPausedRef.current = false;
                } finally {
                     setIsSubmitting(false);
                }
            }
        }, 30000); // Check every 30 seconds

        return () => {
            events.forEach(e => window.removeEventListener(e, throttledHandler));
            if (throttleTimer) clearTimeout(throttleTimer);
            clearInterval(inactivityChecker);
        };
    }, [isTargetRole, toast]);

    if (status === 'clocked-out') {
        return (
            <Button size="sm" onClick={handleClockIn} className={cn(inSheet && 'w-full')} disabled={isSubmitting}>
                <LogIn className="mr-2 h-4 w-4" />
                Clock In
            </Button>
        );
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant={status === 'clocked-in' ? 'outline' : 'secondary'} size="sm" className={cn("gap-2 border-dashed relative h-8", status === 'clocked-in' && "border-green-500/50 bg-green-500/10 hover:bg-green-500/20 text-green-700", (status === 'on-break' || status === 'inactive-paused') && "border-yellow-500/50 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-700", inSheet && "w-full justify-center")}>
                    {status === 'clocked-in' && <Play className="h-3.5 w-3.5 text-green-600 shrink-0" />}
                    {(status === 'on-break' || status === 'inactive-paused') && <Pause className="h-3.5 w-3.5 text-yellow-600 shrink-0" />}
                    <span className="font-mono text-xs">
                        {status === 'clocked-in' ? formatTime(timer) : 
                         status === 'on-break' ? formatTime(breakTimer) : 
                         formatTime(inactiveTimer)}
                    </span>
                    {status === 'inactive-paused' && <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500"></span></span>}
                </Button>
            </PopoverTrigger>
            <PopoverContent align={inSheet ? "center" : "end"} className="w-auto p-3 flex flex-col gap-3 rounded-xl shadow-xl border-primary/10">
                <div className="flex flex-col items-center border-b pb-3 mb-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Status</p>
                    <div className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-mono w-full justify-center bg-muted/50",
                        (status === 'on-break' || status === 'inactive-paused') && 'bg-yellow-500/10 border-yellow-500/30 text-yellow-700 font-bold'
                    )}>
                        {status === 'clocked-in' && <Play className="h-4 w-4 text-green-500" />}
                        {(status === 'on-break' || status === 'inactive-paused') && <Pause className="h-4 w-4 text-yellow-500" />}
                        <span>
                            {status === 'clocked-in' ? formatTime(timer) : 
                             status === 'on-break' ? formatTime(breakTimer) : 
                             formatTime(inactiveTimer)}
                        </span>
                        {status === 'inactive-paused' && <span className="text-[10px] text-yellow-600 uppercase font-bold ml-1">Inactive</span>}
                    </div>
                    {(() => {
                        const liveTotalBreakSeconds = Math.floor(totalBreakMinutes * 60) + (status === 'on-break' ? breakTimer : 0);
                        return liveTotalBreakSeconds > 0 ? (
                            <p className="text-[10px] text-muted-foreground mt-1.5 font-medium">
                                Total Break Today: <span className="font-mono text-foreground">{formatTime(liveTotalBreakSeconds)}</span>
                            </p>
                        ) : null;
                    })()}
                </div>
                <div className="flex gap-2 w-full">
                    <Button size="sm" variant="outline" onClick={handleBreak} disabled={isSubmitting} className="flex-1">
                        {status === 'clocked-in' ? (
                            <><Coffee className="mr-2 h-4 w-4 shrink-0" /> Break</>
                        ) : (
                            <><Play className="mr-2 h-4 w-4 shrink-0" /> Resume</>
                        )}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleClockOut} disabled={isSubmitting} className="flex-1">
                        <LogOut className="mr-2 h-4 w-4 shrink-0" /> Clock Out
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

function DashboardLayoutContent({
    children,
    initialPermissions,
    initialAuthState,
    generalSettings,
    brandingSettings
}: {
    children: React.ReactNode;
    initialPermissions: StaffMember['permissions'] | null;
    initialAuthState: 'loading' | 'authenticated' | 'blocked';
    generalSettings: any;
    brandingSettings: { iconLogoUrl?: string; standardLogoUrl?: string; darkLogoUrl?: string };
}) {
    const router = useRouter();
    const pathname = usePathname();
    const [notifications, setNotifications] = React.useState<Notification[]>([]);
    const [isMobileNavOpen, setIsMobileNavOpen] = React.useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
    const [openCommand, setOpenCommand] = React.useState(false);
    const [commandSearchTerm, setCommandSearchTerm] = React.useState('');
    const [searchData, setSearchData] = React.useState<{ orders: any[], products: any[], customers: any[] }>({ orders: [], products: [], customers: [] });
    const [isSearching, setIsSearching] = React.useState(false);
    const [storeName] = React.useState(generalSettings?.storeName || 'EcoMate');
    const [forcedPermissions, setForcedPermissions] = React.useState<StaffMember['permissions'] | null>(initialPermissions);
    const [authLoading, setAuthLoading] = React.useState(initialAuthState === 'loading');
    const [isBlocked, setIsBlocked] = React.useState(initialAuthState === 'blocked');
    const [employmentEnded, setEmploymentEnded] = React.useState(false);
    const isLoaded = initialAuthState !== 'loading';
    const isSignedIn = initialAuthState === 'authenticated';
    const permissions = usePermissions() || forcedPermissions;
    const pageAccess = normalizePageAccess(permissions?.pageAccess, undefined, permissions || undefined);
    const pageAccessKey = getPageAccessKey(pathname);
    const isAccountPath = pathname.startsWith('/dashboard/account');
    const canAccessPage = employmentEnded
        ? isAccountPath
        : (pageAccessKey ? Boolean(pageAccess?.[pageAccessKey]) : true);
    const [installEvent, setInstallEvent] = React.useState<any>(null);
    const [isInstallable, setIsInstallable] = React.useState(false);

    React.useEffect(() => {
        if (initialAuthState === 'blocked') {
            router.replace('/unauthorized');
            return;
        }
        if (isLoaded && isSignedIn) {
            setAuthLoading(false);
        }
    }, [initialAuthState, isLoaded, isSignedIn, pathname, router]);

    React.useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpenCommand((open) => !open);
            }
        };
        document.addEventListener("keydown", down);
        return () => document.removeEventListener("keydown", down);
    }, []);

    React.useEffect(() => {
        if (commandSearchTerm.length >= 2) {
            setIsSearching(true);
            const timer = setTimeout(() => {
                fetch(`/api/search?q=${encodeURIComponent(commandSearchTerm)}`)
                    .then(res => res.json())
                    .then(data => {
                        setSearchData(data || { orders: [], products: [], customers: [] });
                        setIsSearching(false);
                    })
                    .catch((err) => {
                        console.error('Search error:', err);
                        setIsSearching(false);
                    });
            }, 300);
            return () => clearTimeout(timer);
        } else {
            setSearchData({ orders: [], products: [], customers: [] });
            setIsSearching(false);
        }
    }, [commandSearchTerm]);

    // PWA install prompt handler — uses shared helper
    React.useEffect(() => {
        const { getDeferredPrompt, listenForBeforeInstallPrompt, listenForAppInstalled } = require('@/lib/pwa-install');

        // Check cached prompt
        const cached = getDeferredPrompt();
        if (cached) {
            setInstallEvent(cached);
            setIsInstallable(true);
        }

        const cleanupPrompt = listenForBeforeInstallPrompt((e: any) => {
            setInstallEvent(e);
            setIsInstallable(true);
        });

        const cleanupInstalled = listenForAppInstalled(() => {
            setIsInstallable(false);
            setInstallEvent(null);
        });

        return () => {
            cleanupPrompt();
            cleanupInstalled();
        };
    }, []);

    const handleInstallClick = async () => {
        if (!installEvent?.prompt) return;
        try {
            await installEvent.prompt();
            const choice = await installEvent.userChoice;
            if (choice?.outcome === 'accepted') {
                setIsInstallable(false);
                const { clearDeferredPrompt } = require('@/lib/pwa-install');
                clearDeferredPrompt();
            }
        } catch (err) {
            console.error('[PWA_INSTALL_ERROR]', err);
        }
    };

    const isEmploymentEnded = (jobEndDate?: string | null) => {
        if (!jobEndDate) return false;
        const end = new Date(jobEndDate);
        if (Number.isNaN(end.getTime())) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);
        return end <= today;
    };

    React.useEffect(() => {
        const check = async () => {
            if (isPublicRoute(pathname)) {
                setAuthLoading(false);
                return;
            }

            // If we already have initial state from server, we don't need to fetch again on mount
            // unless something changes or we are in a specific scenario
            if (isLoaded) {
                setAuthLoading(false);
                // If blocked, handle redirect
                if (initialAuthState === 'blocked') {
                    router.replace('/unauthorized');
                }
                return;
            }

            const res = await getCurrentStaff();
            if (res.status === 'blocked') {
                setIsBlocked(true);
                router.replace('/unauthorized');
                return;
            }
            const ended = isEmploymentEnded(res.staff?.jobEndDate || null);
            setEmploymentEnded(ended);
            if (ended && !isAccountPath) {
                router.replace('/dashboard/account');
                setAuthLoading(false);
                return;
            }
            setForcedPermissions(res.staff.permissions || null);
            setAuthLoading(false);
        };
        check();
    }, [pathname, router, initialAuthState, isLoaded, isSignedIn, isAccountPath]);


    React.useEffect(() => {
        getNotifications().then(setNotifications);
    }, []);


    const unreadCount = notifications.filter(n => !n.read).length;

    const handleMarkAllAsRead = async () => {
        await markAllAsRead();
        setNotifications(prevNotifications =>
            prevNotifications.map(n => ({ ...n, read: true }))
        );
    };

    const handleNotificationClick = async (id: string, href: string) => {
        await markAsRead(id);
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
        router.push(href);
    };

    // Prefetch Orders for instant view using the standardized service
    // This ensures data is normalized correctly in the cache
    useSWR('/api/orders?pageSize=10', () => getOrders({ pageSize: 10 }), {
        revalidateOnMount: true,
        dedupingInterval: 60000,
    });

    React.useEffect(() => {
        // Prevent body scroll for dashboard
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
        };
    }, []);

    if (authLoading || isBlocked) {
        return (
            <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
                <Skeleton className="h-16 w-16" />
            </div>
        );
    }

    return (
        <PermissionsProvider forcedPermissions={forcedPermissions}>
            <PageLoader />
            <div className={cn("dashboard-shell grid fixed inset-0 h-screen w-full overflow-hidden bg-background transition-[grid-template-columns] duration-300", isSidebarCollapsed ? "md:grid-cols-[70px_1fr]" : "md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr]")}>
                <div className="dashboard-sidebar hidden border-r bg-muted/20 md:block md:h-full z-10 shadow-sm relative">
                    <div className="flex h-full max-h-screen flex-col gap-2">
                        <div className={cn("flex items-center border-b h-14 lg:h-[60px]", isSidebarCollapsed ? "justify-center px-0" : "px-4 justify-between lg:px-6")}>
                            {!isSidebarCollapsed && (
                                <Link href="/" className="flex items-center gap-3 font-semibold px-1 py-2 overflow-hidden shrink-0">
                                    <Logo variant="icon" size={36} srcOverride={brandingSettings.iconLogoUrl || brandingSettings.standardLogoUrl} />
                                    <span className="truncate text-sm lg:text-base">{storeName}</span>
                                </Link>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} className={cn("text-muted-foreground hover:bg-muted shrink-0", isSidebarCollapsed && "")}>
                                {isSidebarCollapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
                            </Button>
                        </div>
                        <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
                            <NavLinks permissions={employmentEnded ? null : permissions} isCollapsed={isSidebarCollapsed} />
                        </div>
                    </div>
                </div>
                <div className="flex flex-col h-full overflow-hidden print:h-auto print:overflow-visible">
                    <header className="dashboard-topbar sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-muted px-4 lg:h-[60px] lg:px-6">
                        <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
                            <SheetTrigger asChild>
                                <Button variant="outline" size="icon" className="shrink-0 md:hidden">
                                    <PanelLeft className="h-5 w-5" />
                                    <span className="sr-only">Toggle navigation menu</span>
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="flex flex-col p-0">
                                <SheetHeader className="p-4 border-b">
                                    <SheetTitle className="sr-only">Main Menu</SheetTitle>
                                    <AttendanceWidget inSheet={true} />
                                </SheetHeader>
                                <div className="flex-1 overflow-y-auto">
                                    <MobileNavLinks onLinkClick={() => setIsMobileNavOpen(false)} permissions={employmentEnded ? null : permissions} />
                                </div>
                            </SheetContent>
                        </Sheet>
                        <div className="w-full flex-1 md:hidden min-w-0">
                            <div className="flex h-full items-center justify-center min-w-0">
                                <Link href="/dashboard" className="flex items-center gap-2 sm:gap-3 font-semibold px-1 py-2 min-w-0">
                                    <Logo variant="icon" size={40} srcOverride={brandingSettings.iconLogoUrl || brandingSettings.standardLogoUrl} className="shrink-0" />
                                    <span className="truncate text-sm">{storeName}</span>
                                </Link>
                            </div>
                        </div>
                        <div className="flex shrink-0 md:flex-1 items-center justify-end md:justify-between md:mb-0 gap-4">
                            <Button 
                                variant="outline" 
                                className="relative h-8 w-8 md:w-40 lg:w-64 md:justify-start rounded-full md:rounded-[0.5rem] bg-muted/50 p-0 md:px-3 text-sm font-normal text-muted-foreground shadow-none md:pr-12 shrink-0"
                                onClick={() => setOpenCommand(true)}
                            >
                                <Search className="h-4 w-4 md:hidden" />
                                <span className="hidden lg:inline-flex">Search orders...</span>
                                <span className="hidden md:inline-flex lg:hidden">Search...</span>
                                <kbd className="pointer-events-none absolute right-[0.3rem] top-[0.3rem] hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 md:flex">
                                    <span className="text-xs">⌘</span>K
                                </kbd>
                            </Button>
                            <div className="hidden md:flex items-center gap-4">
                                <AttendanceWidget />
                            </div>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                            {isInstallable && (
                                <Button variant="outline" size="sm" className="hidden md:inline-flex shrink-0" onClick={handleInstallClick}>
                                    <MonitorSmartphone className="h-4 w-4 mr-2" />
                                    Install App
                                </Button>
                            )}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="icon" className="relative h-8 w-8 shrink-0">
                                        <Bell className="h-4 w-4" />
                                        {unreadCount > 0 && <Badge className="absolute -top-2 -right-2 h-5 w-5 justify-center p-0">{unreadCount}</Badge>}
                                        <span className="sr-only">Toggle notifications</span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-80">
                                    <DropdownMenuLabel className="flex items-center justify-between">
                                        <span>Notifications</span>
                                        <Badge variant="secondary">{unreadCount} unread</Badge>
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <div className="max-h-80 overflow-y-auto">
                                        {notifications.map((notification) => (
                                            <DropdownMenuItem key={notification.id} className={cn("flex items-start gap-3 p-3", !notification.read && "bg-blue-500/10")} onSelect={() => handleNotificationClick(notification.id, notification.href)}>
                                                <div className={cn("p-2 rounded-full", !notification.read ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>
                                                    <NotificationIcon name={notification.icon} className="h-5 w-5" />
                                                </div>
                                                <div className="flex-1">
                                                    <p className="font-medium text-sm">{notification.title}</p>
                                                    <p className="text-xs text-muted-foreground">{notification.description}</p>
                                                </div>
                                                <time className="text-xs text-muted-foreground">
                                                    {formatDistanceToNow(new Date(notification.time), { addSuffix: true })}
                                                </time>
                                            </DropdownMenuItem>
                                        ))}
                                    </div>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuFooter className="p-2 flex justify-between items-center">
                                        <Button variant="ghost" size="sm" onClick={handleMarkAllAsRead}>Mark all as read</Button>
                                        <Button variant="outline" size="sm" asChild>
                                            <Link href="/dashboard/notifications">View all</Link>
                                        </Button>
                                    </DropdownMenuFooter>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" asChild>
                                <Link href="/dashboard/account">
                                    <User className="h-4 w-4" />
                                    <span className="sr-only">My Account</span>
                                </Link>
                            </Button>
                            <div className="shrink-0 flex items-center justify-center">
                                <UserMenu />
                            </div>
                        </div>
                    </header>
                    <main className="dashboard-main flex-1 bg-background overflow-y-auto print:h-auto print:overflow-visible print:bg-white">
                        {canAccessPage ? (
                            children
                        ) : (
                            <div className="flex min-h-[60vh] items-center justify-center px-4">
                                <div className="w-full max-w-lg rounded-2xl border bg-gradient-to-b from-muted/40 via-background to-background p-8 text-center shadow-sm">
                                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                                        <AlertCircle className="h-6 w-6" />
                                    </div>
                                    <h1 className="text-xl font-semibold text-foreground">Access restricted</h1>
                                    <p className="mt-2 text-sm text-muted-foreground">
                                        You have permission to view data, but this page is not enabled for your role.
                                        Please contact an admin to request access.
                                    </p>
                                    <div className="mt-6 flex flex-wrap justify-center gap-2">
                                        <Button variant="outline" size="sm" asChild>
                                            <Link href="/dashboard">Back to Dashboard</Link>
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </main>
                </div>
            </div>
            
            <CommandDialog open={openCommand} onOpenChange={setOpenCommand}>
                <CommandInput 
                    placeholder="Search by Order ID, Phone number..." 
                    value={commandSearchTerm}
                    onValueChange={setCommandSearchTerm}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && commandSearchTerm.trim()) {
                            setOpenCommand(false);
                            router.push(`/dashboard/orders/all?search=${encodeURIComponent(commandSearchTerm.trim())}`);
                            setCommandSearchTerm('');
                        }
                    }}
                />
                <CommandList>
                    <CommandEmpty>
                        {isSearching ? (
                            <div className="flex items-center justify-center p-4">
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                <span>Searching across platform...</span>
                            </div>
                        ) : (
                            `No results found for "${commandSearchTerm}"`
                        )}
                    </CommandEmpty>

                    {!commandSearchTerm && (
                        <CommandGroup heading="Quick Links">
                            <CommandItem onSelect={() => { setOpenCommand(false); router.push('/pos'); }}>
                                <MonitorSmartphone className="mr-2 h-4 w-4" />
                                <span>Point of Sale (POS)</span>
                            </CommandItem>
                            <CommandItem onSelect={() => { setOpenCommand(false); router.push('/dashboard/products'); }}>
                                <Package className="mr-2 h-4 w-4" />
                                <span>Products</span>
                            </CommandItem>
                            <CommandItem onSelect={() => { setOpenCommand(false); router.push('/dashboard/orders/all'); }}>
                                <ShoppingCart className="mr-2 h-4 w-4" />
                                <span>All Orders</span>
                            </CommandItem>
                        </CommandGroup>
                    )}

                    {!isSearching && searchData.orders?.length > 0 && (
                        <CommandGroup heading="Orders">
                            {searchData.orders.map((order) => (
                                <CommandItem 
                                    key={order.id} 
                                    onSelect={() => { 
                                        setOpenCommand(false); 
                                        setCommandSearchTerm('');
                                        router.push(`/dashboard/orders/all?search=${encodeURIComponent(order.id)}`); 
                                    }}
                                >
                                    <ShoppingCart className="mr-2 h-4 w-4 text-sky-500" />
                                    <div className="flex flex-col flex-1 pl-1">
                                        <span className="font-medium text-[13px]">{order.id}</span>
                                        <span className="text-xs text-muted-foreground">{order.customerName} ({order.customerPhone})</span>
                                    </div>
                                    <div className="shrink-0 text-xs text-muted-foreground ml-2">
                                        {order.status}
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {!isSearching && searchData.products?.length > 0 && (
                        <CommandGroup heading="Products">
                            {searchData.products.map((product) => (
                                <CommandItem 
                                    key={product.id} 
                                    onSelect={() => { 
                                        setOpenCommand(false); 
                                        setCommandSearchTerm('');
                                        router.push(`/dashboard/products?search=${encodeURIComponent(product.sku)}`); 
                                    }}
                                >
                                    <Package className="mr-2 h-4 w-4 text-amber-500" />
                                    <div className="flex flex-col flex-1 pl-1">
                                        <span className="font-medium text-[13px]">{product.name}</span>
                                        <span className="text-xs text-muted-foreground">SKU: {product.sku}</span>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}

                    {!isSearching && searchData.customers?.length > 0 && (
                        <CommandGroup heading="Customers">
                            {searchData.customers.map((customer) => (
                                <CommandItem 
                                    key={customer.id} 
                                    onSelect={() => { 
                                        setOpenCommand(false); 
                                        setCommandSearchTerm('');
                                        router.push(`/dashboard/customers?search=${encodeURIComponent(customer.phone)}`); 
                                    }}
                                >
                                    <Users className="mr-2 h-4 w-4 text-violet-500" />
                                    <div className="flex flex-col flex-1 pl-1">
                                        <span className="font-medium text-[13px]">{customer.name}</span>
                                        <span className="text-xs text-muted-foreground">{customer.phone}</span>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    )}
                </CommandList>
            </CommandDialog>

        </PermissionsProvider>
    );
}

export default function DashboardLayoutClient({
    children,
    initialPermissions,
    initialAuthState,
    generalSettings,
    brandingSettings
}: {
    children: React.ReactNode;
    initialPermissions: StaffMember['permissions'] | null;
    initialAuthState: 'loading' | 'authenticated' | 'blocked';
    generalSettings: any;
    brandingSettings: { iconLogoUrl?: string; standardLogoUrl?: string; darkLogoUrl?: string };
}) {
    return (
        <SWRProvider>
            <DashboardLayoutContent
                initialPermissions={initialPermissions}
                initialAuthState={initialAuthState}
                generalSettings={generalSettings}
                brandingSettings={brandingSettings}
            >
                {children}
            </DashboardLayoutContent>
        </SWRProvider>
    );
}
