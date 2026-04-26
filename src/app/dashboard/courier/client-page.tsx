'use client';

import * as React from 'react';
import useSWR from 'swr';
import { DateRange } from 'react-day-picker';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Plus,
  Upload,
  Loader2,
  Package,
  DollarSign,
  ArrowUpRight,
  ArrowDownLeft,
  AlertCircle,
  CreditCard,
  Truck,
  Wallet
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from '@/hooks/use-toast';
import { getBusinesses } from '@/services/partners';
import { getChartOfAccounts } from '@/services/accounting';
import {
  bulkUpdateCourierCharges,
  createCourierPayment,
  getCourierMetrics,
  getCourierPayments,
  getReturnPendingOrders,
  importCourierInvoice,
  getCourierInvoices,
  getCourierInvoice,
  retryCourierInvoiceItem
} from '@/services/courier-management';
import type { Account, Business, CourierPayment, CourierMetrics, ReturnPendingOrder, CourierInvoice } from '@/types';

type CourierManagementClientPageProps = {
  courierService?: string;
};

type ChargeRow = {
  orderNumber: string;
  actualCodAmount: string;
  courierCodCharge: string;
  courierDeliveryCharge: string;
};

const courierOptions = ['Steadfast', 'Carrybee', 'Pathao'];

const formatAmount = (value: number) => `BDT ${value.toFixed(2)}`;

function MetricCard({
  title,
  value,
  helper,
  icon: Icon,
}: {
  title: string;
  value: string;
  helper?: string;
  icon?: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          {title}
        </CardTitle>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {helper ? <p className="text-xs text-muted-foreground mt-1">{helper}</p> : null}
      </CardContent>
    </Card>
  );
}

function PaymentDialog({
  open,
  onOpenChange,
  businessOptions,
  accounts,
  courierService,
  activeBusinessId,
  onSaved,
  direction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessOptions: Business[];
  accounts: Account[];
  courierService?: string;
  activeBusinessId?: string;
  onSaved: () => void;
  direction: 'Received' | 'Paid';
}) {
  const { toast } = useToast();
  const isPayablePayment = direction === 'Paid';
  const assetAccounts = React.useMemo(
    () => accounts.filter((account) => account.type === 'Asset'),
    [accounts]
  );
  const defaultAccountId = React.useMemo(() => {
    const cashAccount = assetAccounts.find((account) => account.name.toLowerCase() === 'cash');
    return cashAccount?.id || assetAccounts[0]?.id || '';
  }, [assetAccounts]);
  const [isSaving, setIsSaving] = React.useState(false);
  const [paymentData, setPaymentData] = React.useState({
    businessId: activeBusinessId || '',
    courierService: courierService || '',
    amount: '',
    paymentDate: format(new Date(), 'yyyy-MM-dd'),
    referenceNo: '',
    note: '',
    receivedAccountId: '',
  });

  React.useEffect(() => {
    if (open) {
      setPaymentData((prev) => ({
        ...prev,
        businessId: activeBusinessId || prev.businessId,
        courierService: courierService || prev.courierService,
        receivedAccountId: prev.receivedAccountId || defaultAccountId,
      }));
    }
  }, [open, activeBusinessId, courierService, defaultAccountId]);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await createCourierPayment({
        businessId: paymentData.businessId,
        courierService: paymentData.courierService,
        amount: Number(paymentData.amount || 0),
        paymentDate: paymentData.paymentDate,
        referenceNo: paymentData.referenceNo || undefined,
        note: paymentData.note || undefined,
        receivedAccountId: paymentData.receivedAccountId || undefined,
        direction,
      });
      toast({
        title: isPayablePayment ? 'Payment sent' : 'Payment saved',
        description: isPayablePayment
          ? 'Courier payable settlement recorded.'
          : 'Courier payment entry added.',
      });
      onOpenChange(false);
      onSaved();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: isPayablePayment ? 'Failed to record payment' : 'Failed to save payment',
        description: error?.message || 'Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isPayablePayment ? 'Pay Courier Charges' : 'Add Courier Payment'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Business</Label>
              <Select
                value={paymentData.businessId}
                onValueChange={(value) => setPaymentData((prev) => ({ ...prev, businessId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select business" />
                </SelectTrigger>
                <SelectContent>
                  {businessOptions.map((biz) => (
                    <SelectItem key={biz.id} value={biz.id}>
                      {biz.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Courier</Label>
              <Select
                value={paymentData.courierService}
                onValueChange={(value) => setPaymentData((prev) => ({ ...prev, courierService: value }))}
                disabled={Boolean(courierService)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select courier" />
                </SelectTrigger>
                <SelectContent>
                  {courierOptions.map((courier) => (
                    <SelectItem key={courier} value={courier}>
                      {courier}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={paymentData.amount}
                onChange={(event) => setPaymentData((prev) => ({ ...prev, amount: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Date</Label>
              <Input
                type="date"
                value={paymentData.paymentDate}
                onChange={(event) => setPaymentData((prev) => ({ ...prev, paymentDate: event.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{isPayablePayment ? 'Paid From Account' : 'Received To Account'}</Label>
            <Select
              value={paymentData.receivedAccountId}
              onValueChange={(value) => setPaymentData((prev) => ({ ...prev, receivedAccountId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {assetAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Reference</Label>
              <Input
                value={paymentData.referenceNo}
                onChange={(event) => setPaymentData((prev) => ({ ...prev, referenceNo: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Note</Label>
              <Input
                value={paymentData.note}
                onChange={(event) => setPaymentData((prev) => ({ ...prev, note: event.target.value }))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={isSaving || !paymentData.businessId || !paymentData.courierService}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkChargeDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<ChargeRow[]>([
    { orderNumber: '', actualCodAmount: '', courierCodCharge: '', courierDeliveryCharge: '' },
  ]);
  const [isSaving, setIsSaving] = React.useState(false);

  const updateRow = (index: number, key: keyof ChargeRow, value: string) => {
    setRows((prev) => prev.map((row, idx) => (idx === index ? { ...row, [key]: value } : row)));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { orderNumber: '', actualCodAmount: '', courierCodCharge: '', courierDeliveryCharge: '' },
    ]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, idx) => idx !== index));
  };

  const parseCsvText = (text: string) => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return [];

    const header = lines[0].toLowerCase();
    const hasHeader = header.includes('order') || header.includes('cod') || header.includes('delivery');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map((line) => {
      const [orderNumber, codCharge, deliveryCharge, actualCodAmount] = line.split(',').map((val) => val.trim());
      return {
        orderNumber: orderNumber || '',
        courierCodCharge: codCharge || '',
        courierDeliveryCharge: deliveryCharge || '',
        actualCodAmount: actualCodAmount || '',
      };
    });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsvText(text);
    if (!parsed.length) {
      toast({ variant: 'destructive', title: 'Invalid CSV', description: 'No rows found.' });
      return;
    }
    setRows(parsed);
  };

  const toOptionalNumber = (value: string) => {
    if (!value.trim()) return undefined;
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  };

  const handleSave = async () => {
    const payload = rows
      .map((row) => ({
        orderNumber: row.orderNumber.trim() || undefined,
        actualCodAmount: toOptionalNumber(row.actualCodAmount),
        courierCodCharge: toOptionalNumber(row.courierCodCharge),
        courierDeliveryCharge: toOptionalNumber(row.courierDeliveryCharge),
      }))
      .filter((row) => row.orderNumber);

    if (!payload.length) {
      toast({ variant: 'destructive', title: 'Missing orders', description: 'Add at least one order number.' });
      return;
    }

    try {
      setIsSaving(true);
      const result = await bulkUpdateCourierCharges(payload);
      const failures = result.results.filter((item) => !item.ok);
      if (failures.length) {
        toast({
          variant: 'destructive',
          title: 'Some updates failed',
          description: `${failures.length} rows failed. Please check order numbers.`,
        });
      } else {
        toast({ title: 'Charges updated', description: 'Courier charges updated successfully.' });
      }
      onOpenChange(false);
      onSaved();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Failed to update charges',
        description: error?.message || 'Please try again.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bulk Update Courier Charges</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" asChild>
              <Label className="cursor-pointer inline-flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Upload CSV
                <Input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
              </Label>
            </Button>
            <p className="text-sm text-muted-foreground">
              CSV columns: orderNumber, codCharge, deliveryCharge, actualCodAmount
            </p>
          </div>
          <Separator />
          <div className="max-h-80 overflow-y-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order Number</TableHead>
                  <TableHead>Actual COD</TableHead>
                  <TableHead>COD Charge</TableHead>
                  <TableHead>Delivery Charge</TableHead>
                  <TableHead className="w-16 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={`${row.orderNumber}-${index}`}>
                    <TableCell>
                      <Input
                        value={row.orderNumber}
                        onChange={(event) => updateRow(index, 'orderNumber', event.target.value)}
                        placeholder="Order No"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.actualCodAmount}
                        onChange={(event) => updateRow(index, 'actualCodAmount', event.target.value)}
                        placeholder="0.00"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.courierCodCharge}
                        onChange={(event) => updateRow(index, 'courierCodCharge', event.target.value)}
                        placeholder="0.00"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.courierDeliveryCharge}
                        onChange={(event) => updateRow(index, 'courierDeliveryCharge', event.target.value)}
                        placeholder="0.00"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => removeRow(index)} disabled={rows.length === 1}>
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button variant="outline" onClick={addRow}>
            Add Row
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Separate component for Return Pending Orders to handle Load More logic
function ReturnPendingList({
  courierService,
  businessId,
  from,
  to
}: {
  courierService?: string;
  businessId?: string;
  from?: string;
  to?: string
}) {
  const [orders, setOrders] = React.useState<ReturnPendingOrder[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);

  // Initial fetch
  React.useEffect(() => {
    let active = true;
    setIsLoading(true);
    getReturnPendingOrders({
      courierService,
      businessId,
      from,
      to,
      pageSize: 10
    }).then((data) => {
      if (active) {
        const res = (data as any) || {};
        setOrders(res.items || []);
        setNextCursor(res.nextCursor || null);
        setHasMore(!!res.nextCursor);
        setIsLoading(false);
      }
    }).catch(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, [courierService, businessId, from, to]);

  const handleLoadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const data: any = await getReturnPendingOrders({
        courierService,
        businessId,
        from,
        to,
        pageSize: 10,
        cursor: nextCursor
      });
      if (data.items?.length) {
        setOrders(prev => [...prev, ...data.items]);
        setNextCursor(data.nextCursor || null);
        setHasMore(!!data.nextCursor);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading return pending orders...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Return Pending Parcels</CardTitle>
        <CardDescription>Parcels marked as Return Pending (COD excluded from expected).</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Business</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dispatched</TableHead>
              <TableHead className="text-right">COD</TableHead>
              <TableHead className="text-right">Delivery Charge</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length > 0 ? (
              orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium text-purple-600">
                    {order.orderNumber || order.id}
                  </TableCell>
                  <TableCell>{order.customerName || '-'}</TableCell>
                  <TableCell>{order.businessName || order.businessId || '-'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{order.courierStatus || '-'}</Badge>
                  </TableCell>
                  <TableCell>
                    {order.courierDispatchedAt ? format(new Date(order.courierDispatchedAt), 'PP') : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatAmount(Number(order.actualCodAmount || 0))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatAmount(Number(order.courierDeliveryCharge || 0))}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No return pending parcels in this range.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {hasMore && (
          <div className="flex justify-center mt-4 border-t pt-4">
            <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
              {isLoadingMore ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</> : "Load More Returns"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InvoicesTab({
  onBulkUpdateClick,
  courierService,
  businessId,
  from,
  to,
  accounts = []
}: {
  courierService?: string;
  businessId?: string;
  from?: string;
  to?: string;
  onBulkUpdateClick?: () => void;
  accounts?: Account[];
}) {
  const { toast } = useToast();
  const [invoices, setInvoices] = React.useState<CourierInvoice[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isImportOpen, setIsImportOpen] = React.useState(false);

  // Import Dialog State
  const [selectedCourier, setSelectedCourier] = React.useState<string>(courierService || '');
  const [file, setFile] = React.useState<File | null>(null);
  const [allowMismatchDiscount, setAllowMismatchDiscount] = React.useState(false);
  const [createPayments, setCreatePayments] = React.useState(false);
  const [overwriteInvoice, setOverwriteInvoice] = React.useState(false);
  const [isImporting, setIsImporting] = React.useState(false);
  const [importResult, setImportResult] = React.useState<any>(null);

  // Pathao Specific State
  const [invoiceNumber, setInvoiceNumber] = React.useState('');
  const [invoiceDate, setInvoiceDate] = React.useState(format(new Date(), 'yyyy-MM-dd'));
  const [payoutAccountId, setPayoutAccountId] = React.useState('');

  const assetAccounts = React.useMemo(
    () => accounts.filter((account) => account.type === 'Asset'),
    [accounts]
  );

  // Detail State
  const [selectedInvoiceId, setSelectedInvoiceId] = React.useState<string | null>(null);
  const [mismatchItems, setMismatchItems] = React.useState<any[]>([]);
  const [isLoadingMismatches, setIsLoadingMismatches] = React.useState(false);
  const [retryingItemId, setRetryingItemId] = React.useState<string | null>(null);

  const fetchInvoices = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getCourierInvoices({ courierService, from, to });
      setInvoices(data);
    } catch (error) {
       console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [courierService, from, to]);

  React.useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const handlePreview = React.useCallback(async (selectedFile?: File) => {
    if (!selectedCourier) {
      toast({ variant: 'destructive', title: 'Select courier first' });
      return;
    }
    const isPathao = selectedCourier.toLowerCase() === 'pathao';
    if (isPathao && (!invoiceNumber || !invoiceDate || !payoutAccountId)) {
       return;
    }

    const fileToUse = selectedFile || file;
    if (!fileToUse) return;
    
    setIsImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', fileToUse);
      formData.append('allowMismatchDiscount', String(allowMismatchDiscount));
      formData.append('createPayments', String(createPayments));
      formData.append('overwriteInvoice', String(overwriteInvoice));
      formData.append('preview', 'true');
      formData.append('courierService', selectedCourier);

      if (isPathao) {
        formData.append('invoiceNumber', invoiceNumber);
        formData.append('invoiceDate', invoiceDate);
        formData.append('payoutAccountId', payoutAccountId);
      }

      const result = await importCourierInvoice(formData);
      setImportResult(result);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Preview failed', description: error.message });
    } finally {
      setIsImporting(false);
    }
  }, [file, allowMismatchDiscount, createPayments, overwriteInvoice, selectedCourier, invoiceNumber, invoiceDate, payoutAccountId, toast]);

  const handleConfirmImport = React.useCallback(async () => {
    if (!selectedCourier) {
      toast({ variant: 'destructive', title: 'Select courier first' });
      return;
    }
    const isPathao = selectedCourier.toLowerCase() === 'pathao';
    if (isPathao && (!invoiceNumber || !invoiceDate || !payoutAccountId)) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Invoice Number, Date, and Payout Account are required for Pathao.' });
      return;
    }

    if (!file) return;
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('allowMismatchDiscount', String(allowMismatchDiscount));
      formData.append('createPayments', String(createPayments));
      formData.append('overwriteInvoice', String(overwriteInvoice));
      formData.append('preview', 'false');
      formData.append('courierService', selectedCourier);

      if (isPathao) {
        formData.append('invoiceNumber', invoiceNumber);
        formData.append('invoiceDate', invoiceDate);
        formData.append('payoutAccountId', payoutAccountId);
      }

      const result = await importCourierInvoice(formData);
      setImportResult(result);
      fetchInvoices();
      toast({ title: 'Invoice imported successfully' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Import failed', description: error.message });
    } finally {
      setIsImporting(false);
    }
  }, [file, allowMismatchDiscount, createPayments, overwriteInvoice, selectedCourier, invoiceNumber, invoiceDate, payoutAccountId, fetchInvoices, toast]);

  const handleViewMismatches = async (id: string) => {
    setSelectedInvoiceId(id);
    setIsLoadingMismatches(true);
    setMismatchItems([]);
    try {
      const data = await getCourierInvoice(id);
      const mismatches = (data.items || []).filter((item: any) => item.mismatchReason);
      setMismatchItems(mismatches);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to load mismatches', description: e.message });
    } finally {
      setIsLoadingMismatches(false);
    }
  };

  const handleRetryItem = async (invoiceId: string, itemId: string) => {
    setRetryingItemId(itemId);
    try {
      const result = await retryCourierInvoiceItem(invoiceId, itemId);
      if (result.ok) {
        toast({ title: 'Success', description: result.message });
        const data = await getCourierInvoice(invoiceId);
        setMismatchItems((data.items || []).filter((item: any) => item.mismatchReason));
        fetchInvoices();
      } else {
        toast({ variant: 'destructive', title: 'Retry failed', description: result.message });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setRetryingItemId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-medium">Courier Invoices</h2>
          <p className="text-sm text-muted-foreground">Manage and import statements</p>
        </div>
        <Button onClick={() => setIsImportOpen(true)}>
          <Upload className="mr-2 h-4 w-4" /> Import CSV
        </Button>
      </div>

      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="advanced" className="border rounded-md px-4">
          <AccordionTrigger className="py-2 text-sm hover:no-underline">
            Advanced Tools (Legacy)
          </AccordionTrigger>
          <AccordionContent className="pt-2 pb-4">
            <div className="flex items-center justify-between bg-muted/30 p-4 rounded-md">
              <div>
                <p className="text-sm font-medium">Bulk Update Courier Charges</p>
                <p className="text-xs text-muted-foreground">Manually override charges for multiple orders via manual entry or CSV.</p>
              </div>
              <Button variant="outline" size="sm" onClick={onBulkUpdateClick}>
                Open Bulk Update
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <DialogContent className={cn(
          "flex flex-col p-0 overflow-hidden",
          importResult?.isPreview ? "sm:max-w-5xl h-[95vh] sm:h-[90vh]" : "sm:max-w-2xl max-h-[90vh]"
        )}>
          <DialogHeader className="p-6 pb-2">
            <DialogTitle>Import Courier Invoice</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2 space-y-4">
            <div className="space-y-2">
              <Label>Select Courier</Label>
              <Select 
                value={selectedCourier} 
                onValueChange={(val) => {
                  setSelectedCourier(val);
                  if (importResult) setImportResult(null);
                  if (file) setFile(null);
                }}
                disabled={Boolean(courierService) || isImporting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a courier..." />
                </SelectTrigger>
                <SelectContent>
                  {courierOptions.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {selectedCourier.toLowerCase() === 'pathao' && (
              <div className="bg-muted/50 p-4 rounded-md space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Invoice Number</Label>
                    <Input 
                      placeholder="e.g. INV-12345"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Invoice Date</Label>
                    <Input 
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Payout Received Account</Label>
                  <Select value={payoutAccountId} onValueChange={setPayoutAccountId}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select account..." />
                    </SelectTrigger>
                    <SelectContent>
                      {assetAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>CSV File</Label>
              <Input 
                type="file" 
                accept=".csv" 
                disabled={!selectedCourier || isImporting || (selectedCourier.toLowerCase() === 'pathao' && (!invoiceNumber || !invoiceDate || !payoutAccountId))}
                onChange={(e) => {
                  const selectedFile = e.target.files?.[0] || null;
                  setFile(selectedFile);
                  if (selectedFile) {
                    handlePreview(selectedFile);
                  } else {
                    setImportResult(null);
                  }
                }} 
              />
              {!selectedCourier && <p className="text-[10px] text-amber-600">Please select a courier first.</p>}
              {selectedCourier.toLowerCase() === 'pathao' && (!invoiceNumber || !invoiceDate || !payoutAccountId) && (
                <p className="text-[10px] text-amber-600">Please fill all fields above to enable file upload.</p>
              )}
              {isImporting && !importResult && (
                <div className="flex items-center text-sm text-muted-foreground mt-2">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing CSV...
                </div>
              )}
            </div>

            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="advanced" className="border-none">
                <AccordionTrigger className="py-2 text-sm hover:no-underline">
                  Advanced Options
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pt-2">
                  <div className="flex items-center space-x-2">
                    <Input type="checkbox" id="mismatch" checked={allowMismatchDiscount} onChange={(e) => setAllowMismatchDiscount(e.target.checked)} className="w-4 h-4" />
                    <Label htmlFor="mismatch" className="text-xs font-normal">Accept Due Mismatch as Discount (updates order totals)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Input type="checkbox" id="payments" checked={createPayments} onChange={(e) => setCreatePayments(e.target.checked)} className="w-4 h-4" />
                    <Label htmlFor="payments" className="text-xs font-normal">Create Payment Entries automatically</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Input type="checkbox" id="overwrite" checked={overwriteInvoice} onChange={(e) => setOverwriteInvoice(e.target.checked)} className="w-4 h-4" />
                    <Label htmlFor="overwrite" className="text-xs font-normal">Overwrite existing invoice details if numbers clash</Label>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {importResult && (
              <div className="mt-4 space-y-4">
                <div className={`p-4 border rounded-md ${importResult.mismatchRows > 0 && !allowMismatchDiscount ? 'bg-red-50 border-red-200' : 'bg-muted/50'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-sm uppercase tracking-wide">
                      {importResult.isPreview ? 'Preview Analysis' : 'Import Results'}
                    </h3>
                    {importResult.isPreview && importResult.mismatchRows > 0 && !allowMismatchDiscount && (
                      <Badge variant="destructive" className="animate-pulse text-[10px] h-5">Action Required</Badge>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 mb-2">
                    <div><span className="text-muted-foreground text-[10px] uppercase tracking-wider">Valid Rows</span><p className="text-lg font-bold">{importResult.matchedRows}</p></div>
                    <div><span className="text-muted-foreground text-[10px] uppercase tracking-wider">Mismatched</span><p className={`text-lg font-bold ${importResult.mismatchRows > 0 ? 'text-red-600' : ''}`}>{importResult.mismatchRows}</p></div>
                    <div><span className="text-muted-foreground text-[10px] uppercase tracking-wider">Total Rows</span><p className="text-lg font-bold">{importResult.totalRows}</p></div>
                  </div>

                  {importResult.isPreview && importResult.mismatchRows > 0 && (
                    <p className="text-xs text-red-600 mt-2 flex items-center bg-white/50 p-2 rounded border border-red-100 italic">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      {allowMismatchDiscount 
                        ? "Mismatches will be adjusted as discounts upon import." 
                        : "Fix mismatches in CSV or enable 'Accept Due Mismatch' in Advanced Options to proceed."}
                    </p>
                  )}
                </div>

                {importResult.isPreview && importResult.items && (
                  <div className="border rounded-md overflow-hidden bg-white">
                    <div className="max-h-[350px] overflow-y-auto">
                      <Table>
                        <TableHeader className="bg-muted/50 sticky top-0 z-10">
                          <TableRow>
                            <TableHead className="whitespace-nowrap">Order #</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Due (Sys)</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Coll (Inv)</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Mismatch</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Total Charge (Inv)</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Exp Billed</TableHead>
                            <TableHead className="text-right whitespace-nowrap">Billed (Inv)</TableHead>
                            <TableHead>Status / Issue</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importResult.items.map((item: any, idx: number) => {
                            const hasDueMismatch = Math.abs(item.dueMismatchAmount || 0) > 0.01;
                            const hasBillingMismatch = Math.abs(item.billingMismatchAmount || 0) > 0.01;
                            
                            return (
                              <TableRow key={idx} className={item.mismatchReason ? "bg-red-50/50" : item.warningReason ? "bg-amber-50/30" : ""}>
                                <TableCell className="font-medium">{item.orderNumber || 'N/A'}</TableCell>
                                <TableCell className="text-right">{formatAmount(item.due || 0)}</TableCell>
                                <TableCell className="text-right">{formatAmount(item.raw?.collectableAmount || 0)}</TableCell>
                                <TableCell className={`text-right ${hasDueMismatch ? "text-red-600 font-bold" : ""}`}>
                                  {hasDueMismatch ? formatAmount(item.dueMismatchAmount) : '-'}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex flex-col items-end">
                                    <span className="font-medium">{formatAmount(item.invoiceCharge || 0)}</span>
                                    {Math.abs(item.chargeMismatchAmount || 0) > 0.01 && (
                                      <span className="text-[9px] text-amber-600 flex items-center leading-none mt-1" title={`Config expected: ${item.configCharge?.toFixed(2)}`}>
                                        <AlertCircle className="h-2 w-2 mr-1" />
                                        Rate Mismatch
                                      </span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">{formatAmount(item.expectedBilling || 0)}</TableCell>
                                <TableCell className={`text-right ${hasBillingMismatch ? "text-red-600 font-bold" : ""}`}>
                                  {formatAmount(item.raw?.billingAmount || 0)}
                                </TableCell>
                                <TableCell className="text-xs max-w-[200px]">
                                  {item.mismatchReason ? (
                                    <div className="flex items-center text-red-600 font-medium">
                                      <AlertCircle className="h-3 w-3 mr-1 shrink-0" />
                                      <span className="truncate" title={item.mismatchReason}>{item.mismatchReason}</span>
                                    </div>
                                  ) : item.warningReason ? (
                                    <div className="flex items-center text-amber-700">
                                      <AlertCircle className="h-3 w-3 mr-1 shrink-0" />
                                      <span className="truncate" title={item.warningReason}>{item.warningReason}</span>
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {!importResult.isPreview && importResult.errors?.length > 0 && (
                  <div className="max-h-40 overflow-y-auto w-full text-sm border p-2 bg-white rounded">
                    <p className="font-bold text-red-500">Errors found ({importResult.errors.length}):</p>
                    <ul className="list-disc pl-5">
                      {importResult.errors.slice(0, 50).map((err: any, i: number) => (
                        <li key={i}>{err.orderNumber || 'Unknown'}: {err.reason}</li>
                      ))}
                      {importResult.errors.length > 50 && <li>...and {importResult.errors.length - 50} more.</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="p-6 pt-2 border-t mt-0">
            {importResult?.isPreview ? (
              <div className="flex w-full justify-between items-center gap-4">
                <Button variant="outline" size="sm" onClick={() => { setImportResult(null); setFile(null); }}>Clear & Restart</Button>
                <div className="flex space-x-2">
                  <Button 
                    size="sm"
                    onClick={handleConfirmImport} 
                    disabled={isImporting || (importResult.mismatchRows > 0 && !allowMismatchDiscount)}
                  >
                    {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} 
                    Confirm & Import
                  </Button>
                </div>
              </div>
            ) : importResult && !importResult.isPreview ? (
              <Button variant="outline" className="w-full" onClick={() => { setIsImportOpen(false); setImportResult(null); setFile(null); }}>
                Done & Close
              </Button>
            ) : (
                <div className="text-xs text-muted-foreground">
                  Select a CSV to start analyzing...
                </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>Collection</TableHead>
                <TableHead>Charges</TableHead>
                <TableHead>Billed</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : invoices.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">No invoices found for this criteria.</TableCell></TableRow>
              ) : (
                invoices.map(inv => (
                  <React.Fragment key={inv.id}>
                    <TableRow>
                      <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                      <TableCell>{inv.invoiceDate ? format(new Date(inv.invoiceDate), 'PP') : '-'}</TableCell>
                      <TableCell>{inv.matchedRows} / {inv.totalRows}</TableCell>
                      <TableCell>{formatAmount(inv.totalCollected)}</TableCell>
                      <TableCell>{formatAmount(inv.totalFee)}</TableCell>
                      <TableCell>{formatAmount(inv.totalBilled)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => handleViewMismatches(inv.id)}>
                          View Mismatches
                        </Button>
                      </TableCell>
                    </TableRow>
                    {selectedInvoiceId === inv.id && (
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                         <TableCell colSpan={7} className="p-4">
                           <div className="flex justify-between items-center mb-2">
                             <h4 className="font-semibold text-sm">Invoice Mismatches & Issues</h4>
                             <Button variant="ghost" size="sm" onClick={() => setSelectedInvoiceId(null)}>Close</Button>
                           </div>
                           {isLoadingMismatches ? <div className="text-sm">Loading mismatches...</div> : (
                             mismatchItems.length === 0 ? <div className="text-sm">No mismatches found. This invoice is fully reconciled.</div> : (
                               <div className="max-h-80 overflow-y-auto">
                                 <Table>
                                    <TableHeader className="bg-muted">
                                       <TableRow>
                                         <TableHead>Order #</TableHead>
                                         <TableHead className="text-right">Invoice Coll</TableHead>
                                         <TableHead className="text-right">Fee</TableHead>
                                         <TableHead className="text-right">Net Billed</TableHead>
                                         <TableHead>Mismatch Reason</TableHead>
                                         <TableHead className="text-right">Action</TableHead>
                                       </TableRow>
                                    </TableHeader>
                                    <TableBody className="bg-white">
                                       {mismatchItems.map(item => (
                                         <TableRow key={item.id}>
                                            <TableCell className="font-medium underline decoration-dotted">{item.orderNumber || item.consignmentId}</TableCell>
                                            <TableCell className="text-right">{formatAmount(item.collectableAmount || 0)}</TableCell>
                                            <TableCell className="text-right">{formatAmount(item.totalFee || 0)}</TableCell>
                                            <TableCell className="text-right font-semibold">{formatAmount(item.billingAmount || 0)}</TableCell>
                                            <TableCell className="text-xs text-red-600 font-medium">
                                              <div className="flex items-center">
                                                <AlertCircle className="h-3 w-3 mr-1 shrink-0" />
                                                {item.mismatchReason}
                                              </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                              <Button 
                                                size="sm" 
                                                variant="outline" 
                                                className="h-8 py-0"
                                                disabled={retryingItemId === item.id}
                                                onClick={() => handleRetryItem(inv.id, item.id)}
                                              >
                                                {retryingItemId === item.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                                Retry
                                              </Button>
                                            </TableCell>
                                         </TableRow>
                                       ))}
                                    </TableBody>
                                 </Table>
                               </div>
                             )
                           )}
                         </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CourierManagementClientPage({ courierService }: CourierManagementClientPageProps) {
  const { toast } = useToast();
  const [businessId, setBusinessId] = React.useState<string>('all');
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);
  const [isPaymentOpen, setIsPaymentOpen] = React.useState(false);
  const [isPayableOpen, setIsPayableOpen] = React.useState(false);
  const [isBulkOpen, setIsBulkOpen] = React.useState(false);

  const { data: businesses } = useSWR<Business[]>('businesses', getBusinesses, {
    revalidateOnFocus: false,
  });
  const { data: accounts } = useSWR<Account[]>('chart-of-accounts', getChartOfAccounts, {
    revalidateOnFocus: false,
  });

  const from = dateRange?.from ? dateRange.from.toISOString() : undefined;
  const to = dateRange?.to ? dateRange.to.toISOString() : undefined;
  const activeBusinessId = businessId !== 'all' ? businessId : undefined;

  const metricsKey = ['courier-metrics', courierService || 'all', activeBusinessId || 'all', from, to];
  const paymentsKey = ['courier-payments', courierService || 'all', activeBusinessId || 'all', from, to];

  const {
    data: metricsData,
    isLoading: metricsLoading,
    mutate: mutateMetrics,
  } = useSWR<{ metrics: CourierMetrics; returnPendingOrders: ReturnPendingOrder[] }>(
    metricsKey,
    () =>
      getCourierMetrics({
        courierService,
        businessId: activeBusinessId,
        from,
        to,
      }),
    {
      onError: (error) => {
        toast({
          variant: 'destructive',
          title: 'Failed to load metrics',
          description: error?.message || 'Please refresh.',
        });
      },
    }
  );

  const {
    data: payments,
    isLoading: paymentsLoading,
    mutate: mutatePayments,
  } = useSWR<CourierPayment[]>(
    paymentsKey,
    () =>
      getCourierPayments({
        courierService,
        businessId: activeBusinessId,
        from,
        to,
      }),
    {
      onError: (error) => {
        toast({
          variant: 'destructive',
          title: 'Failed to load payments',
          description: error?.message || 'Please refresh.',
        });
      },
    }
  );

  const metrics = metricsData?.metrics;
  const title = courierService ? `${courierService} Courier` : 'Courier Management';

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold font-headline">{title}</h1>
          <p className="text-muted-foreground">
            Reconcile courier COD, charges, and payments.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setIsPayableOpen(true)}>
            <ArrowUpRight className="mr-2 h-4 w-4" />
            Pay Courier
          </Button>
          <Button onClick={() => setIsPaymentOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Payment
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end bg-muted/40 p-4 rounded-lg">
        <div className="space-y-2 flex-grow">
          <Label>Business Filter</Label>
          <Select value={businessId} onValueChange={setBusinessId}>
            <SelectTrigger className="w-full lg:w-60">
              <SelectValue placeholder="Select business" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Businesses</SelectItem>
              {businesses?.map((biz) => (
                <SelectItem key={biz.id} value={biz.id}>
                  {biz.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 flex-grow">
          <Label>Date Range Filter</Label>
          <DateRangePicker date={dateRange} onDateChange={setDateRange} />
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="invoices">Invoices & Reconciliation</TabsTrigger>
          <TabsTrigger value="payments">Payments History</TabsTrigger>
          <TabsTrigger value="returns">Pending Returns</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="mt-4">
          <InvoicesTab 
            courierService={courierService} 
            businessId={activeBusinessId} 
            from={from} 
            to={to} 
            onBulkUpdateClick={() => setIsBulkOpen(true)} 
            accounts={accounts || []}
          />
        </TabsContent>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {metricsLoading || !metrics ? (
              Array.from({ length: 8 }).map((_, idx) => <Skeleton key={idx} className="h-24 w-full" />)
            ) : (
              <>
                <MetricCard title="Total Parcels" value={`${metrics.totalParcels}`} icon={Package} />
                <MetricCard title="Total COD Sent" value={formatAmount(metrics.totalCodSent)} icon={Truck} helper="Amount sent to courier" />
                <MetricCard title="Total Charges" value={formatAmount(metrics.totalCharges)} icon={CreditCard} helper="Delivery & COD charges" />
                <MetricCard title="Expected Payment" value={formatAmount(metrics.expectedPayment)} icon={Wallet} helper="COD - Charges" />

                <MetricCard title="Received Payment" value={formatAmount(metrics.receivedPayment)} icon={ArrowDownLeft} />
                <MetricCard title="Pending Payment" value={formatAmount(metrics.pendingPayment)} icon={AlertCircle} helper="To be received" />
                <MetricCard
                  title="Return Pending"
                  value={`${metrics.returnPendingCount}`}
                  icon={ArrowUpRight}
                  helper={`COD Value: ${formatAmount(metrics.returnPendingCod)}`}
                />
                <MetricCard title="Return Charges" value={formatAmount(metrics.returnCharges)} icon={DollarSign} helper="Charges for returns" />
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
              <CardDescription>Manual payment entries from courier settlements.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Business</TableHead>
                    <TableHead>Courier</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentsLoading ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ) : payments && payments.length ? (
                    payments.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>{format(new Date(payment.paymentDate), 'PP')}</TableCell>
                        <TableCell>{payment.businessName || payment.businessId}</TableCell>
                        <TableCell>{payment.courierService}</TableCell>
                        <TableCell>
                          <Badge variant={payment.direction === 'Paid' ? 'secondary' : 'default'}>
                            {payment.direction || 'Received'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatAmount(payment.amount)}</TableCell>
                        <TableCell>{payment.referenceNo || '-'}</TableCell>
                        <TableCell>{payment.note || '-'}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No payments recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="returns">
          <ReturnPendingList
            courierService={courierService}
            businessId={activeBusinessId}
            from={from}
            to={to}
          />
        </TabsContent>
      </Tabs>

      <PaymentDialog
        open={isPaymentOpen}
        onOpenChange={setIsPaymentOpen}
        businessOptions={businesses || []}
        accounts={accounts || []}
        courierService={courierService}
        activeBusinessId={activeBusinessId}
        onSaved={() => {
          mutatePayments();
          mutateMetrics();
        }}
        direction="Received"
      />

      <PaymentDialog
        open={isPayableOpen}
        onOpenChange={setIsPayableOpen}
        businessOptions={businesses || []}
        accounts={accounts || []}
        courierService={courierService}
        activeBusinessId={activeBusinessId}
        onSaved={() => {
          mutatePayments();
          mutateMetrics();
        }}
        direction="Paid"
      />

      <BulkChargeDialog
        open={isBulkOpen}
        onOpenChange={setIsBulkOpen}
        onSaved={() => mutateMetrics()}
      />
    </div>
  );
}
