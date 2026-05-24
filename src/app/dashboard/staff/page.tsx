

'use client';

import { MoreHorizontal, PlusCircle, DollarSign, TrendingUp, KeyRound, ShieldCheck, User, Clock, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
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
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import React, { useMemo, useState, useEffect, useRef } from "react";
import useSWR from 'swr';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { getStaff } from "@/services/staff";
import type { StaffMember, Permission, StaffRole, Business } from "@/types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { getPresetPermissions, defaultPermissions } from "@/lib/staff-permissions";
import { PAGE_ACCESS_LIST, normalizePageAccess } from "@/lib/page-access";
import { permissionActions } from "./constants";
import { defaultBadgeRules, getBadgeForValue, getDeliverySuccessRate, normalizeBadgeRules } from '@/lib/badges';
import { DateRange } from 'react-day-picker';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { format } from "date-fns";
import { useAuthErrorHandler } from "@/hooks/use-auth-error-handler";
import { useToast } from '@/hooks/use-toast';

const ITEMS_PER_PAGE = 10;

type PaymentType = 'Salary' | 'Commission' | 'Both';
type SalaryFrequency = string;
type CommissionPeriod = 'Daily' | 'Weekly' | 'Monthly';

const paymentTypes: PaymentType[] = ['Salary', 'Commission', 'Both'];
const staffRoles: StaffRole[] = [
    'Admin',
    'Manager',
    'Project Manager',
    'Office Assistant',
    'Moderator',
    'Modarator Manager',
    'Seller',
    'Packing Assistant',
    'Call Assistant',
    'Call Centre Manager',
    'Courier Manager',
    'Courier Call Assistant',
    'Vendor/Supplier',
    'Cutting Master',
    'Marketer',
    'Finance Manager',
    'Sales Representative',
    'Custom'
];
const permissionModules: (Exclude<keyof StaffMember['permissions'], 'pageAccess'>)[] = [
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
    'integrations',
];



type StaffFormPayload = {
    name: string;
    email: string;
    phone: string;
    role?: StaffRole;
    designation?: string;
    paymentType?: PaymentType;
    salaryDetails?: { amount?: number; frequency?: string };
    commissionDetails?: StaffMember['commissionDetails'];
    permissions: StaffMember['permissions'];
    accessibleBusinessIds: string[];
    weekendDays?: number[] | null;
    overtimeEligible?: boolean;
    overtimeBonusPercent?: number;
    workType: 'Office' | 'Remote';
    jobStartDate?: string | null;
    jobEndDate?: string | null;
};

type StaffFormHandle = {
    getPayload: () => StaffFormPayload;
};

const StaffForm = React.forwardRef<StaffFormHandle, { staffMember?: StaffMember | null, isEdit?: boolean, businesses: Business[] }>(({ staffMember, isEdit = false, businesses }, ref) => {
    const [name, setName] = useState(staffMember?.name || '');
    const [email, setEmail] = useState(staffMember?.email || '');
    const [role, setRole] = useState<StaffRole | undefined>(staffMember?.role);
    const [designation, setDesignation] = useState(staffMember?.designation || '');
    const [phone, setPhone] = useState(staffMember?.phone || '');
    const [paymentType, setPaymentType] = useState<PaymentType | undefined>(staffMember?.paymentType);
    const [salaryAmount, setSalaryAmount] = useState<number | undefined>(staffMember?.salaryDetails?.amount);
    const [salaryFrequency, setSalaryFrequency] = useState<SalaryFrequency | undefined>(() => {
        const freq = staffMember?.salaryDetails?.frequency as string | undefined;
        const normalized = freq === 'Monthly' || freq === 'Weekly' || freq === 'Daily' ? freq : undefined;
        return normalized as SalaryFrequency | undefined;
    });
    const [targetEnabled, setTargetEnabled] = useState<boolean>(staffMember?.commissionDetails?.targetEnabled || false);
    const [targetPeriod, setTargetPeriod] = useState<CommissionPeriod | undefined>(() => {
        const period = staffMember?.commissionDetails?.targetPeriod as string | undefined;
        return period === 'Daily' || period === 'Weekly' || period === 'Monthly' ? period : undefined;
    });
    const [targetCount, setTargetCount] = useState<number | undefined>(staffMember?.commissionDetails?.targetCount);
    const [commissionCreate, setCommissionCreate] = useState<number | undefined>(staffMember?.commissionDetails?.onOrderCreate);
    const [commissionConfirm, setCommissionConfirm] = useState<number | undefined>(staffMember?.commissionDetails?.onOrderConfirm);
    const [commissionPack, setCommissionPack] = useState<number | undefined>(staffMember?.commissionDetails?.onOrderPacked);
    const [commissionConvert, setCommissionConvert] = useState<number | undefined>(staffMember?.commissionDetails?.onOrderConvert);
    const [accessibleBusinesses, setAccessibleBusinesses] = useState<string[]>(staffMember?.accessibleBusinessIds || []);
    const [weekendDays, setWeekendDays] = useState<number[] | null>(staffMember?.weekendDays ?? null);
    const [shiftOverrideEnabled, setShiftOverrideEnabled] = useState<boolean>(!!staffMember?.shiftOverride);
    const [shiftOverride, setShiftOverride] = useState(staffMember?.shiftOverride || { startTime: '09:00', endTime: '18:00', lateGraceMinutes: 0, earlyLeaveGraceMinutes: 0 });
    const [overtimeEligible, setOvertimeEligible] = useState<boolean>(staffMember?.overtimeEligible || false);
    const [overtimeBonusPercent, setOvertimeBonusPercent] = useState<number>(staffMember?.overtimeBonusPercent || 0);
    const [workType, setWorkType] = useState<'Office' | 'Remote'>(staffMember?.workType || 'Remote');
    const [jobStartDate, setJobStartDate] = useState<string>(staffMember?.jobStartDate || '');
    const [jobEndDate, setJobEndDate] = useState<string>(staffMember?.jobEndDate || '');
    const [permissions, setPermissions] = useState<StaffMember['permissions']>(() => {
        const base = staffMember?.permissions || defaultPermissions;
        return {
            ...base,
            pageAccess: normalizePageAccess(base.pageAccess as any, staffMember?.role, base),
        };
    });
    const normalizePermission = (value: any): Permission => {
        if (typeof value === 'boolean') {
            return { create: value, read: value, update: value, delete: value };
        }
        return (value as Permission) || { create: false, read: false, update: false, delete: false };
    };
    useEffect(() => {
        if (staffMember) {
            setName(staffMember.name);
            setEmail(staffMember.email);
            setPhone(staffMember.phone || '');
            setRole(staffMember.role);
            setDesignation(staffMember.designation || '');
            setPaymentType(staffMember.paymentType);
            setPermissions({
                ...staffMember.permissions,
                pageAccess: normalizePageAccess(staffMember.permissions?.pageAccess as any, staffMember.role, staffMember.permissions),
            });
            setAccessibleBusinesses(staffMember.accessibleBusinessIds || []);
            setWeekendDays(staffMember.weekendDays ?? null);
            setTargetEnabled(staffMember.commissionDetails?.targetEnabled || false);
            const period = staffMember.commissionDetails?.targetPeriod as string | undefined;
            setTargetPeriod(period === 'Daily' || period === 'Weekly' || period === 'Monthly' ? period : undefined);
            setTargetCount(staffMember.commissionDetails?.targetCount);
            setCommissionCreate(staffMember.commissionDetails?.onOrderCreate);
            setCommissionConfirm(staffMember.commissionDetails?.onOrderConfirm);
            setCommissionPack(staffMember.commissionDetails?.onOrderPacked);
            setCommissionConvert(staffMember.commissionDetails?.onOrderConvert);
            setSalaryAmount(staffMember.salaryDetails?.amount);
            const freq = staffMember.salaryDetails?.frequency as string | undefined;
            const normalizedFreq = freq === 'Monthly' || freq === 'Weekly' || freq === 'Daily' ? freq : undefined;
            setSalaryFrequency(normalizedFreq as SalaryFrequency | undefined);
            setOvertimeEligible(staffMember.overtimeEligible || false);
            setOvertimeBonusPercent(staffMember.overtimeBonusPercent || 0);
            setWorkType(staffMember.workType || 'Remote');
            setJobStartDate(staffMember.jobStartDate || '');
            setJobEndDate(staffMember.jobEndDate || '');
        }
    }, [staffMember]);

    // When creating (not editing), update permissions preset when role changes
    useEffect(() => {
        if (role && (role !== staffMember?.role || !isEdit)) {
            const preset = getPresetPermissions(role);
            setPermissions({
                ...preset,
                pageAccess: normalizePageAccess(preset.pageAccess as any, role, preset),
            });
        }
    }, [role, isEdit, staffMember?.role]);

    const handlePermissionChange = (module: keyof StaffMember['permissions'], action: keyof Permission, value: boolean) => {
        if (module === 'pageAccess') return;
        setPermissions(prev => {
            const current = normalizePermission(prev[module]);
            return {
                ...prev,
                [module]: {
                    ...current,
                    [action]: value,
                },
            };
        });
    };

    const pageAccess = React.useMemo(
        () => normalizePageAccess(permissions?.pageAccess as any, role, permissions),
        [permissions, role]
    );

    const handlePageAccessChange = (key: string, value: boolean) => {
        setPermissions(prev => ({
            ...prev,
            pageAccess: {
                ...normalizePageAccess(prev?.pageAccess as any, role, prev),
                [key]: value,
            },
        }));
    };

    const handleBusinessAccessChange = (businessId: string, checked: boolean) => {
        setAccessibleBusinesses(prev => (checked ? [...prev, businessId] : prev.filter(id => id !== businessId)));
    };

    const isAdminRole = role === 'Admin';

    // Admins automatically get all businesses; lock the checklist
    useEffect(() => {
        if (isAdminRole) {
            const allIds = businesses.map((b) => b.id);
            setAccessibleBusinesses(allIds);
        }
    }, [isAdminRole, businesses]);

    React.useImperativeHandle(ref, () => ({
        getPayload: () => ({
            name,
            email,
            phone,
            role,
            designation,
            paymentType,
            salaryDetails: salaryAmount || salaryFrequency ? { amount: salaryAmount, frequency: salaryFrequency } : undefined,
            commissionDetails: {
                onOrderCreate: commissionCreate,
                onOrderConfirm: commissionConfirm,
                onOrderPacked: commissionPack,
                onOrderConvert: commissionConvert,
                targetEnabled,
                targetPeriod,
                targetCount,
            },
            permissions: {
                ...permissions,
                pageAccess,
            },
            accessibleBusinessIds: isAdminRole ? businesses.map((b: Business) => b.id) : accessibleBusinesses,
            weekendDays,
            shiftOverride: shiftOverrideEnabled ? shiftOverride : null,
            overtimeEligible,
            overtimeBonusPercent,
            workType,
            jobStartDate: jobStartDate || null,
            jobEndDate: jobEndDate || null,
        }),
    }));

    return (
        <div className="grid gap-6 py-4 max-h-[70vh] overflow-y-auto px-2 -mr-2">
            {/** Role selector first so business access can depend on it */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="name">Full Name</Label>
                    <Input id="name" placeholder="Enter name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" placeholder="Enter email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" type="tel" placeholder="e.g., 017XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="designation">Staff Role (Designation)</Label>
                    <Input id="designation" placeholder="e.g. Senior Sales Executive" value={designation} onChange={(e) => setDesignation(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="work-type">Work Type</Label>
                    <Select value={workType} onValueChange={(v: 'Office' | 'Remote') => setWorkType(v)}>
                        <SelectTrigger id="work-type">
                            <SelectValue placeholder="Select work type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Office">Office</SelectItem>
                            <SelectItem value="Remote">Remote</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {/* Job Start Date: hidden if already set (set-once) */}
                {!staffMember?.jobStartDate && (
                    <div className="space-y-2">
                        <Label htmlFor="job-start-date">Job Start Date</Label>
                        <Input id="job-start-date" type="date" value={jobStartDate} onChange={(e) => setJobStartDate(e.target.value)} />
                    </div>
                )}
                {/* Job End Date: always visible */}
                <div className="space-y-2">
                    <Label htmlFor="job-end-date">Job End Date</Label>
                    <Input id="job-end-date" type="date" value={jobEndDate} onChange={(e) => setJobEndDate(e.target.value)} />
                    <p className="text-xs text-muted-foreground">Leave empty for active staff. Set to mark end of employment.</p>
                </div>
            </div>

            <Card>
                <CardHeader className="p-4 flex flex-row items-center gap-4">
                    <KeyRound className="w-6 h-6 text-muted-foreground" />
                    <div>
                        <CardTitle className="text-base">Role & Permissions</CardTitle>
                        <CardDescription className="text-xs">Define what this staff member can see and do.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-4 grid gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="role">Role</Label>
                        <Select value={role} onValueChange={(value: StaffRole) => setRole(value)}>
                            <SelectTrigger id="role">
                                <SelectValue placeholder="Select a role" />
                            </SelectTrigger>
                            <SelectContent>
                                {staffRoles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    {role === 'Custom' && (
                        <div className="space-y-4">
                            <Accordion type="multiple" className="w-full">
                                {permissionModules.map(module => (
                                    <AccordionItem value={module} key={module}>
                                        <AccordionTrigger className="capitalize">{(module as string).replace(/([A-Z])/g, ' $1')}</AccordionTrigger>
                                        <AccordionContent>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-2">
                                                {permissionActions.map(action => (
                                                    <div key={action} className="flex items-center space-x-2">
                                                        <Checkbox
                                                            id={`${module}-${action}`}
                                                            checked={normalizePermission((permissions as any)[module])[action]}
                                                            onCheckedChange={(checked) => handlePermissionChange(module, action, !!checked)}
                                                        />
                                                        <label
                                                            htmlFor={`${module}-${action}`}
                                                            className="text-sm font-medium leading-none capitalize"
                                                        >
                                                            {action}
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                ))}
                            </Accordion>
                            <div className="space-y-3 border-t pt-4">
                                <Label className="text-sm font-semibold">Page Access</Label>
                                <p className="text-xs text-muted-foreground">
                                    Select which dashboard pages this custom role can open. Data permissions are separate.
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {PAGE_ACCESS_LIST.map((item) => (
                                        <div key={item.key} className="flex items-start gap-2 rounded-lg border p-3">
                                            <Checkbox
                                                id={`page-${item.key}`}
                                                checked={Boolean(pageAccess[item.key])}
                                                onCheckedChange={(checked) => handlePageAccessChange(item.key, !!checked)}
                                            />
                                            <div>
                                                <Label htmlFor={`page-${item.key}`} className="text-sm font-medium">
                                                    {item.label}
                                                </Label>
                                                <p className="text-xs text-muted-foreground">{item.routes}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="p-4 flex flex-row items-center gap-4">
                    <ShieldCheck className="w-6 h-6 text-muted-foreground" />
                    <div>
                        <CardTitle className="text-base">Business Access</CardTitle>
                        <CardDescription className="text-xs">
                            {isAdminRole
                                ? 'Admins automatically get access to all businesses.'
                                : 'Select which business entities this staff can access.'}
                        </CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-4">
                    {businesses.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No businesses available to assign.</p>
                    ) : (
                        <div className="grid grid-cols-2 gap-4">
                            {businesses.map(business => (
                                <div key={business.id} className="flex items-center space-x-2">
                                    <Checkbox
                                        id={`biz-${business.id}`}
                                        checked={accessibleBusinesses.includes(business.id)}
                                        onCheckedChange={(checked) => handleBusinessAccessChange(business.id, !!checked)}
                                        disabled={isAdminRole}
                                    />
                                    <label htmlFor={`biz-${business.id}`} className="text-sm font-medium leading-none">
                                        {business.name}
                                    </label>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="p-4 flex flex-row items-center gap-4">
                    <User className="w-6 h-6 text-muted-foreground" />
                    <div>
                        <CardTitle className="text-base">Attendance Settings</CardTitle>
                        <CardDescription className="text-xs">Override the global weekend settings for this staff member.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                    <div className="flex items-center space-x-2">
                        <Checkbox 
                            id="use-global-weekend" 
                            checked={weekendDays === null} 
                            onCheckedChange={(checked) => {
                                if (checked) setWeekendDays(null);
                                else setWeekendDays([]);
                            }} 
                        />
                        <Label htmlFor="use-global-weekend" className="font-semibold cursor-pointer">Use Global Default Weekends</Label>
                    </div>
                    {weekendDays !== null && (
                        <div className="space-y-3 pt-2">
                            <Label>Custom Weekend Days</Label>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                {[
                                    { label: 'Sunday', value: 0 },
                                    { label: 'Monday', value: 1 },
                                    { label: 'Tuesday', value: 2 },
                                    { label: 'Wednesday', value: 3 },
                                    { label: 'Thursday', value: 4 },
                                    { label: 'Friday', value: 5 },
                                    { label: 'Saturday', value: 6 },
                                ].map((day) => {
                                    const checked = weekendDays.includes(day.value);
                                    return (
                                        <label key={day.value} className="flex items-center gap-2 text-sm">
                                            <Checkbox
                                                checked={checked}
                                                onCheckedChange={(checkedValue) => {
                                                    const isChecked = checkedValue === true;
                                                    setWeekendDays((prev) => {
                                                        const current = prev || [];
                                                        if (isChecked) return Array.from(new Set([...current, day.value])).sort();
                                                        return current.filter((d) => d !== day.value);
                                                    });
                                                }}
                                            />
                                            {day.label}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="p-4 py-3 flex flex-row items-center gap-4 bg-muted/20 border-b">
                    <Clock className="w-5 h-5 text-muted-foreground" />
                    <div>
                        <CardTitle className="text-base">Shift Override (Optional)</CardTitle>
                        <CardDescription className="text-sm">Set custom working hours to override global or role-based settings.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-4 space-y-4">
                    <div className="flex items-center space-x-2">
                        <Checkbox 
                            id="use-shift-override" 
                            checked={shiftOverrideEnabled} 
                            onCheckedChange={(checked) => setShiftOverrideEnabled(!!checked)} 
                        />
                        <Label htmlFor="use-shift-override" className="font-semibold cursor-pointer">Enable Custom Shift Override</Label>
                    </div>
                    {shiftOverrideEnabled && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                            <div className="space-y-2">
                                <Label>Start Time</Label>
                                <Input type="time" value={shiftOverride.startTime} onChange={(e) => setShiftOverride(s => ({ ...s, startTime: e.target.value }))} />
                            </div>
                            <div className="space-y-2">
                                <Label>End Time</Label>
                                <Input type="time" value={shiftOverride.endTime} onChange={(e) => setShiftOverride(s => ({ ...s, endTime: e.target.value }))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Late Grace (minutes)</Label>
                                <Input type="number" min={0} value={shiftOverride.lateGraceMinutes} onChange={(e) => setShiftOverride(s => ({ ...s, lateGraceMinutes: parseInt(e.target.value) || 0 }))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Early Leave Grace (minutes)</Label>
                                <Input type="number" min={0} value={shiftOverride.earlyLeaveGraceMinutes} onChange={(e) => setShiftOverride(s => ({ ...s, earlyLeaveGraceMinutes: parseInt(e.target.value) || 0 }))} />
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="p-4 flex flex-row items-center gap-4">
                    <DollarSign className="w-6 h-6 text-muted-foreground" />
                    <div>
                        <CardTitle className="text-base">Payment Details</CardTitle>
                        <CardDescription className="text-xs">Configure how this staff member is paid.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-4 grid gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="payment-type">Payment Type</Label>
                        <Select value={paymentType} onValueChange={(value: PaymentType) => setPaymentType(value)}>
                            <SelectTrigger id="payment-type">
                                <SelectValue placeholder="Select a payment type" />
                            </SelectTrigger>
                            <SelectContent>
                                {paymentTypes.map(type => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    {(paymentType === 'Salary' || paymentType === 'Both') && (
                        <div className="space-y-4 pt-4 border-t">
                            <Label className="font-semibold">Salary</Label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="salary-amount">Amount</Label>
                                    <Input id="salary-amount" type="number" placeholder="e.g., 25000" value={salaryAmount ?? ''} onChange={(e) => setSalaryAmount(e.target.value ? Number(e.target.value) : undefined)} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="salary-frequency">Frequency</Label>
                                    <Select value={salaryFrequency} onValueChange={(v: SalaryFrequency) => setSalaryFrequency(v)}>
                                        <SelectTrigger id="salary-frequency">
                                            <SelectValue placeholder="Select frequency" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Monthly">Monthly</SelectItem>
                                            <SelectItem value="Weekly">Weekly</SelectItem>
                                            <SelectItem value="Daily">Daily</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                    )}

                    {(paymentType === 'Commission' || paymentType === 'Both') && (
                        <div className="space-y-4 pt-4 border-t">
                            <div className="flex items-center space-x-2">
                                <Checkbox id="enable-target" checked={targetEnabled} onCheckedChange={(checked) => setTargetEnabled(!!checked)} />
                                <Label htmlFor="enable-target" className="font-semibold">Enable Commission Target</Label>
                            </div>
                            {targetEnabled && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="target-period">Target Period</Label>
                                        <Select value={targetPeriod} onValueChange={(v: CommissionPeriod) => setTargetPeriod(v)}>
                                            <SelectTrigger id="target-period"><SelectValue placeholder="Select period" /></SelectTrigger>
                                            <SelectContent><SelectItem value="Daily">Daily</SelectItem><SelectItem value="Weekly">Weekly</SelectItem><SelectItem value="Monthly">Monthly</SelectItem></SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="target-count">Target Order Count</Label>
                                        <Input id="target-count" type="number" placeholder="e.g., 100" value={targetCount ?? ''} onChange={(e) => setTargetCount(e.target.value ? Number(e.target.value) : undefined)} />
                                    </div>
                                </div>
                            )}
                            <Separator />
                            <Label className="font-semibold">Commission Rates</Label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {role === 'Packing Assistant' ? (
                                    <div className="space-y-2">
                                        <Label htmlFor="commission-pack">On Order Packed</Label>
                                        <Input id="commission-pack" type="number" placeholder="e.g., 20" value={commissionPack ?? ''} onChange={(e) => setCommissionPack(e.target.value ? Number(e.target.value) : undefined)} />
                                    </div>
                                ) : (
                                    <>
                                        <div className="space-y-2">
                                            <Label htmlFor="commission-create">On Order Create</Label>
                                            <Input id="commission-create" type="number" placeholder="e.g., 50" value={commissionCreate ?? ''} onChange={(e) => setCommissionCreate(e.target.value ? Number(e.target.value) : undefined)} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="commission-confirm">On Order Confirm</Label>
                                            <Input id="commission-confirm" type="number" placeholder="e.g., 100" value={commissionConfirm ?? ''} onChange={(e) => setCommissionConfirm(e.target.value ? Number(e.target.value) : undefined)} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="commission-convert">On Order Convert (Incomplete)</Label>
                                            <Input id="commission-convert" type="number" placeholder="e.g., 50" value={commissionConvert ?? ''} onChange={(e) => setCommissionConvert(e.target.value ? Number(e.target.value) : undefined)} />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="space-y-4 pt-4 border-t">
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <Label htmlFor="overtime-eligible" className="text-base font-semibold">Enable Overtime Bonus</Label>
                                <p className="text-xs text-muted-foreground italic">Allow per-minute overtime pay calculation for this staff.</p>
                            </div>
                            <Checkbox 
                                id="overtime-eligible" 
                                checked={overtimeEligible} 
                                onCheckedChange={(checked) => setOvertimeEligible(!!checked)} 
                            />
                        </div>

                        {overtimeEligible && (
                            <div className="grid grid-cols-1 gap-4 p-4 rounded-lg bg-orange-500/5 border border-orange-500/20">
                                <div className="space-y-2">
                                    <Label htmlFor="overtime-bonus" className="text-sm font-medium">Extra Bonus Percentage (%)</Label>
                                    <div className="flex items-center gap-3">
                                        <Input 
                                            id="overtime-bonus" 
                                            type="number" 
                                            min={0}
                                            placeholder="e.g., 20" 
                                            value={overtimeBonusPercent} 
                                            onChange={(e) => setOvertimeBonusPercent(Number(e.target.value) || 0)}
                                            className="w-24 font-bold text-orange-600"
                                        />
                                        <span className="text-xs text-muted-foreground">
                                            Adds an extra % on top of the calculated base overtime rate.
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {!isEdit && (
                <div className="items-top flex space-x-3 pt-4">
                    <Checkbox id="send-invite" defaultChecked />
                    <div className="grid gap-1.5 leading-none">
                        <label
                            htmlFor="send-invite"
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                            Send Invitation Email
                        </label>
                        <p className="text-sm text-muted-foreground">
                            An email will be sent to the user to set their password.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
});
StaffForm.displayName = 'StaffForm';

export default function StaffPage() {
    const [staffItems, setStaffItems] = useState<StaffMember[]>([]);
    const [totalStaff, setTotalStaff] = useState(0);
    const [summaryTotals, setSummaryTotals] = useState<{ totalDue: number; totalEarned: number; totalPaid: number } | null>(null);
    const [allBusinesses, setAllBusinesses] = useState<Business[]>([]);
    const [uniqueDesignations, setUniqueDesignations] = useState<string[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [isLoading, setIsLoading] = React.useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
    const [isClient, setIsClient] = useState(false);
    const addFormRef = useRef<StaffFormHandle>(null);
    const editFormRef = useRef<StaffFormHandle>(null);

    const [searchTerm, setSearchTerm] = useState('');
    const { handleError } = useAuthErrorHandler();
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [designationFilter, setDesignationFilter] = useState('all');
    const [workTypeFilter, setWorkTypeFilter] = useState('all');
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [menuResetKey, setMenuResetKey] = useState(0);

    const { data: generalSettings } = useSWR('/api/settings/general', (url: string) =>
        fetch(url).then((res) => res.json()).catch(() => null)
    );
    const badgeRules = React.useMemo(
        () => normalizeBadgeRules(generalSettings?.badgeRules, defaultBadgeRules),
        [generalSettings]
    );

    const { toast } = useToast();

    const [isRecalcDialogOpen, setIsRecalcDialogOpen] = useState(false);
    const [isRecalculating, setIsRecalculating] = useState(false);
    const [recalcDays, setRecalcDays] = useState(30);
    const [recalcProgress, setRecalcProgress] = useState<{ jobId: string; state: string; progress: any; result?: any } | null>(null);

    const releaseFocus = () => {
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            (document.activeElement as HTMLElement | null)?.blur?.();
        } catch { }
    };

    const openAfterMenu = (fn: () => void) => {
        releaseFocus();
        window.setTimeout(() => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => requestAnimationFrame(fn));
            } else {
                fn();
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

    const loadStaff = async () => {
        try {
            setIsLoading(true);
            setLoadError(null);
            const staffData = await getStaff({
                page: currentPage,
                pageSize: ITEMS_PER_PAGE,
                search: debouncedSearch,
                role: roleFilter,
                designation: designationFilter,
                includeInvites: true,
                from: dateRange?.from?.toISOString(),
                to: dateRange?.to?.toISOString(),
                workType: workTypeFilter !== 'all' ? workTypeFilter : undefined,
            });
            setStaffItems(staffData.items || []);
            setTotalStaff(staffData.total || 0);
            setSummaryTotals(staffData.summary || null);
            setUniqueDesignations(staffData.uniqueDesignations || []);
        } catch (error) {
            console.error("Failed to load staff data:", error);
            if (await handleError(error)) return;
            setLoadError('Failed to load staff data. Please try again.');
            setStaffItems([]);
            setTotalStaff(0);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        setIsClient(true);
    }, []);

    useEffect(() => {
        const loadBusinesses = async () => {
            try {
                const businessRes = await fetch('/api/settings/business', { cache: 'no-store' });
                if (businessRes.ok) {
                    const businessData: Business[] = await businessRes.json();
                    setAllBusinesses(businessData || []);
                } else {
                    const errText = await businessRes.text();
                    console.error('[STAFF_PAGE] failed to load businesses', businessRes.status, errText);
                    if (businessRes.status === 401 || businessRes.status === 403) {
                        await handleError(new Error('Auth error'));
                        return;
                    }
                    setAllBusinesses([]);
                }
            } catch (error) {
                console.error('[STAFF_PAGE] failed to load businesses', error);
                setAllBusinesses([]);
            }
        };
        loadBusinesses();
    }, []);

    useEffect(() => {
        const handle = window.setTimeout(() => {
            setDebouncedSearch(searchTerm.trim());
        }, 300);
        return () => window.clearTimeout(handle);
    }, [searchTerm]);

    useEffect(() => {
        loadStaff();
    }, [currentPage, debouncedSearch, roleFilter, designationFilter, workTypeFilter, dateRange]);

    useEffect(() => {
        if (currentPage !== 1) {
            setCurrentPage(1);
        }
    }, [debouncedSearch, roleFilter, designationFilter, workTypeFilter, dateRange]);

    const handleEditClick = (member: StaffMember) => {
        openAfterMenu(() => {
            setSelectedStaff(member);
            setIsEditDialogOpen(true);
        });
    };

    const closeAddDialog = () => {
        setIsAddDialogOpen(false);
        resetMenuFocus();
    };

    const closeEditDialog = () => {
        setIsEditDialogOpen(false);
        setSelectedStaff(null);
        resetMenuFocus();
    };

    const handleAddOpenChange = (open: boolean) => {
        if (!open) {
            closeAddDialog();
        } else {
            setIsAddDialogOpen(true);
        }
    };

    const handleEditOpenChange = (open: boolean) => {
        if (!open) {
            closeEditDialog();
        } else {
            setIsEditDialogOpen(true);
        }
    };

    const handleAddClick = () => {
        setSelectedStaff(null);
        setIsAddDialogOpen(true);
    };

    const handleCreateStaff = async () => {
        const payload = addFormRef.current?.getPayload();
        if (!payload || !payload.name || !payload.email || !payload.phone || !payload.role || !payload.paymentType) {
            alert('Name, email, phone, role, and payment type are required.');
            return;
        }
        try {
            setIsSaving(true);
            const res = await fetch('/api/staff/invite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const raw = await res.text();
                let msg = raw || 'Failed to create staff';
                try {
                    const parsed = JSON.parse(raw);
                    msg = parsed?.message || msg;
                } catch {
                    // keep raw text fallback
                }
                throw new Error(msg);
            }
            await loadStaff();
            closeAddDialog();
        } catch (error) {
            console.error('Failed to create staff', error);
            if (await handleError(error)) return;
            alert(error instanceof Error ? error.message : 'Failed to create staff');
        } finally {
            setIsSaving(false);
        }
    };

    const handleUpdateStaff = async () => {
        if (!selectedStaff) return;
        const payload = editFormRef.current?.getPayload();
        if (!payload) return;
        try {
            setIsSaving(true);
            const res = await fetch(`/api/staff/${selectedStaff.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const msg = await res.text();
                throw new Error(msg);
            }
            await loadStaff();
            closeEditDialog();
        } catch (error) {
            console.error('Failed to update staff', error);
            if (await handleError(error)) return;
            alert('Failed to update staff');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeactivateStaff = async (id: string) => {
        releaseFocus();
        if (!confirm('Deactivate (delete) this staff?')) return;
        try {
            setIsSaving(true);
            const res = await fetch(`/api/staff/${id}`, { method: 'DELETE' });
            if (!res.ok && res.status !== 204) {
                const msg = await res.text();
                throw new Error(msg);
            }
            await loadStaff();
        } catch (error) {
            console.error('Failed to deactivate staff', error);
            if (await handleError(error)) return;
            alert('Failed to deactivate staff');
        } finally {
            setIsSaving(false);
            resetMenuFocus();
        }
    };

    const handleCancelInvite = async (rowId: string) => {
        const inviteId = rowId.startsWith('invite_') ? rowId.slice('invite_'.length) : rowId;
        if (!inviteId) return;
        releaseFocus();
        if (!confirm('Cancel this pending invitation?')) return;
        try {
            setIsSaving(true);
            const res = await fetch(`/api/staff/invite/${inviteId}`, { method: 'DELETE' });
            if (!res.ok) {
                const msg = await res.text();
                throw new Error(msg || 'Failed to cancel invitation');
            }
            await loadStaff();
        } catch (error) {
            console.error('Failed to cancel invitation', error);
            if (await handleError(error)) return;
            alert('Failed to cancel invitation');
        } finally {
            setIsSaving(false);
            resetMenuFocus();
        }
    };

    const handleRecalculate = async () => {
        setIsRecalculating(true);
        setRecalcProgress(null);
        try {
            const res = await fetch('/api/staff/recalculate-commissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ days: recalcDays }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || data.error || 'Recalculation failed');

            const jobId = data.jobId;
            setRecalcProgress({ jobId, state: 'queued', progress: 0 });

            const poll = async () => {
                try {
                    const statusRes = await fetch(`/api/staff/recalculate-commissions?jobId=${jobId}`);
                    if (!statusRes.ok) {
                        const msg = await statusRes.text();
                        throw new Error(msg || 'Failed to check job status');
                    }
                    const status = await statusRes.json();

                    if (status.state === 'completed') {
                        setIsRecalcDialogOpen(false);
                        const r = status.result || { ordersProcessed: 0, staffSalaryProcessed: 0, errors: [] };
                        toast({
                            title: 'Recalculation Complete',
                            description: `${r.ordersProcessed} orders, ${r.staffSalaryProcessed} salary entries. ${r.errors?.length || 0} errors.`,
                        });
                        if (r.errors?.length) {
                            console.warn('[RECALCULATE_ERRORS]', r.errors);
                        }
                        setIsRecalculating(false);
                        setRecalcProgress(null);
                        return;
                    }

                    if (status.state === 'failed') {
                        setIsRecalcDialogOpen(false);
                        toast({ variant: 'destructive', title: 'Recalculation Failed', description: status.failedReason || 'Job failed' });
                        setIsRecalculating(false);
                        setRecalcProgress(null);
                        return;
                    }

                    setRecalcProgress({ jobId, state: status.state, progress: status.progress, result: status.result });
                    setTimeout(poll, 3000);
                } catch (err: any) {
                    setIsRecalcDialogOpen(false);
                    setIsRecalculating(false);
                    setRecalcProgress(null);
                    toast({ variant: 'destructive', title: 'Polling Failed', description: err.message });
                }
            };

            setTimeout(poll, 2000);
        } catch (err: any) {
            setIsRecalcDialogOpen(false);
            setIsRecalculating(false);
            setRecalcProgress(null);
            toast({ variant: 'destructive', title: 'Recalculation Failed', description: err.message });
        }
    };

    const handleTerminateStaff = async (id: string) => {
        releaseFocus();
        if (!confirm('Are you sure you want to fire this staff member? They will lose all access immediately.')) return;
        try {
            setIsSaving(true);
            const res = await fetch(`/api/staff/${id}/terminate`, { method: 'POST' });
            if (!res.ok) {
                const msg = await res.text();
                throw new Error(msg || 'Failed to terminate staff');
            }
            await loadStaff();
            toast({ title: 'Staff terminated', description: 'Access has been revoked.' });
        } catch (error) {
            console.error('Failed to terminate staff', error);
            if (await handleError(error)) return;
            toast({ title: 'Error', description: 'Failed to terminate staff', variant: 'destructive' });
        } finally {
            setIsSaving(false);
            resetMenuFocus();
        }
    };

    const handleReinstateStaff = async (id: string) => {
        releaseFocus();
        if (!confirm('Reinstate this staff member? They will regain access to the dashboard.')) return;
        try {
            setIsSaving(true);
            const res = await fetch(`/api/staff/${id}/reinstate`, { method: 'POST' });
            if (!res.ok) {
                const msg = await res.text();
                throw new Error(msg || 'Failed to reinstate staff');
            }
            await loadStaff();
            toast({ title: 'Staff reinstated', description: 'Dashboard access restored.' });
        } catch (error) {
            console.error('Failed to reinstate staff', error);
            if (await handleError(error)) return;
            toast({ title: 'Error', description: 'Failed to reinstate staff', variant: 'destructive' });
        } finally {
            setIsSaving(false);
            resetMenuFocus();
        }
    };

    const totals = React.useMemo(() => {
        if (summaryTotals) {
            return {
                totalDue: summaryTotals.totalDue,
                totalEarned: summaryTotals.totalEarned,
            };
        }
        return staffItems.reduce((acc, member) => {
            acc.totalDue += member.financials.dueAmount;
            acc.totalEarned += member.financials.totalEarned;
            return acc;
        }, { totalDue: 0, totalEarned: 0 });
    }, [summaryTotals, staffItems]);

    const totalPages = Math.max(1, Math.ceil(totalStaff / ITEMS_PER_PAGE));

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, roleFilter, designationFilter, workTypeFilter]);

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1">
                    <h1 className="font-headline text-2xl font-bold">Staff Management</h1>
                    <p className="text-muted-foreground hidden sm:block">
                        Manage staff access, roles, and payments.
                        {dateRange?.from && (
                            <span className="ml-1 text-blue-600 font-medium">
                                (Filtering from {format(dateRange.from, "MMM d, y")}{dateRange.to ? ` to ${format(dateRange.to, "MMM d, y")}` : ''})
                            </span>
                        )}
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-2">
                    <DateRangePicker
                        date={dateRange}
                        onDateChange={setDateRange}
                        placeholder="Filter by date"
                        className="w-full sm:w-auto"
                    />
                    <Dialog open={isAddDialogOpen} onOpenChange={handleAddOpenChange}>
                        <DialogTrigger asChild>
                            <Button size="sm" onClick={handleAddClick} className="w-full sm:w-auto">
                                <PlusCircle className="h-4 w-4 mr-2" />
                                Invite Staff
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-3xl">
                            <DialogHeader>
                                <DialogTitle>Invite New Staff</DialogTitle>
                                <DialogDescription>
                                    Fill in the details to add a new staff member to your team.
                                </DialogDescription>
                            </DialogHeader>
                            <StaffForm key={isAddDialogOpen ? "add-open" : "add-closed"} ref={addFormRef} businesses={allBusinesses} />
                            <DialogFooter>
                                <Button variant="outline" onClick={closeAddDialog}>Cancel</Button>
                                <Button onClick={handleCreateStaff} disabled={isSaving}>
                                    {isSaving ? 'Saving...' : 'Send Invitation'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Dialog open={isRecalcDialogOpen} onOpenChange={(open) => { if (!isRecalculating) setIsRecalcDialogOpen(open); }}>
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm" className="w-full sm:w-auto">
                                <RefreshCw className="h-4 w-4 mr-2" />
                                Recalculate Earnings
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>Recalculate Earnings</DialogTitle>
                                <DialogDescription>
                                    Rebuilds commission (Created, Confirmed, Packed) + salary + weekend/overtime bonus
                                    records for the specified period. Safe and idempotent.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="px-6 pb-2 space-y-3">
                                <div>
                                    <Label>Recalculate last (days)</Label>
                                    <Input type="number" min={1} value={recalcDays}
                                        onChange={(e) => setRecalcDays(Math.max(1, Number(e.target.value) || 60))}
                                        disabled={isRecalculating} />
                                </div>
                                {isRecalculating && recalcProgress && (
                                    <div className="bg-muted/30 rounded-lg p-3 text-sm space-y-2">
                                        <div className="flex items-center gap-2">
                                            <RefreshCw className="h-4 w-4 animate-spin" />
                                            <span className="font-medium capitalize">{recalcProgress.state}</span>
                                        </div>
                                        {typeof recalcProgress.progress === 'number' && (
                                            <div className="w-full bg-muted rounded-full h-2">
                                                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${recalcProgress.progress}%` }} />
                                            </div>
                                        )}
                                        <p className="text-xs text-muted-foreground">Job ID: {recalcProgress.jobId}</p>
                                    </div>
                                )}
                            </div>
                            <DialogFooter className="gap-2">
                                <Button variant="outline" onClick={() => { if (!isRecalculating) setIsRecalcDialogOpen(false); }} disabled={isRecalculating}>
                                    Cancel
                                </Button>
                                <Button onClick={handleRecalculate} disabled={isRecalculating}>
                                    {isRecalculating ? (
                                        <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Processing...</>
                                    ) : (
                                        <><RefreshCw className="h-4 w-4 mr-2" /> Run Recalculation</>
                                    )}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Due to Staff</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className={cn("text-xl md:text-2xl font-bold", totals.totalDue > 0 && "text-destructive")}>
                            Tk {totals.totalDue.toLocaleString()}
                        </div>
                        <p className="text-xs text-muted-foreground">Total outstanding amount to be paid</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Earned by Staff</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-xl md:text-2xl font-bold">Tk {totals.totalEarned.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground">Total income generated by all staff</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <Input
                            placeholder="Search by name, email, or role..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full sm:max-w-sm"
                        />
                        <Select value={roleFilter} onValueChange={setRoleFilter}>
                            <SelectTrigger className="w-full sm:w-[180px]">
                                <SelectValue placeholder="Filter by role" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Roles</SelectItem>
                                {staffRoles.map(role => (
                                    <SelectItem key={role} value={role}>{role}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={designationFilter} onValueChange={setDesignationFilter}>
                            <SelectTrigger className="w-full sm:w-[200px]">
                                <SelectValue placeholder="Filter by designation" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Designations</SelectItem>
                                {uniqueDesignations.map(des => (
                                    <SelectItem key={des} value={des}>{des}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={workTypeFilter} onValueChange={setWorkTypeFilter}>
                            <SelectTrigger className="w-full sm:w-[150px]">
                                <SelectValue placeholder="Work Type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Work Types</SelectItem>
                                <SelectItem value="Office">Office</SelectItem>
                                <SelectItem value="Remote">Remote</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent className="pt-0">
                    {isLoading ? (
                        <div className="h-48 flex items-center justify-center text-muted-foreground">Loading staff...</div>
                    ) : loadError ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-8 text-muted-foreground">
                            <p>{loadError}</p>
                            <Button variant="outline" onClick={loadStaff}>Retry</Button>
                        </div>
                    ) : (
                        <>
                            {/* Table for larger screens */}
                            <div className="hidden sm:block overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Name</TableHead>
                                            <TableHead className="hidden md:table-cell">Role / Designation</TableHead>
                                            <TableHead>Business Access</TableHead>
                                            <TableHead className="hidden lg:table-cell">Last Login</TableHead>
                                            <TableHead className="text-right">Total Due</TableHead>
                                            <TableHead>
                                                <span className="sr-only">Actions</span>
                                            </TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {staffItems.map((member) => {
                                            const isInvite = member.id?.startsWith('invite_');
                                            const createdBadge = getBadgeForValue(
                                                badgeRules.staffOrdersCreated,
                                                member.performance?.ordersCreated || 0
                                            );
                                            const confirmedBadge = getBadgeForValue(
                                                badgeRules.staffOrdersConfirmed,
                                                member.performance?.ordersConfirmed || 0
                                            );
                                            const deliveredCount = member.performance?.statusBreakdown?.['Delivered'] || 0;
                                            const returnedCount = (member.performance?.statusBreakdown?.['Returned'] || 0) + (member.performance?.statusBreakdown?.['Paid_Return'] || 0);
                                            const deliveryRate = getDeliverySuccessRate(deliveredCount, returnedCount);
                                            const deliveryBadge = getBadgeForValue(
                                                badgeRules.staffDeliverySuccess,
                                                deliveryRate
                                            );
                                            const staffBadges = [createdBadge, confirmedBadge, deliveryBadge].filter(Boolean);
                                            return (
                                                <TableRow key={member.id}>
                                                    <TableCell className="font-medium">
                                                        <div className="flex items-center gap-2">
                                                            <div className={cn("w-2 h-2 rounded-full", isInvite ? "bg-amber-400" : isClient && new Date().getTime() - new Date(member.lastLogin).getTime() < 86400000 ? "bg-green-500" : "bg-gray-400")}></div>
                                                            {member.avatarUrl ? (
                                                                <img src={member.avatarUrl} alt={member.name} className="h-8 w-8 rounded-full border object-cover" />
                                                            ) : (
                                                                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs uppercase">
                                                                    {member.name?.slice(0, 2) || 'NA'}
                                                                </div>
                                                            )}
                                                            {isInvite ? (
                                                                <span className="text-muted-foreground">
                                                                    {member.name} <Badge variant="outline" className="ml-1">Invited</Badge>
                                                                </span>
                                                            ) : (
                                                                <div className="flex flex-col gap-1">
                                                                    <Link href={`/dashboard/staff/${member.id}`} className="hover:underline">
                                                                        {member.name}
                                                                    </Link>
                                                                    {staffBadges.length > 0 && (
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {staffBadges.map((badge) => (
                                                                                badge ? (
                                                                                    <Badge key={badge.id} variant="outline" className={badge.color}>
                                                                                        {badge.label}
                                                                                    </Badge>
                                                                                ) : null
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="hidden md:table-cell">
                                                        <div className="flex flex-col gap-1 items-start">
                                                            <Badge variant="outline">{member.role}{isInvite ? ' (Invited)' : ''}</Badge>
                                                            {member.designation && <span className="text-xs text-muted-foreground">{member.designation}</span>}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-wrap gap-1">
                                                            {member.accessibleBusinessIds?.map(id => {
                                                                const business = allBusinesses.find(b => b.id === id);
                                                                return business ? <Badge key={id} variant="secondary">{business.name}</Badge> : null;
                                                            })}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="hidden lg:table-cell">
                                                        {isClient ? formatDistanceToNow(new Date(member.lastLogin), { addSuffix: true }) : ''}
                                                    </TableCell>
                                                    <TableCell className={cn("text-right font-mono", member.financials.dueAmount > 0 ? "text-destructive" : "")}>
                                                        Tk {member.financials.dueAmount.toFixed(2)}
                                                    </TableCell>
                                                    <TableCell>
                                                        <DropdownMenu key={`${member.id}-${menuResetKey}`}>
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
                                                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                                {isInvite ? (
                                                                    <DropdownMenuItem
                                                                        className="text-red-600"
                                                                        onSelect={() => openAfterMenu(() => handleCancelInvite(member.id))}
                                                                    >
                                                                        Cancel Invitation
                                                                    </DropdownMenuItem>
                                                                ) : (
                                                                    <>
                                                                        <DropdownMenuItem asChild>
                                                                            <Link href={`/dashboard/staff/${member.id}`}>View Details</Link>
                                                                        </DropdownMenuItem>
                                                                        <DropdownMenuItem onSelect={() => handleEditClick(member)}>Edit Staff</DropdownMenuItem>
                                                                        <DropdownMenuItem onSelect={() => openAfterMenu(() => handleReinstateStaff(member.id))}>Reinstate Staff</DropdownMenuItem>
                                                                        <DropdownMenuItem className="text-red-600" onSelect={() => openAfterMenu(() => handleTerminateStaff(member.id))}>Fire Staff</DropdownMenuItem>
                                                                    </>
                                                                )}
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Card list for smaller screens */}
                            <div className="sm:hidden space-y-4">
                                {staffItems.map((member) => {
                                    const isInvite = member.id?.startsWith('invite_');
                                    const createdBadge = getBadgeForValue(
                                        badgeRules.staffOrdersCreated,
                                        member.performance?.ordersCreated || 0
                                    );
                                    const confirmedBadge = getBadgeForValue(
                                        badgeRules.staffOrdersConfirmed,
                                        member.performance?.ordersConfirmed || 0
                                    );
                                    const deliveredCount = member.performance?.statusBreakdown?.['Delivered'] || 0;
                                    const returnedCount = (member.performance?.statusBreakdown?.['Returned'] || 0) + (member.performance?.statusBreakdown?.['Paid_Return'] || 0);
                                    const deliveryRate = getDeliverySuccessRate(deliveredCount, returnedCount);
                                    const deliveryBadge = getBadgeForValue(
                                        badgeRules.staffDeliverySuccess,
                                        deliveryRate
                                    );
                                    const staffBadges = [createdBadge, confirmedBadge, deliveryBadge].filter(Boolean);
                                    return (
                                        <Card key={member.id} className="overflow-hidden">
                                            <CardContent className="p-4 space-y-3">
                                                <div className="flex justify-between items-start">
                                                    <div className="flex items-center gap-2">
                                                        <div className={cn("w-2 h-2 rounded-full", isInvite ? "bg-amber-400" : isClient && new Date().getTime() - new Date(member.lastLogin).getTime() < 86400000 ? "bg-green-500" : "bg-gray-400")}></div>
                                                        {member.avatarUrl ? (
                                                            <img src={member.avatarUrl} alt={member.name} className="h-9 w-9 rounded-full border object-cover" />
                                                        ) : (
                                                            <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-sm uppercase">
                                                                {member.name?.slice(0, 2) || 'NA'}
                                                            </div>
                                                        )}
                                                        <div className="flex flex-col gap-1">
                                                            {isInvite ? (
                                                                <span className="font-semibold text-muted-foreground">
                                                                    {member.name} <Badge variant="outline" className="ml-1">Invited</Badge>
                                                                </span>
                                                            ) : (
                                                                <Link href={`/dashboard/staff/${member.id}`} className="font-semibold hover:underline block truncate max-w-[170px]">
                                                                    {member.name}
                                                                </Link>
                                                            )}
                                                            {!isInvite && staffBadges.length > 0 && (
                                                                <div className="flex flex-wrap gap-1">
                                                                    {staffBadges.map((badge) => (
                                                                        badge ? (
                                                                            <Badge key={badge.id} variant="outline" className={badge.color}>
                                                                                {badge.label}
                                                                            </Badge>
                                                                        ) : null
                                                                    ))}
                                                                </div>
                                                            )}
                                                            <p className="text-sm text-muted-foreground truncate max-w-[170px]">{member.email}</p>
                                                        </div>
                                                    </div>
                                                    <DropdownMenu key={`${member.id}-card-${menuResetKey}`}>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button aria-haspopup="true" size="icon" variant="ghost">
                                                                <MoreHorizontal className="h-4 w-4" />
                                                                <span className="sr-only">Toggle menu</span>
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                            {isInvite ? (
                                                                <DropdownMenuItem
                                                                    className="text-red-600"
                                                                    onSelect={() => openAfterMenu(() => handleCancelInvite(member.id))}
                                                                >
                                                                    Cancel Invitation
                                                                </DropdownMenuItem>
                                                            ) : (
                                                                <>
                                                                    <DropdownMenuItem asChild><Link href={`/dashboard/staff/${member.id}`}>View Details</Link></DropdownMenuItem>
                                                                    <DropdownMenuItem onSelect={() => handleEditClick(member)}>Edit Staff</DropdownMenuItem>
                                                                    <DropdownMenuItem onSelect={() => openAfterMenu(() => handleReinstateStaff(member.id))}>Reinstate Staff</DropdownMenuItem>
                                                                    <DropdownMenuItem className="text-red-600" onSelect={() => openAfterMenu(() => handleTerminateStaff(member.id))}>Fire Staff</DropdownMenuItem>
                                                                </>
                                                            )}
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                                <Separator />
                                                <div className="flex justify-between items-end">
                                                    <div className="flex flex-col gap-1 items-start">
                                                        <Badge variant="outline">{member.role}{isInvite ? ' (Invited)' : ''}</Badge>
                                                        {member.designation && <span className="text-xs text-muted-foreground">{member.designation}</span>}
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-sm text-muted-foreground">Total Due</p>
                                                        <p className={cn("font-semibold font-mono", member.financials.dueAmount > 0 ? "text-destructive" : "")}>
                                                            Tk {member.financials.dueAmount.toFixed(2)}
                                                        </p>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    )
                                })}
                            </div>
                        </>
                    )}

                </CardContent>
                <CardFooter>
                    <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
                        <div>
                            Showing <strong>{totalStaff > 0 ? (currentPage - 1) * ITEMS_PER_PAGE + 1 : 0}-
                                {totalStaff > 0 ? Math.min(currentPage * ITEMS_PER_PAGE, totalStaff) : 0}
                            </strong> of <strong>{totalStaff}</strong> staff members
                        </div>
                        {totalPages > 1 && (
                            <Pagination>
                                <PaginationContent>
                                    <PaginationItem>
                                        <PaginationPrevious
                                            href="#"
                                            onClick={(e) => { e.preventDefault(); setCurrentPage(p => Math.max(1, p - 1)) }}
                                            className={currentPage === 1 ? 'pointer-events-none opacity-50' : ''}
                                        />
                                    </PaginationItem>
                                    <PaginationItem>
                                        <PaginationNext
                                            href="#"
                                            onClick={(e) => { e.preventDefault(); setCurrentPage(p => Math.min(totalPages, p + 1)) }}
                                            className={currentPage === totalPages ? 'pointer-events-none opacity-50' : ''}
                                        />
                                    </PaginationItem>
                                </PaginationContent>
                            </Pagination>
                        )}
                    </div>
                </CardFooter>
            </Card>

            <Dialog open={isEditDialogOpen} onOpenChange={handleEditOpenChange}>
                <DialogContent className="sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Edit Staff: {selectedStaff?.name}</DialogTitle>
                        <DialogDescription>
                            Update the details for this staff member.
                        </DialogDescription>
                    </DialogHeader>
                    <StaffForm key={isEditDialogOpen && selectedStaff ? `edit-${selectedStaff.id}` : "edit-closed"} ref={editFormRef} staffMember={selectedStaff} isEdit={true} businesses={allBusinesses} />
                    <DialogFooter>
                        <Button variant="outline" onClick={closeEditDialog}>Cancel</Button>
                        <Button onClick={handleUpdateStaff} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Changes'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
