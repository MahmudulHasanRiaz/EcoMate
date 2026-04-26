'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Mail, Phone, MapPin, MoreVertical, Coins, Plus, Loader2, Printer } from 'lucide-react';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { getPartnerById, getPurchaseOrdersByPartner, getPurchaseOrdersByPartnerId, getPartnerWithDualIds } from '@/services/partners';
import { applyPartnerPayment } from '@/app/dashboard/purchases/actions';
import { getChartOfAccounts } from '@/services/accounting';
import { getCashDrawers } from '@/services/cash-drawers';
import { useToast } from '@/hooks/use-toast';
import type { PurchaseOrder, Payment, ProductionStep, Supplier, Vendor, Account } from '@/types';


const poStatusColors = {
    'Received': 'bg-green-500/20 text-green-700',
    'Cutting': 'bg-purple-500/20 text-purple-700',
    'Printing': 'bg-yellow-500/20 text-yellow-700',
    'Fabric Ordered': 'bg-blue-500/20 text-blue-700',
    'Draft': 'bg-gray-500/20 text-gray-700',
    'Cancelled': 'bg-red-500/20 text-red-700',
};

type Partner = Supplier | Vendor;

type PaymentWithPO = Payment & {
    poId: string;
    paymentFor: string;
    date: string; // The PO date
};

const normalizeStepType = (value?: string | null) => (value || '').trim().toUpperCase();

const formatStepType = (value: string) => {
    const normalized = normalizeStepType(value);
    if (!normalized) return value;
    const lower = normalized.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
};

const isInternalSupplierName = (name?: string | null) =>
    (name || '').trim().toLowerCase() === 'internal stock';

const getStepTypeForPayment = (
    payment: Payment,
    stepById: Map<string, ProductionStep>
) => {
    if (payment.productionStepId) {
        const step = stepById.get(payment.productionStepId);
        if (step?.stepType) return normalizeStepType(step.stepType);
    }
    return normalizeStepType(payment.paymentFor);
};

export default function PartnerDetailsPage() {
    const params = useParams();
    const partnerId = params.id as string;
    const [isClient, setIsClient] = React.useState(false);
    const [partner, setPartner] = React.useState<(Partner & { supplierId?: string; vendorId?: string }) | undefined>(undefined);
    const [associatedPOs, setAssociatedPOs] = React.useState<PurchaseOrder[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isPaymentOpen, setIsPaymentOpen] = React.useState(false);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [accounts, setAccounts] = React.useState<Account[]>([]);
    const [cashDrawers, setCashDrawers] = React.useState<any[]>([]);
    const { toast } = useToast();

    // Centralized helper to load partner data and associated orders
    // This ensures dual-role partners (Supplier + Vendor) always see complete data
    const loadPartnerAndOrders = React.useCallback(async (targetPartnerId: string) => {
        if (!targetPartnerId) return;

        setIsLoading(true);
        try {
            // 1. Fetch partner with both supplier and vendor IDs
            const partnerData = await getPartnerWithDualIds(targetPartnerId);

            if (!partnerData) {
                setPartner(undefined);
                setAssociatedPOs([]);
                return;
            }

            // 2. Fetch orders for both roles
            const poPromises: Promise<PurchaseOrder[]>[] = [];

            if (partnerData.supplierId) {
                poPromises.push(getPurchaseOrdersByPartnerId(partnerData.supplierId));
            }
            if (partnerData.vendorId && partnerData.vendorId !== partnerData.supplierId) {
                poPromises.push(getPurchaseOrdersByPartnerId(partnerData.vendorId));
            }

            // 3. Merge and deduplicate results
            const results = await Promise.all(poPromises);
            const allPOs = results.flat();
            const uniquePOs = Array.from(
                new Map(allPOs.map(po => [po.id, po])).values()
            );

            // 4. Update state
            setPartner(partnerData);
            setAssociatedPOs(uniquePOs);
        } catch (error) {
            console.error('Failed to load partner data:', error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to load partner data. Please refresh the page.",
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    React.useEffect(() => {
        getChartOfAccounts().then(setAccounts);
        getCashDrawers().then(data => setCashDrawers(Array.isArray(data) ? data : []));
    }, []);

    const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const shouldAutoPay = searchParams?.get('pay') === '1';

    React.useEffect(() => {
        setIsClient(true);
        if (partnerId) {
            loadPartnerAndOrders(partnerId);
        }
    }, [partnerId, loadPartnerAndOrders]);

    React.useEffect(() => {
        if (isClient && !isLoading && partner && shouldAutoPay) {
            setIsPaymentOpen(true);
            // Clean URL
            const newUrl = window.location.pathname;
            window.history.replaceState({}, '', newUrl);
        }
    }, [isClient, isLoading, partner, shouldAutoPay]);

    const financials = React.useMemo(() => {
        if (!partner) return { totalBusiness: 0, totalPaid: 0, totalDue: 0, creditBalance: 0 };
        const isSupplier = 'address' in partner;
        let totalBusiness = 0;
        let totalPaid = 0;

        associatedPOs.forEach((po) => {
            const steps = po.productionSteps || [];
            const stepById = new Map(steps.map((step) => [step.id, step]));

            const paymentsTotal = (po.payments || []).reduce((sum, p) => {
                const passedAmt = (p.checkStatus === 'Passed') ? (p.check || 0) : 0;
                return sum + (p.cash || 0) + passedAmt;
            }, 0);

            if (partner.supplierId && (po.supplierId === partner.supplierId || po.supplier === partner.name)) {
                if (po.type === 'general') {
                    totalBusiness += Number(po.total) || 0;
                    totalPaid += paymentsTotal;
                } else {
                    const fabricStep = steps.find((step) => normalizeStepType(step.stepType) === 'FABRIC');
                    const cost = Number(fabricStep?.costAmount || 0) || Number(po.total) || 0;
                    totalBusiness += cost;
                    totalPaid += (po.hasInternalFabric || isInternalSupplierName(po.supplier)) ? cost : paymentsTotal;
                }
            }

            if (partner.vendorId) {
                steps.forEach((step) => {
                    const stepType = normalizeStepType(step.stepType);
                    if (!step.vendor?.name || stepType === 'FABRIC') return;
                    if (step.vendorId !== partner.vendorId && step.vendor?.name !== partner.name) return;
                    totalBusiness += Number(step.costAmount) || 0;
                    // For vendors, we need to sum payments for THIS step
                    const stepPayments = (po.payments || []).filter(p => p.productionStepId === step.id);
                    totalPaid += stepPayments.reduce((s, p) => {
                        const passedAmt = (p.checkStatus === 'Passed') ? (p.check || 0) : 0;
                        return s + (p.cash || 0) + passedAmt;
                    }, 0);
                });
            }
        });

        return {
            totalBusiness,
            totalPaid,
            totalDue: Math.max(totalBusiness - totalPaid, 0),
            creditBalance: Number(partner.creditBalance) || 0
        };
    }, [associatedPOs, partner]);

    const paymentHistory: PaymentWithPO[] = React.useMemo(() => {
        if (!isClient || !partner) return [];
        const isSupplier = 'address' in partner;
        const payments: PaymentWithPO[] = [];

        associatedPOs.forEach((po) => {
            const steps = po.productionSteps || [];
            const stepById = new Map(steps.map((step) => [step.id, step]));
            const vendorByStepType = new Map(
                steps.filter((step) => step.vendor?.name)
                    .map((step) => [normalizeStepType(step.stepType), step.vendor!.name])
            );

            (po.payments || []).forEach((payment) => {
                const amount = (payment.cash || 0) + (payment.check || 0);
                if (amount <= 0) return;
                const stepType = getStepTypeForPayment(payment, stepById);
                if (!stepType) return;

                if (partner.supplierId) {
                    const wantsGeneral = po.type === 'general' && (stepType === 'GENERAL' || stepType === 'PURCHASE BALANCE (FIFO)');
                    const wantsFabric = po.type !== 'general' && (stepType === 'FABRIC' || stepType === 'PURCHASE BALANCE (FIFO)');
                    if (wantsGeneral || wantsFabric) {
                        // Check if payment belongs to this supplier
                        // Usually on supplier PO, all general payments are supplier's
                        if (po.supplierId === partner.supplierId || po.supplier === partner.name) {
                            payments.push({
                                ...payment,
                                poId: po.id,
                                paymentFor: formatStepType(stepType),
                                date: payment.date || payment.checkDate || po.date,
                            });
                            return;
                        }
                    }
                }

                // If not handled by supplier logic, check vendor logic
                if (partner.vendorId) {
                    if (stepType === 'FABRIC' || stepType === 'GENERAL') {
                        return;
                    }
                    let vendorMatch = false;
                    if (payment.vendorId) {
                        if (payment.vendorId === partner.vendorId) {
                            vendorMatch = true;
                        }
                    } else {
                        const step = payment.productionStepId ? stepById.get(payment.productionStepId) : undefined;
                        if (step?.vendorId === partner.vendorId || step?.vendor?.name === partner.name) {
                            vendorMatch = true;
                        } else if (!step) {
                            // Fallback to type map (Legacy)
                            if (vendorByStepType.get(stepType) === partner.name) {
                                vendorMatch = true;
                            }
                        }
                    }

                    if (vendorMatch) {
                        payments.push({
                            ...payment,
                            poId: po.id,
                            paymentFor: formatStepType(stepType),
                            date: payment.date || payment.checkDate || po.date,
                        });
                    }
                }
            });
        });

        return payments.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [associatedPOs, partner, isClient]);

    if (isLoading) {
        return (
            <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                <Skeleton className="h-10 w-1/4" />
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    <Skeleton className="h-48" />
                    <Skeleton className="lg:col-span-2 h-48" />
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                    <Skeleton className="h-64" />
                    <Skeleton className="h-64" />
                </div>
            </div>
        )
    }

    if (!partner) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 lg:gap-6 lg:p-6">
                <p>Partner not found.</p>
                <Button asChild variant="outline">
                    <Link href="/dashboard/partners">Back to Partners</Link>
                </Button>
            </div>
        );
    }

    const isSupplier = 'address' in partner;

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" className="h-7 w-7" asChild>
                    <Link href="/dashboard/partners">
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">Back</span>
                    </Link>
                </Button>
                <div className="flex-1">
                    <h1 className="font-headline text-xl font-semibold sm:text-2xl">{partner.name}</h1>
                    <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                        {isSupplier ? <Badge variant="secondary">Supplier</Badge> : <Badge variant="outline">{partner.type}</Badge>}
                    </div>
                </div>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="lg:col-span-1">
                    <CardHeader>
                        <CardTitle>Contact Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                        <div>
                            <p className="font-medium">Contact Person</p>
                            <p className="text-muted-foreground">{partner.contactPerson}</p>
                        </div>
                        <div className="flex items-start gap-2">
                            <Mail className="h-4 w-4 mt-0.5 text-muted-foreground" />
                            <a href={`mailto:${partner.email}`} className="text-primary hover:underline">{partner.email}</a>
                        </div>
                        <div className="flex items-start gap-2">
                            <Phone className="h-4 w-4 mt-0.5 text-muted-foreground" />
                            <a href={`tel:${partner.phone}`} className="text-primary hover:underline">{partner.phone}</a>
                        </div>
                        {isSupplier && (
                            <div className="flex items-start gap-2">
                                <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                                <div className="text-muted-foreground">{partner.address}</div>
                            </div>
                        )}
                    </CardContent>
                </Card>
                <Card className="lg:col-span-2">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0">
                        <CardTitle>Financial Overview</CardTitle>
                        <Button size="sm" onClick={() => setIsPaymentOpen(true)} className="gap-2">
                            <Coins className="h-4 w-4" />
                            Record Payment
                        </Button>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 gap-y-4 sm:grid-cols-4 sm:gap-x-4">
                        {isClient ? (
                            <>
                                <div className="rounded-lg border bg-card p-4">
                                    <p className="text-xs text-muted-foreground">Total Business</p>
                                    <p className="text-2xl font-bold">Tk {financials.totalBusiness.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
                                </div>
                                <div className="rounded-lg border bg-card p-4">
                                    <p className="text-xs text-muted-foreground">Total Paid</p>
                                    <p className="text-2xl font-bold text-green-600">Tk {financials.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 0 })}</p>
                                </div>
                                <div className="rounded-lg border bg-card p-4">
                                    <p className="text-xs text-muted-foreground">Current Due</p>
                                    <p className={cn("text-2xl font-bold", financials.totalDue > 0 ? "text-destructive" : "")}>
                                        Tk {financials.totalDue.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                                    </p>
                                </div>
                                <div className="rounded-lg border bg-card p-4 bg-primary/5">
                                    <p className="text-xs text-muted-foreground">Credit Balance</p>
                                    <p className={cn("text-2xl font-bold text-primary")}>
                                        Tk {financials.creditBalance.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                                    </p>
                                </div>
                            </>
                        ) : (
                            <>
                                <Skeleton className="h-[98px]" />
                                <Skeleton className="h-[98px]" />
                                <Skeleton className="h-[98px]" />
                                <Skeleton className="h-[98px]" />
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Record Partner Payment</DialogTitle>
                        <DialogDescription>Apply a payment to {partner.name} using FIFO allocation.</DialogDescription>
                    </DialogHeader>
                    <PartnerPaymentForm
                        partner={partner}
                        isSupplier={isSupplier}
                        accounts={accounts}
                        cashDrawers={cashDrawers}
                        onSuccess={() => {
                            setIsPaymentOpen(false);
                            loadPartnerAndOrders(partnerId);
                        }}
                        onCancel={() => setIsPaymentOpen(false)}
                    />
                </DialogContent>
            </Dialog>

            <div className="grid gap-6 lg:grid-cols-2">
                <PartnerPOModals
                    partner={partner}
                    orders={associatedPOs}
                    isSupplier={isSupplier}
                    poStatusColors={poStatusColors}
                />

                <Card>
                    <CardHeader>
                        <CardTitle>Payment History</CardTitle>
                        <CardDescription>All payments made to this partner.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>PO Ref</TableHead>
                                    <TableHead className="text-right">Amount</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isClient ? paymentHistory.map((payment, index) => {
                                    const totalPayment = (payment.cash || 0) + (payment.check || 0);
                                    if (totalPayment === 0) return null;
                                    const paymentDate = payment.checkDate ? payment.checkDate : payment.date;
                                    const statusLabel = (payment.check || 0) > 0
                                        ? (payment.checkStatus || 'Pending')
                                        : 'Paid';
                                    return (
                                        <TableRow key={`${payment.poId}-${payment.paymentFor}-${index}`}>
                                            <TableCell>{format(new Date(paymentDate), "MMM d, yyyy")}</TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{payment.paymentMethod || (payment.check > 0 && payment.cash > 0 ? 'Cash & Check' : payment.check > 0 ? 'Check' : 'Cash')}</span>
                                                    <span className="text-xs text-muted-foreground">{payment.paymentFor}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline">{statusLabel}</Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Link href={`/dashboard/purchases/${payment.poId}`} className="text-primary hover:underline">
                                                    {payment.poId}
                                                </Link>
                                            </TableCell>
                                            <TableCell className="text-right font-mono">Tk {totalPayment.toFixed(2)}</TableCell>
                                            <TableCell>
                                                <Button variant="ghost" size="icon" asChild>
                                                    <Link href={`/dashboard/partners/payment/${payment.id}/invoice`} target="_blank">
                                                        <Printer className="h-4 w-4" />
                                                        <span className="sr-only">Print Invoice</span>
                                                    </Link>
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    )
                                }) : (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center">
                                            Loading payment history...
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        {isClient && paymentHistory.length === 0 && (
                            <div className="flex items-center justify-center text-muted-foreground h-24">
                                No payment history found.
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

const PAYMENT_ACCOUNT_KEYWORDS = ['cash', 'bank', 'bkash', 'nagad', 'rocket'];

const isPaymentAccount = (account: Account) => {
    const name = account.name.toLowerCase();
    // Must be an Asset account AND contain one of the keywords
    return account.type === 'Asset' && PAYMENT_ACCOUNT_KEYWORDS.some((keyword) => name.includes(keyword));
};

function PartnerPaymentForm({ partner, isSupplier, accounts, cashDrawers, onSuccess, onCancel }: {
    partner: any,
    isSupplier: boolean,
    accounts: Account[],
    cashDrawers: any[],
    onSuccess: () => void,
    onCancel: () => void
}) {
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [isCheckPayment, setIsCheckPayment] = React.useState(false);
    const { toast } = useToast();

    // Filter accounts
    const paymentAccounts = React.useMemo(() => {
        const banks = accounts.filter(a => a.group === 'LIQUID');
        const drawers = cashDrawers.filter(cd => cd.isActive).map(cd => ({ id: cd.accountId, name: cd.name, isCash: true }));
        return [...drawers, ...banks];
    }, [accounts, cashDrawers]);
    const defaultAccountId = React.useMemo(() => {
        const cash = paymentAccounts.find(a => a.name.toLowerCase().includes('cash'));
        return cash?.id || paymentAccounts[0]?.id;
    }, [paymentAccounts]);

    const [selectedAccountId, setSelectedAccountId] = React.useState(defaultAccountId);

    // Determine if selected account is a Bank account
    const isBankAccount = React.useMemo(() => {
        const acc = paymentAccounts.find(a => a.id === selectedAccountId);
        return acc ? acc.name.toLowerCase().includes('bank') : false;
    }, [selectedAccountId, paymentAccounts]);

    // Reset check payment if not bank
    React.useEffect(() => {
        if (!isBankAccount) {
            setIsCheckPayment(false);
        }
    }, [isBankAccount]);

    return (
        <form onSubmit={async (e) => {
            e.preventDefault();
            setIsSubmitting(true);
            const fd = new FormData(e.currentTarget);

            // Determine method based on account name
            let method = 'Cash';
            if (isCheckPayment) {
                method = 'Check';
            } else {
                const acc = paymentAccounts.find(a => a.id === selectedAccountId);
                if (acc) {
                    const name = acc.name.toLowerCase();
                    if (name.includes('bkash')) method = 'bKash';
                    else if (name.includes('nagad')) method = 'Nagad';
                    else if (name.includes('rocket')) method = 'Rocket';
                    else if (name.includes('bank')) method = 'Direct';
                }
            }

            const payload = {
                partnerId: partner.id,
                partnerType: isSupplier ? 'SUPPLIER' : 'VENDOR' as any,
                amount: Number(fd.get('amount')),
                accountId: selectedAccountId,
                method: method,
                checkDate: isCheckPayment ? (fd.get('checkDate') as string) : undefined,
                checkNo: isCheckPayment ? (fd.get('checkNo') as string) : undefined,
                description: fd.get('description') as string || undefined,
            };

            try {
                const res = await applyPartnerPayment(payload);
                if (res.success) {
                    toast({ title: 'Success', description: 'Payment applied successfully.' });
                    onSuccess();
                } else {
                    toast({ variant: 'destructive', title: 'Error', description: (res as any).message || 'Failed to apply payment' });
                }
            } catch (err: any) {
                toast({ variant: 'destructive', title: 'Error', description: err.message });
            } finally {
                setIsSubmitting(false);
            }
        }}>
            <div className="grid gap-4 py-4">
                <div className="space-y-2">
                    <Label>Amount (Tk)</Label>
                    <Input name="amount" type="number" step="0.01" required placeholder="Enter amount" />
                </div>
                <div className="space-y-2">
                    <Label>Paid From Account</Label>
                    <Select name="accountId" value={selectedAccountId} onValueChange={setSelectedAccountId} required>
                        <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                        <SelectContent>
                            {paymentAccounts.map(acc => (
                                <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>



                {/* Payment Check Toggle Container - Matching Staff UX Style */}
                {isBankAccount && (
                    <div className="rounded-lg border border-muted p-4 space-y-3 bg-muted/10 animate-in fade-in slide-in-from-top-2">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="payment-check"
                                checked={isCheckPayment}
                                onCheckedChange={(checked: any) => setIsCheckPayment(!!checked)}
                            />
                            <Label htmlFor="payment-check" className="cursor-pointer font-medium">Payment by Check</Label>
                        </div>

                        {isCheckPayment && (
                            <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                                <div className="space-y-2">
                                    <Label>Check/Ref No</Label>
                                    <Input name="checkNo" placeholder="Check/Ref number" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Check/Deposit Date</Label>
                                    <Input name="checkDate" type="date" required />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="space-y-2">
                    <Label>Description</Label>
                    <Input name="description" placeholder="Notes..." />
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</> : 'Apply Payment'}
                </Button>
            </DialogFooter>
        </form>
    );
}



import { Check } from 'lucide-react';

function PartnerPOModals({ partner, orders, isSupplier, poStatusColors }: { partner: any, orders: PurchaseOrder[], isSupplier: boolean, poStatusColors: any }) {
    // Helper to calculate financials for a single PO specific to this partner
    const getPOFinancials = (po: PurchaseOrder) => {
        let total = 0;
        let paid = 0;

        const steps = po.productionSteps || [];

        if (partner.supplierId && (po.supplierId === partner.supplierId || po.supplier === partner.name)) {
            // As Supplier
            if (po.type === 'general') {
                total = Number(po.total) || 0;
                // Only count cash and Passed checks
                paid = (po.payments || []).reduce((sum, p) => sum + (p.cash || 0) + ((p.checkStatus === 'Passed') ? (p.check || 0) : 0), 0);
            } else {
                // For 3-piece, Supplier gets Fabric step cost
                const fabricStep = steps.find((step) => normalizeStepType(step.stepType) === 'FABRIC');
                const cost = Number(fabricStep?.costAmount || 0) || Number(po.total) || 0;
                total = cost;

                // If internal supplier/fabric, it's considered paid/internal transfer, otherwise check actual payments
                const isInternal = po.hasInternalFabric || isInternalSupplierName(po.supplier);
                if (isInternal) {
                    paid = cost;
                } else {
                    // Filter payments for FABRIC step + any general purchase balance
                    const relevantPayments = (po.payments || []).filter(p => {
                        const pStep = p.productionStepId ? steps.find(s => s.id === p.productionStepId) : null;
                        const type = pStep?.stepType ? normalizeStepType(pStep.stepType) : normalizeStepType(p.paymentFor);
                        return type === 'FABRIC' || type === 'PURCHASE BALANCE (FIFO)' || type === 'GENERAL';
                    });
                    // Only count cash and Passed checks
                    paid = relevantPayments.reduce((sum, p) => sum + (p.cash || 0) + ((p.checkStatus === 'Passed') ? (p.check || 0) : 0), 0);
                }
            }
        }

        if (partner.vendorId) {
            // As Vendor
            const relevantSteps = steps.filter((step) => {
                if (normalizeStepType(step.stepType) === 'FABRIC') return false;
                return step.vendorId === partner.vendorId || step.vendor?.name === partner.name;
            });
            const relevantStepIds = new Set(relevantSteps.map((s) => s.id));

            total += relevantSteps.reduce((sum, step) => sum + (Number(step.costAmount) || 0), 0);

            // Count each payment at most once per PO (avoid double-counting across steps)
            const uniquePaymentIds = new Set<string>();
            const relevantPayments = (po.payments || []).filter((p) => {
                if (p.productionStepId && relevantStepIds.has(p.productionStepId)) return true;
                // Fallback for legacy vendor payments without productionStepId
                if (!p.productionStepId && p.vendorId === partner.vendorId) return true;
                return false;
            }).filter((p) => {
                if (!p.id) return true;
                if (uniquePaymentIds.has(p.id)) return false;
                uniquePaymentIds.add(p.id);
                return true;
            });

            // Only count cash and Passed checks
            paid += relevantPayments.reduce((s, p) => s + (p.cash || 0) + ((p.checkStatus === 'Passed') ? (p.check || 0) : 0), 0);
        }

        return { total, paid, due: Math.max(0, total - paid) };
    };

    const enrichedOrders = React.useMemo(() => {
        return orders.map(po => ({
            ...po,
            financials: getPOFinancials(po)
        })).filter(po => po.financials.total > 0); // Only show relevant POs
    }, [orders, partner, isSupplier]);

    const ongoing = enrichedOrders.filter(po => po.status !== 'Received' && po.status !== 'Cancelled');
    const history = enrichedOrders.filter(po => po.status === 'Received' || po.status === 'Cancelled');

    const POTable = ({ data }: { data: typeof enrichedOrders }) => (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>PO Number</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {data.map((po) => (
                    <TableRow key={po.id}>
                        <TableCell className="font-medium">
                            <Link href={`/dashboard/purchases/${po.id}`} className="text-blue-600 hover:underline">
                                {po.id}
                            </Link>
                        </TableCell>
                        <TableCell>{format(new Date(po.date), "MMM d, yyyy")}</TableCell>
                        <TableCell>
                            <Badge variant={'outline'} className={cn(poStatusColors[po.status])}>
                                {po.status}
                            </Badge>
                        </TableCell>
                        <TableCell className="text-right">Tk {po.financials.total.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-green-600">Tk {po.financials.paid.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-destructive font-semibold">
                            {po.financials.due > 0 ? `Tk ${po.financials.due.toLocaleString()}` : '-'}
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );

    return (
        <Card className="h-full flex flex-col">
            <CardHeader>
                <CardTitle>Purchase Orders</CardTitle>
                <CardDescription>Manage ongoing and past orders.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-4">
                <Dialog>
                    <DialogTrigger asChild>
                        <Button className="w-full h-16 text-lg justify-start px-6 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 transition-all shadow-md group">
                            <div className="bg-white/20 p-2 rounded-full mr-4 group-hover:scale-110 transition-transform">
                                <Loader2 className="h-6 w-6 text-white animate-spin-slow" />
                            </div>
                            <div className="flex flex-col items-start gap-0.5">
                                <span className="font-bold">Ongoing Orders</span>
                                <span className="text-xs font-normal opacity-90">{ongoing.length} Active Orders</span>
                            </div>
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden p-0">
                        <div className="flex-none p-6 pb-2">
                            <DialogHeader>
                                <DialogTitle>Ongoing Orders</DialogTitle>
                                <DialogDescription>Active purchase orders currently in production.</DialogDescription>
                            </DialogHeader>
                        </div>
                        <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
                            {ongoing.length > 0 ? <POTable data={ongoing} /> : <div className="text-center py-8 text-muted-foreground">No active orders</div>}
                        </div>
                    </DialogContent>
                </Dialog>

                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="outline" className="w-full h-16 text-lg justify-start px-6 border-2 hover:bg-muted/50 transition-all group">
                            <div className="bg-muted p-2 rounded-full mr-4 group-hover:bg-muted/80 transition-colors">
                                <Check className="h-6 w-6 text-muted-foreground group-hover:text-foreground" />
                            </div>
                            <div className="flex flex-col items-start gap-0.5">
                                <span className="font-bold text-foreground">Order History</span>
                                <span className="text-xs font-normal text-muted-foreground">{history.length} Completed Orders</span>
                            </div>
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden p-0">
                        <div className="flex-none p-6 pb-2">
                            <DialogHeader>
                                <DialogTitle>Order History</DialogTitle>
                                <DialogDescription>Past purchase orders that have been received or cancelled.</DialogDescription>
                            </DialogHeader>
                        </div>
                        <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
                            {history.length > 0 ? <POTable data={history} /> : <div className="text-center py-8 text-muted-foreground">No order history</div>}
                        </div>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
}
