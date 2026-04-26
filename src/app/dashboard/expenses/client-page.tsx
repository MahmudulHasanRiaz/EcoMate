'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
    getExpenses,
    createExpense,
    updateExpense,
    deleteExpense,
    getExpenseCategories,
} from '@/services/expenses';
import { getBusinesses } from '@/services/partners';
import { getChartOfAccounts } from '@/services/accounting';
import { getBranches } from '@/services/branches';
import { getCashDrawers } from '@/services/cash-drawers';
import {
    Expense,
    ExpenseCategory,
    Business,
    Account,
    Branch,
    OrderPlatform,
} from '@/types';
import { Button } from '@/components/ui/button';
import { PlusCircle, MoreHorizontal, Edit, Trash2, Printer, Loader2, Wallet, CheckCircle2, XCircle, Ban, ListFilter } from 'lucide-react';
import { useUser } from '@clerk/nextjs';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { format } from 'date-fns';
import { ExpenseForm, ExpenseFormValues } from './expense-form';
import { DateRange } from 'react-day-picker';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ExpenseCategoryCombobox } from '@/components/expenses/expense-category-combobox';

const isPaymentAccount = (account: Account) => {
    const name = account.name.toLowerCase();
    return name.includes('cash') || name.includes('bank') || name.includes('mobile');
};

export default function ExpensesClientPage() {
    const { toast } = useToast();
    const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
    const [allBusinesses, setAllBusinesses] = useState<Business[]>([]);
    const [allExpenseCategories, setAllExpenseCategories] = useState<ExpenseCategory[]>([]);
    const [allAccounts, setAllAccounts] = useState<Account[]>([]);
    const [allCashDrawers, setAllCashDrawers] = useState<any[]>([]);
    const [allBranches, setAllBranches] = useState<Branch[]>([]);

    // Pagination State
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [totalParsed, setTotalParsed] = useState<number | undefined>(undefined);

    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [categoryFilter, setCategoryFilter] = useState<string>("all");
    const [branchFilterMode, setBranchFilterMode] = useState<'single' | 'multi'>('single');
    const [branchFilter, setBranchFilter] = useState<string>("all");
    const [branchIdsFilter, setBranchIdsFilter] = useState<string[]>([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
    const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; expense: Expense | null }>({
        isOpen: false,
        expense: null,
    });
    const [isDeleting, setIsDeleting] = useState(false);
    const [rejectDialog, setRejectDialog] = useState<{ isOpen: boolean; expense: Expense | null }>({
        isOpen: false,
        expense: null,
    });
    const [rejectionNote, setRejectionNote] = useState("");
    const [isRejecting, setIsRejecting] = useState(false);
    const [menuResetKey, setMenuResetKey] = useState(0);
    const [isClient, setIsClient] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const { user } = useUser();
    const userRole = (user?.publicMetadata?.role as string | undefined)?.toLowerCase();
    const isAdmin = userRole === 'admin';
    const isManager = userRole === 'manager';
    const isFinance = userRole === 'financemanager';
    const currentStaffName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.primaryEmailAddress?.emailAddress || 'System';
    const currentStaffId = user?.publicMetadata?.staffId as string | undefined;

    const toggleSelectAll = () => {
        if (selectedIds.size === allExpenses.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(allExpenses.map(e => e.id)));
        }
    };

    const toggleSelectRow = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        setSelectedIds(next);
    };

    const handlePrintSelected = () => {
        const ids = Array.from(selectedIds).join(',');
        window.open(`/print/expenses?ids=${ids}`, '_blank');
    };

    const loadExpenses = useCallback(async (cursor?: string, isMore = false) => {
        if (isMore) setIsLoadingMore(true);
        else setIsLoading(true);

        try {
            const categoryId = categoryFilter !== 'all' ? categoryFilter : undefined;
            const branchId = branchFilterMode === 'single' && branchFilter !== 'all' ? branchFilter : undefined;
            const branchIds = branchFilterMode === 'multi' && branchIdsFilter.length > 0 ? branchIdsFilter : undefined;
            const from = dateRange?.from ? dateRange.from.toISOString() : undefined;
            const to = dateRange?.to ? dateRange.to.toISOString() : undefined;

            // Only request total on the first page load (when no cursor is present)
            const includeTotal = !cursor;

            const response = await getExpenses({
                categoryId,
                branchId,
                branchIds,
                from,
                to,
                cursor,
                pageSize: 20, // Reasonable batch size
                includeTotal
            });

            const data = (response as any) || {};
            const items = data.items || [];

            setAllExpenses(prev => {
                if (!isMore) return items;
                // De-duplicate just in case
                const existingIds = new Set(prev.map(p => p.id));
                const newItems = items.filter((i: Expense) => !existingIds.has(i.id));
                return [...prev, ...newItems];
            });

            setNextCursor(data.nextCursor);
            setHasMore(!!data.nextCursor);

            if (includeTotal && typeof data.total === 'number') {
                setTotalParsed(data.total);
            }

        } catch (err: any) {
            console.error('[EXPENSES_LOAD]', err);
            toast({
                variant: 'destructive',
                title: 'Failed to load expenses',
                description: err?.message || 'Check server logs.',
            });
        } finally {
            if (isMore) setIsLoadingMore(false);
            else setIsLoading(false);
        }
    }, [categoryFilter, branchFilterMode, branchFilter, branchIdsFilter, dateRange, toast]);

    // Initial Load & Reference Data
    useEffect(() => {
        setIsClient(true);
        let isActive = true;

        const loadRefs = async () => {
            try {
                const [businesses, categories, accounts, branches, cashDrawers] = await Promise.all([
                    getBusinesses(),
                    getExpenseCategories(),
                    getChartOfAccounts(),
                    getBranches(),
                    getCashDrawers(),
                ]);
                if (isActive) {
                    setAllBusinesses(businesses);
                    setAllExpenseCategories(categories);
                    setAllAccounts(Array.isArray(accounts) ? accounts : []);
                    setAllBranches(Array.isArray(branches) ? branches : []);
                    setAllCashDrawers(Array.isArray(cashDrawers) ? cashDrawers : []);
                }
            } catch (err) {
                console.error("Failed to load reference data", err);
            }
        };
        loadRefs();

        // Initial fetch of expenses (resets list)
        loadExpenses(undefined, false);

        return () => { isActive = false; };
    }, [loadExpenses]); // Dependencies (dateRange, categoryFilter) trigger loadExpenses changes

    // Reset selection when list changes significantly (not perfect but safe)
    useEffect(() => {
        if (!isLoadingMore) {
            setSelectedIds(new Set());
        }
    }, [dateRange, categoryFilter, isLoadingMore]);


    const openDialog = (mode: 'add' | 'edit', expense?: Expense) => {
        setDialogMode(mode);
        setSelectedExpense(expense || null);
        setIsDialogOpen(true);
    }

    const closeDialog = useCallback(() => {
        setIsDialogOpen(false);
        setSelectedExpense(null);
        setIsSaving(false);
        setMenuResetKey((k) => k + 1);
    }, []);

    const openEditDialogFor = useCallback((expense: Expense) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        (document.activeElement as HTMLElement | null)?.blur();
        window.setTimeout(() => openDialog('edit', expense), 40);
    }, []);

    const openDeleteDialogFor = useCallback((expense: Expense) => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        (document.activeElement as HTMLElement | null)?.blur();
        window.setTimeout(() => setDeleteDialog({ isOpen: true, expense }), 40);
    }, []);

    const closeDeleteDialog = useCallback(() => {
        setDeleteDialog({ isOpen: false, expense: null });
        setIsDeleting(false);
        try {
            (document.activeElement as HTMLElement | null)?.blur();
            setTimeout(() => document.body?.focus?.(), 0);
        } catch { }
        setMenuResetKey((k) => k + 1);
    }, []);

    const assetAccounts = useMemo(
        () => allAccounts.filter((account) => account.type === 'Asset'),
        [allAccounts]
    );
    const paidFromAccounts = useMemo(
        () => assetAccounts.filter(isPaymentAccount),
        [assetAccounts]
    );
    const liabilityAccounts = useMemo(
        () => allAccounts.filter((account) => account.type === 'Liability'),
        [allAccounts]
    );
    const defaultPaidAccountId = useMemo(() => {
        const cashAccount = paidFromAccounts.find((account) =>
            account.name.toLowerCase().includes('cash')
        );
        return cashAccount?.id || paidFromAccounts[0]?.id || null;
    }, [paidFromAccounts]);
    const defaultPayableAccountId = useMemo(() => {
        const payableAccount = liabilityAccounts.find((account) =>
            account.name.toLowerCase().includes('payable')
        );
        return payableAccount?.id || liabilityAccounts[0]?.id || null;
    }, [liabilityAccounts]);

    const handleSave = useCallback(async (data: ExpenseFormValues) => {
        setIsSaving(true);
        try {
            const paidFromAccountId = data.isPaid
                ? (data.paidFromAccountId || defaultPaidAccountId || null)
                : null;
            const payableAccountId = data.payableAccountId || defaultPayableAccountId || null;
            const paidAt = data.isPaid ? (data.paidAt || null) : null;
            const check = data.isPaid ? Number(data.check || 0) : 0;
            const checkDate = data.isPaid && check > 0 ? (data.checkDate || null) : null;
            const payload = {
                date: data.date,
                categoryId: data.categoryId,
                amount: Number(data.amount),
                notes: data.notes,
                businessId: data.businessId,
                branchId: data.branchId || null,
                isAdExpense: Boolean(data.isAdExpense),
                platform: data.isAdExpense ? data.platform : null,
                isPaid: data.isPaid,
                paidFromAccountId, // Simplified logic as payload builder handles nulls/undefineds often, but explicit here
                payableAccountId,
                check,
                checkDate,
                checkNo: data.isPaid && check > 0 ? (data.checkNo || undefined) : undefined,
                paidAt,
            };

            const saved = dialogMode === 'edit' && selectedExpense?.id
                ? await updateExpense(selectedExpense.id, payload)
                : await createExpense(payload);

            setAllExpenses((prev) => {
                if (dialogMode === 'edit') {
                    return prev.map((e) => (e.id === saved.id ? saved : e));
                }
                // Add new at top
                return [saved, ...prev];
            });

            toast({
                title: dialogMode === 'edit' ? 'Expense updated' : 'Expense added',
                description: 'Changes saved successfully.',
            });
            closeDialog();
        } catch (err: any) {
            console.error('[EXPENSE_SAVE]', err);
            toast({
                variant: 'destructive',
                title: dialogMode === 'edit' ? 'Update failed' : 'Create failed',
                description: err?.message || 'Check server logs.',
            });
        } finally {
            setIsSaving(false);
        }
    }, [closeDialog, dialogMode, selectedExpense?.id, toast, defaultPaidAccountId, defaultPayableAccountId]);

    const handleApprove = async (expense: Expense) => {
        try {
            await updateExpense(expense.id, {
                approvalStatus: 'Approved',
                approvedById: currentStaffId,
                approvedByName: currentStaffName
            });
            setAllExpenses(prev => prev.map(e => e.id === expense.id ? { ...e, approvalStatus: 'Approved' } : e));
            toast({ title: 'Expense Approved' });
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Approval failed', description: err.message });
        }
    };

    const confirmReject = async () => {
        if (!rejectDialog.expense) return;
        try {
            setIsRejecting(true);
            await updateExpense(rejectDialog.expense.id, {
                approvalStatus: 'Rejected',
                rejectionNote,
                rejectedById: currentStaffId,
                rejectedByName: currentStaffName
            });
            setAllExpenses(prev => prev.map(e => e.id === rejectDialog.expense!.id ? { ...e, approvalStatus: 'Rejected', notes: rejectionNote } : e));
            toast({ title: 'Expense Rejected' });
            setRejectDialog({ isOpen: false, expense: null });
            setRejectionNote("");
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Rejection failed', description: err.message });
        } finally {
            setIsRejecting(false);
        }
    };

    const handleMarkAsPaid = async (expense: Expense) => {
        try {
            await updateExpense(expense.id, {
                isPaid: true,
                paidAt: format(new Date(), 'yyyy-MM-dd'),
                paidById: currentStaffId,
                paidByName: currentStaffName
            });
            setAllExpenses(prev => prev.map(e => e.id === expense.id ? { ...e, isPaid: true } : e));
            toast({ title: 'Expense marked as Paid' });
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Payment update failed', description: err.message });
        }
    };

    const confirmDelete = useCallback(async () => {
        if (!deleteDialog.expense) return;
        setIsDeleting(true);
        try {
            await deleteExpense(deleteDialog.expense.id);
            setAllExpenses(prev => prev.filter(e => e.id !== deleteDialog.expense!.id));
            setSelectedIds(prev => {
                const next = new Set(prev);
                next.delete(deleteDialog.expense!.id);
                return next;
            });
            toast({ title: 'Expense deleted' });
            closeDeleteDialog();
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Delete failed', description: err?.message || 'Check server logs.' });
            setIsDeleting(false);
        }
    }, [deleteDialog.expense, closeDeleteDialog, toast]);

    const initialFormValues: ExpenseFormValues = useMemo(() => {
        const today = format(new Date(), 'yyyy-MM-dd');
        const defaultCategoryId = allExpenseCategories[0]?.id || '';

        if (!selectedExpense) {
            return {
                date: today,
                categoryId: defaultCategoryId,
                amount: 0,
                businessId: null,
                branchId: null,
                notes: '',
                isAdExpense: false,
                platform: null,
                isPaid: false,
                paidFromAccountId: defaultPaidAccountId,
                payableAccountId: defaultPayableAccountId,
                check: 0,
                checkDate: '',
                checkNo: '',
                paidAt: '',
                approvalStatus: 'Submitted' as const,
            };
        }

        const resolvedCategoryId =
            selectedExpense.categoryId ||
            allExpenseCategories.find((c) => c.name === selectedExpense.category)?.id ||
            defaultCategoryId;

        const resolvedPaidAt = selectedExpense.paidAt
            ? format(new Date(selectedExpense.paidAt), 'yyyy-MM-dd')
            : '';
        const resolvedCheckDate = selectedExpense.checkDate
            ? format(new Date(selectedExpense.checkDate), 'yyyy-MM-dd')
            : '';

        return {
            date: selectedExpense.date ? format(new Date(selectedExpense.date), 'yyyy-MM-dd') : today,
            categoryId: resolvedCategoryId,
            amount: selectedExpense.amount ?? 0,
            businessId: selectedExpense.businessId ?? null,
            branchId: selectedExpense.branchId ?? null,
            notes: selectedExpense.notes || '',
            isAdExpense: Boolean(selectedExpense.isAdExpense),
            platform: (selectedExpense.platform as OrderPlatform | undefined) ?? null,
            isPaid: selectedExpense.isPaid ?? true,
            paidFromAccountId: selectedExpense.paidFromAccountId ?? defaultPaidAccountId,
            payableAccountId: selectedExpense.payableAccountId ?? defaultPayableAccountId,
            check: selectedExpense.check ?? 0,
            checkDate: resolvedCheckDate,
            checkNo: selectedExpense.checkNo || '',
            paidAt: resolvedPaidAt || today,
            approvalStatus: selectedExpense.approvalStatus || 'Submitted',
        };
    }, [allExpenseCategories, defaultPaidAccountId, defaultPayableAccountId, selectedExpense]);

    const filteredExpenses = allExpenses; // Already filtered by server

    const totalFilteredExpense = useMemo(() => {
        if (!Array.isArray(filteredExpenses)) return 0;
        return filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    }, [filteredExpenses]);

    const selectedCategoryLabel = useMemo(() => {
        if (categoryFilter === 'all') return null;
        return allExpenseCategories.find((cat) => cat.id === categoryFilter)?.name || null;
    }, [allExpenseCategories, categoryFilter]);

    const handleLoadMore = () => {
        if (nextCursor) {
            loadExpenses(nextCursor, true);
        }
    };

    const renderTable = () => (
        <Table>
            <TableHeader className="hidden sm:table-header-group">
                <TableRow>
                    <TableHead className="w-[40px]">
                        <Checkbox
                            checked={filteredExpenses.length > 0 && selectedIds.size === filteredExpenses.length}
                            onCheckedChange={toggleSelectAll}
                            aria-label="Select all"
                        />
                    </TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Business/Platform</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                        <span className="sr-only">Actions</span>
                    </TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {filteredExpenses.map((expense) => (
                    <TableRow key={expense.id} className="hidden sm:table-row">
                        <TableCell>
                            <Checkbox
                                checked={selectedIds.has(expense.id)}
                                onCheckedChange={() => toggleSelectRow(expense.id)}
                                aria-label="Select row"
                            />
                        </TableCell>
                        <TableCell className="align-top font-medium">
                            <div className="flex flex-col">
                                <span>{format(new Date(expense.date), "MMM d, yyyy")}</span>
                                <span className="text-[10px] text-muted-foreground sm:hidden">{expense.category}</span>
                            </div>
                        </TableCell>
                        <TableCell className="align-top">
                            <Badge variant="outline" className="font-normal">
                                {expense.category}
                            </Badge>
                            {expense.isAdExpense && (
                                <Badge variant="secondary" className="ml-2 text-[10px]">
                                    Ad
                                </Badge>
                            )}
                        </TableCell>
                        <TableCell className="align-top">
                            <div className="flex flex-col gap-1">
                                {expense.business ? (
                                    <div className="flex items-center gap-1 text-sm">
                                        <span className="font-medium">{(expense.business as any).name || expense.business}</span>
                                    </div>
                                ) : (
                                    <span className="text-muted-foreground text-sm">-</span>
                                )}
                                {expense.isAdExpense && expense.platform && (
                                    <Badge variant="outline" className="w-fit text-[10px]">
                                        {expense.platform}
                                    </Badge>
                                )}
                            </div>
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground max-w-[200px]">
                            {expense.notesDisplay || expense.notes || '-'}
                        </TableCell>
                        <TableCell className="align-top font-bold text-slate-700 text-right">
                            <div className="flex flex-col items-end">
                                <span>Tk {expense.amount.toFixed(2)}</span>
                                {!expense.isPaid && (
                                    <span className="text-[10px] text-red-500 font-normal">Unpaid</span>
                                )}
                                {expense.isPaid && (expense.check ?? 0) > 0 && (
                                    <div className="flex items-center gap-1 text-[10px] text-blue-600">
                                        <Badge variant="outline" className="h-4 px-1 text-[9px] border-blue-200">CHK</Badge>
                                        {expense.checkNo && <span>#{expense.checkNo}</span>}
                                    </div>
                                )}
                            </div>
                        </TableCell>
                        <TableCell className="align-top">
                            <div className="flex flex-col gap-1">
                                <Badge
                                    variant={
                                        expense.approvalStatus === 'Approved' ? 'secondary' :
                                            expense.approvalStatus === 'Rejected' ? 'destructive' :
                                                'outline'
                                    }
                                    className={cn(
                                        "w-fit text-[10px]",
                                        expense.approvalStatus === 'Approved' && "bg-green-100 text-green-800 border-green-200 hover:bg-green-100"
                                    )}
                                >
                                    {expense.approvalStatus}
                                </Badge>
                                {expense.approvalStatus === 'Rejected' && expense.rejectionNote && (
                                    <span className="text-[10px] text-red-500 max-w-[120px] truncate" title={expense.rejectionNote}>
                                        {expense.rejectionNote}
                                    </span>
                                )}
                            </div>
                        </TableCell>
                        <TableCell className="text-right align-top">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                        <span className="sr-only">Open menu</span>
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                    <DropdownMenuItem onClick={() => openEditDialogFor(expense)}>
                                        <Edit className="mr-2 h-4 w-4" /> Edit
                                    </DropdownMenuItem>
                                    {(isAdmin || isManager) && expense.approvalStatus === 'Submitted' && (
                                        <>
                                            <DropdownMenuItem className="text-green-600" onClick={() => handleApprove(expense)}>
                                                <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
                                            </DropdownMenuItem>
                                            <DropdownMenuItem className="text-red-600" onClick={() => setRejectDialog({ isOpen: true, expense })}>
                                                <XCircle className="mr-2 h-4 w-4" /> Reject
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                    {(isAdmin || isFinance) && expense.approvalStatus === 'Approved' && !expense.isPaid && (
                                        <DropdownMenuItem className="text-blue-600" onClick={() => handleMarkAsPaid(expense)}>
                                            <Wallet className="mr-2 h-4 w-4" /> Mark as Paid
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="text-red-600 focus:text-red-600"
                                        onClick={() => openDeleteDialogFor(expense)}
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </TableCell>
                    </TableRow>
                ))}

                {filteredExpenses.length === 0 && (
                    <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center">
                            No expenses found.
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );

    const renderCardList = () => (
        <div className="space-y-4">
            {filteredExpenses.map((expense) => (
                <Card key={expense.id}>
                    <CardContent className="p-4 space-y-3">
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="font-semibold">{expense.category}</p>
                                <p className="text-sm text-muted-foreground">{format(new Date(expense.date), 'MMM d, yyyy')}</p>
                            </div>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button aria-haspopup="true" size="icon" variant="ghost">
                                        <MoreHorizontal className="h-4 w-4" />
                                        <span className="sr-only">Toggle menu</span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                    <DropdownMenuItem onSelect={() => openEditDialogFor(expense)}>
                                        <Edit className="mr-2 h-4 w-4" /> Edit
                                    </DropdownMenuItem>
                                    {(isAdmin || isManager) && expense.approvalStatus === 'Submitted' && (
                                        <>
                                            <DropdownMenuItem className="text-green-600" onSelect={() => handleApprove(expense)}>
                                                <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
                                            </DropdownMenuItem>
                                            <DropdownMenuItem className="text-red-600" onSelect={() => setRejectDialog({ isOpen: true, expense })}>
                                                <XCircle className="mr-2 h-4 w-4" /> Reject
                                            </DropdownMenuItem>
                                        </>
                                    )}
                                    {(isAdmin || isFinance) && expense.approvalStatus === 'Approved' && !expense.isPaid && (
                                        <DropdownMenuItem className="text-blue-600" onSelect={() => handleMarkAsPaid(expense)}>
                                            <Wallet className="mr-2 h-4 w-4" /> Mark as Paid
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialogFor(expense)}>
                                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        <p className="text-sm text-muted-foreground">{expense.notesDisplay || expense.notes || '-'}</p>
                        <Separator />
                        <div className="flex justify-between items-center">
                            <div className="flex flex-col gap-1">
                                {expense.business ? (
                                    <Badge variant="secondary" className="w-fit">
                                        {(expense.business as any).name || expense.business}
                                    </Badge>
                                ) : (
                                    <span className="text-muted-foreground text-sm">-</span>
                                )}
                                {expense.isAdExpense && expense.platform && (
                                    <Badge variant="outline" className="w-fit">
                                        {expense.platform}
                                    </Badge>
                                )}
                            </div>
                            <div className="flex flex-col items-end gap-1">
                                <p className="font-bold text-lg font-mono">Tk {expense.amount.toFixed(2)}</p>
                                <Badge
                                    variant={
                                        expense.approvalStatus === 'Approved' ? 'secondary' :
                                            expense.approvalStatus === 'Rejected' ? 'destructive' :
                                                'outline'
                                    }
                                    className="text-[10px]"
                                >
                                    {expense.approvalStatus}
                                </Badge>
                                {!expense.isPaid && <span className="text-xs text-red-500">Unpaid</span>}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );

    if (isLoading) {
        return (
            <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <Skeleton className="h-10 w-1/3" />
                    <Skeleton className="h-10 w-1/4" />
                </div>
                <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <Skeleton className="h-10 w-full" />
                </div>
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-96 w-full" />
            </div>
        )
    }

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1">
                    <h1 className="font-headline text-2xl font-bold">Expenses</h1>
                    <p className="text-muted-foreground hidden sm:block">Track and manage all business expenses.</p>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                    {selectedIds.size > 0 && (
                        <Button size="sm" variant="outline" className="h-10" onClick={handlePrintSelected}>
                            <Printer className="h-4 w-4 sm:mr-2" />
                            <span className="hidden sm:inline">Print ({selectedIds.size})</span>
                        </Button>
                    )}
                    <ExpenseCategoryCombobox
                        categories={allExpenseCategories}
                        value={categoryFilter}
                        onChange={setCategoryFilter}
                    />
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-10 w-10 shrink-0"
                            onClick={() => {
                                setBranchFilterMode(m => m === 'single' ? 'multi' : 'single');
                                setBranchFilter('all');
                                setBranchIdsFilter([]);
                            }}
                            title={`Switch to ${branchFilterMode === 'single' ? 'Multiple' : 'Single'} Branch Filter`}
                        >
                            <ListFilter className="h-4 w-4" />
                        </Button>
                        {branchFilterMode === 'single' ? (
                            <Select value={branchFilter} onValueChange={setBranchFilter}>
                                <SelectTrigger className="w-[180px] h-10">
                                    <SelectValue placeholder="Branch" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Branches</SelectItem>
                                    <SelectItem value="null">None (Global)</SelectItem>
                                    {allBranches.filter(b => b.isActive).map(b => (
                                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-[180px] h-10 justify-start font-normal text-left">
                                        {branchIdsFilter.length === 0 ? "All Branches" : `${branchIdsFilter.length} Selected`}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[220px] p-4" align="start">
                                    <div className="space-y-4">
                                        <div className="flex items-center space-x-2">
                                            <Checkbox 
                                                id="branch-all" 
                                                checked={branchIdsFilter.length === 0} 
                                                onCheckedChange={() => setBranchIdsFilter([])} 
                                            />
                                            <Label htmlFor="branch-all" className="font-medium cursor-pointer">All Branches</Label>
                                        </div>
                                        <Separator />
                                        <div className="flex items-center space-x-2">
                                            <Checkbox 
                                                id="branch-none" 
                                                checked={branchIdsFilter.includes('__NULL__')} 
                                                onCheckedChange={(checked) => {
                                                    setBranchIdsFilter(prev => checked ? [...prev, '__NULL__'] : prev.filter(v => v !== '__NULL__'));
                                                }} 
                                            />
                                            <Label htmlFor="branch-none" className="font-normal cursor-pointer text-muted-foreground">None (Global)</Label>
                                        </div>
                                        {allBranches.filter(b => b.isActive).map(b => (
                                            <div key={b.id} className="flex items-center space-x-2">
                                                <Checkbox 
                                                    id={`branch-${b.id}`} 
                                                    checked={branchIdsFilter.includes(b.id)} 
                                                    onCheckedChange={(checked) => {
                                                        setBranchIdsFilter(prev => checked ? [...prev, b.id] : prev.filter(v => v !== b.id));
                                                    }} 
                                                />
                                                <Label htmlFor={`branch-${b.id}`} className="font-normal cursor-pointer line-clamp-1 flex-1">{b.name}</Label>
                                            </div>
                                        ))}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        )}
                    </div>
                    <DateRangePicker date={dateRange} onDateChange={setDateRange} placeholder="Filter by date" />
                    <Button size="sm" className="h-10" onClick={() => openDialog('add')}>
                        <PlusCircle className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Add Expense</span>
                        <span className="sm:hidden sr-only">Add Expense</span>
                    </Button>
                </div>
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Total Expenses {selectedCategoryLabel ? `(${selectedCategoryLabel})` : ''}
                    </CardTitle>
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">Tk {totalFilteredExpense.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">
                        {dateRange?.from
                            ? `From ${format(dateRange.from, "LLL dd, y")}${dateRange.to ? ` to ${format(dateRange.to, "LLL dd, y")}` : ''}`
                            : (totalParsed !== undefined ? `Total count detected: ${totalParsed}` : "Loaded expenses")
                        }
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Expense List</CardTitle>
                    <CardDescription>
                        {dateRange?.from
                            ? `Showing expenses from ${format(dateRange.from, "LLL dd, y")}${dateRange.to ? ` to ${format(dateRange.to, "LLL dd, y")}` : ''}`
                            : "A list of all recorded business expenses."
                        }
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {filteredExpenses.length > 0 ? (
                        <>
                            <div className="hidden sm:block">{renderTable()}</div>
                            <div className="sm:hidden p-4">{renderCardList()}</div>
                        </>
                    ) : (
                        <div className="h-48 flex items-center justify-center text-muted-foreground">
                            No expenses found for the selected filters.
                        </div>
                    )}
                </CardContent>
                <CardFooter className="flex flex-col items-center justify-center gap-4 py-4">
                    <div className="text-xs text-muted-foreground">
                        Showing {filteredExpenses.length} {totalParsed !== undefined ? `of ${totalParsed}` : 'items'}
                    </div>
                    {hasMore && (
                        <Button
                            variant="outline"
                            onClick={handleLoadMore}
                            disabled={isLoadingMore}
                            className="min-w-[200px]"
                        >
                            {isLoadingMore ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Loading more...
                                </>
                            ) : (
                                'Load More Expenses'
                            )}
                        </Button>
                    )}
                </CardFooter>
            </Card>

            <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
                <DialogContent className="sm:max-w-lg flex flex-col max-h-[90vh] overflow-hidden p-0">
                    <div className="flex-none p-6 pb-2">
                        <DialogHeader>
                            <DialogTitle>{dialogMode === 'edit' ? 'Edit Expense' : 'Add New Expense'}</DialogTitle>
                            <DialogDescription>
                                {dialogMode === 'edit' ? 'Update the details of this expense.' : 'Record a new expense for your business.'}
                            </DialogDescription>
                        </DialogHeader>
                    </div>
                    <div className="flex-1 flex flex-col overflow-hidden px-6 pb-2">
                        <ExpenseForm
                            initialValues={initialFormValues}
                            businesses={allBusinesses}
                            categories={allExpenseCategories}
                            accounts={allAccounts}
                            cashDrawers={allCashDrawers}
                            branches={allBranches}
                            defaultPaidAccountId={defaultPaidAccountId}
                            defaultPayableAccountId={defaultPayableAccountId}
                            isSaving={isSaving}
                            userRole={userRole}
                            onSave={handleSave}
                            onCancel={closeDialog}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={deleteDialog.isOpen} onOpenChange={(open) => { if (!open) closeDeleteDialog(); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete expense?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete this expense record.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={closeDeleteDialog} disabled={isDeleting}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDelete} disabled={isDeleting}>
                            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={rejectDialog.isOpen} onOpenChange={(open) => !open && setRejectDialog({ isOpen: false, expense: null })}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Reject Expense</DialogTitle>
                        <DialogDescription>
                            Please provide a reason for rejecting this expense.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <Textarea
                            placeholder="Rejection note..."
                            value={rejectionNote}
                            onChange={(e) => setRejectionNote(e.target.value)}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setRejectDialog({ isOpen: false, expense: null })}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={confirmReject}
                            disabled={!rejectionNote.trim() || isRejecting}
                        >
                            {isRejecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Reject Expense
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
