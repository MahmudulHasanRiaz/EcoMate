'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Business, ExpenseCategory, Account, Branch } from '@/types';
import { useEffect } from 'react';

const expenseSchema = z.object({
    date: z.string().min(1, 'Date is required'),
    categoryId: z.string().min(1, 'Category is required'),
    amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
    notes: z.string().optional(),
    businessId: z.string().nullable().optional(),
    branchId: z.string().nullable().optional(),
    isAdExpense: z.boolean().default(false),
    platform: z.enum(['Facebook', 'Instagram', 'TikTok', 'Messenger', 'Website', 'Call']).nullable().optional(),
    isPaid: z.boolean().default(true),
    paidFromAccountId: z.string().nullable().optional(),
    payableAccountId: z.string().nullable().optional(),
    check: z.coerce.number().optional(),
    checkDate: z.string().optional(),
    checkNo: z.string().optional(),
    paidAt: z.string().optional(),
    approvalStatus: z.enum(['Submitted', 'Approved', 'Rejected']).default('Submitted'),
});

export type ExpenseFormValues = z.infer<typeof expenseSchema>;

interface ExpenseFormProps {
    initialValues: ExpenseFormValues;
    businesses: Business[];
    categories: ExpenseCategory[];
    accounts: Account[];
    branches?: Branch[];
    defaultPaidAccountId: string | null;
    defaultPayableAccountId: string | null;
    cashDrawers: any[];
    isSaving: boolean;
    userRole?: string;
    onSave: (data: ExpenseFormValues) => void;
    onCancel: () => void;
}

export function ExpenseForm({
    initialValues,
    businesses,
    categories,
    accounts,
    branches = [],
    defaultPaidAccountId,
    defaultPayableAccountId,
    cashDrawers = [],
    isSaving,
    userRole,
    onSave,
    onCancel,
}: ExpenseFormProps) {
    const form = useForm<ExpenseFormValues>({
        resolver: zodResolver(expenseSchema),
        defaultValues: initialValues,
    });

    const isPaid = form.watch('isPaid');
    const isAdExpense = form.watch('isAdExpense');
    const checkAmount = form.watch('check');
    const approvalStatus = form.watch('approvalStatus');

    const isAdmin = userRole === 'Admin';
    const isManager = userRole === 'Manager';

    // Disable core fields if Approved/Rejected (unless Admin/Manager)
    const isCoreDisabled = (approvalStatus === 'Approved' || approvalStatus === 'Rejected') && !isAdmin && !isManager;

    // Disable payment fields if not Approved (Strict: No role bypass)
    const isPaymentDisabled = approvalStatus !== 'Approved';

    // Filter accounts
    const assetAccounts = accounts.filter(a => a.group === 'LIQUID');
    
    // Create combined paidFrom list (Active Cash Drawers + Other Asset Accounts)
    const activeDrawers = cashDrawers.filter((d: any) => d.isActive).map((d: any) => ({
      id: d.accountId,
      name: d.name
    }));

    // Filter out accounts that are already represented by a cash drawer
    const drawerAccountIds = new Set(cashDrawers.map((d: any) => d.accountId));
    const otherAssetAccounts = assetAccounts.filter(a => !drawerAccountIds.has(a.id));

    const allPaidFromAccounts = [...activeDrawers, ...otherAssetAccounts];

    const liabilityAccounts = accounts.filter(a => a.type === 'Liability');
    const activeBranches = branches.filter(b => b.isActive);

    useEffect(() => {
        if (isPaid && !form.getValues('paidFromAccountId') && defaultPaidAccountId) {
            form.setValue('paidFromAccountId', defaultPaidAccountId);
        }
    }, [isPaid, defaultPaidAccountId, form]);

    useEffect(() => {
        if (!isPaid && !form.getValues('payableAccountId') && defaultPayableAccountId) {
            form.setValue('payableAccountId', defaultPayableAccountId);
        }
    }, [isPaid, defaultPayableAccountId, form]);

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col max-h-[75vh]">
                <div className="flex-1 overflow-y-auto pr-2 -mr-2 py-1 space-y-5">

                    {/* ── Section: Expense Info ── */}
                    <fieldset className="space-y-4 rounded-lg border p-4 bg-card">
                        <legend className="text-sm font-semibold text-muted-foreground px-2">Expense Info</legend>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="date"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Date</FormLabel>
                                        <FormControl>
                                            <Input type="date" {...field} disabled={isCoreDisabled} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="categoryId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Category</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                            <FormControl>
                                                <SelectTrigger disabled={isCoreDisabled}>
                                                    <SelectValue placeholder="Select category" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {categories.map((category) => (
                                                    <SelectItem key={category.id} value={category.id}>
                                                        {category.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="amount"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Amount</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" {...field} disabled={isCoreDisabled} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="businessId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Business</FormLabel>
                                        <Select
                                            onValueChange={(val) => field.onChange(val === "null" ? null : val)}
                                            defaultValue={field.value || "null"}
                                            value={field.value || "null"}
                                        >
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select business" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                <SelectItem value="null">None</SelectItem>
                                                {businesses.map((business) => (
                                                    <SelectItem key={business.id} value={business.id}>
                                                        {business.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="branchId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Branch</FormLabel>
                                    <Select
                                        onValueChange={(val) => field.onChange(val === "null" ? null : val)}
                                        defaultValue={field.value || "null"}
                                        value={field.value || "null"}
                                    >
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select branch" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="null">None (Global)</SelectItem>
                                            {activeBranches.map((branch) => (
                                                <SelectItem key={branch.id} value={branch.id}>
                                                    {branch.name}{branch.code ? ` (${branch.code})` : ''}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="notes"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Notes</FormLabel>
                                    <FormControl>
                                        <Textarea {...field} rows={2} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </fieldset>

                    {/* ── Section: Ad & Platform ── */}
                    <fieldset className="space-y-4 rounded-lg border p-4 bg-card">
                        <legend className="text-sm font-semibold text-muted-foreground px-2">Ad & Platform</legend>

                        <FormField
                            control={form.control}
                            name="isAdExpense"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                    <FormControl>
                                        <Checkbox
                                            checked={field.value}
                                            onCheckedChange={field.onChange}
                                            disabled={isCoreDisabled}
                                        />
                                    </FormControl>
                                    <div className="space-y-0 leading-none">
                                        <FormLabel className="cursor-pointer">Ad Expense</FormLabel>
                                        <FormDescription className="text-xs">
                                            Check if this is an advertising expense.
                                        </FormDescription>
                                    </div>
                                </FormItem>
                            )}
                        />

                        {isAdExpense && (
                            <FormField
                                control={form.control}
                                name="platform"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Platform</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value || undefined}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select platform" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {['Facebook', 'Instagram', 'TikTok', 'Messenger', 'Website', 'Call'].map((p) => (
                                                    <SelectItem key={p} value={p}>
                                                        {p}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}
                    </fieldset>

                    {/* ── Section: Payment Info ── */}
                    <fieldset className="space-y-4 rounded-lg border p-4 bg-card">
                        <legend className="text-sm font-semibold text-muted-foreground px-2">Payment Info</legend>

                        <FormField
                            control={form.control}
                            name="isPaid"
                            render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                                    <div className="space-y-0.5">
                                        <FormLabel>Payment Status</FormLabel>
                                        <FormDescription className="text-xs">
                                            {approvalStatus !== 'Approved'
                                                ? "Must be Approved before payment."
                                                : "Is this expense already paid?"}
                                        </FormDescription>
                                    </div>
                                    <FormControl>
                                        <div className="flex items-center gap-2">
                                            <span className={cn("text-sm", !field.value && "font-bold")}>Unpaid</span>
                                            <Checkbox
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                disabled={isPaymentDisabled}
                                            />
                                            <span className={cn("text-sm", field.value && "font-bold")}>Paid</span>
                                        </div>
                                    </FormControl>
                                </FormItem>
                            )}
                        />

                        {isPaid ? (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="paidAt"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Payment Date</FormLabel>
                                                <FormControl>
                                                    <Input type="date" {...field} disabled={!isPaid || isPaymentDisabled} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="paidFromAccountId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Paid From</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value || undefined}>
                                                    <FormControl>
                                                        <SelectTrigger disabled={!isPaid || isPaymentDisabled}>
                                                            <SelectValue placeholder="Select account" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {allPaidFromAccounts.map(acc => (
                                                            <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="check"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Check Amount</FormLabel>
                                                <FormControl>
                                                    <Input type="number" step="0.01" {...field} disabled={isPaymentDisabled} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    {(checkAmount || 0) > 0 && (
                                        <>
                                            <FormField
                                                control={form.control}
                                                name="checkNo"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Check No.</FormLabel>
                                                        <FormControl>
                                                            <Input {...field} disabled={isPaymentDisabled} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={form.control}
                                                name="checkDate"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Check Date</FormLabel>
                                                        <FormControl>
                                                            <Input type="date" {...field} disabled={!isPaid || isPaymentDisabled} />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </>
                                    )}
                                </div>
                            </>
                        ) : (
                            <FormField
                                control={form.control}
                                name="payableAccountId"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Payable Account (Liability)</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value || undefined}>
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select liability account" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {liabilityAccounts.map(acc => (
                                                    <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}
                    </fieldset>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t mt-4">
                    <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={isSaving}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Expense
                    </Button>
                </div>
            </form>
        </Form>
    );
}
