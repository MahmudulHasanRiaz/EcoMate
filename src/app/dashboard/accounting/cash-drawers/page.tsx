'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { getCashDrawers, transferCash } from '@/services/cash-drawers';
import { CashDrawerBalanceInfo } from '@/server/modules/cash-drawers';
import { getLedgerEntries } from '@/services/accounting';
import type { LedgerEntry } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import { ArrowRightLeft, CreditCard, Download, History, Loader2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

const formatMoney = (value: number) =>
  `৳ ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ManagingCashDrawersPage() {
    const { toast } = useToast();
    
    // Drawers State
    const [drawers, setDrawers] = useState<CashDrawerBalanceInfo[]>([]);
    const [isLoadingDrawers, setIsLoadingDrawers] = useState(true);
    
    // Transfer State
    const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
    const [transferFrom, setTransferFrom] = useState('');
    const [transferTo, setTransferTo] = useState('');
    const [transferAmount, setTransferAmount] = useState('');
    const [transferNotes, setTransferNotes] = useState('');
    const [isTransferring, setIsTransferring] = useState(false);

    // History State
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
    const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const PAGE_SIZE = 50;

    const fetchDrawers = async () => {
        try {
            setIsLoadingDrawers(true);
            const data = await getCashDrawers();
            setDrawers(data);
            
            // Auto-select first active drawer if nothing selected
            if (!selectedAccountId && data.length > 0) {
                const active = data.filter(d => d.isActive);
                if (active.length > 0) setSelectedAccountId(active[0].accountId);
            }
        } catch (err: any) {
            toast({ title: 'Error loading drawers', description: err.message, variant: 'destructive' });
        } finally {
            setIsLoadingDrawers(false);
        }
    };

    useEffect(() => {
        fetchDrawers();
    }, []);

    // Fetch Ledger History
    useEffect(() => {
        let isActive = true;
        if (!selectedAccountId) return;

        setIsLoadingHistory(true);
        setLedgerEntries([]);
        setNextCursor(null);

        getLedgerEntries(selectedAccountId, dateRange, null, PAGE_SIZE)
            .then((pageData) => {
                if (!isActive) return;
                setLedgerEntries(pageData.entries || []);
                setNextCursor(pageData.nextCursor ?? null);
            })
            .catch((err) => {
                console.error('[LEDGER_ERROR]', err);
            })
            .finally(() => {
                if (isActive) setIsLoadingHistory(false);
            });

        return () => {
            isActive = false;
        };
    }, [selectedAccountId, dateRange]);

    const handleLoadMore = async () => {
        if (!nextCursor || isLoadingMore || !selectedAccountId) return;
        setIsLoadingMore(true);
        try {
            const pageData = await getLedgerEntries(selectedAccountId, dateRange, nextCursor, PAGE_SIZE);
            setLedgerEntries(prev => [...prev, ...(pageData.entries || [])]);
            setNextCursor(pageData.nextCursor ?? null);
        } finally {
            setIsLoadingMore(false);
        }
    };

    const handleTransfer = async () => {
        try {
            const amount = parseFloat(transferAmount);
            if (!transferFrom || !transferTo || isNaN(amount) || amount <= 0) {
                toast({ title: 'Invalid Input', description: 'Please fill all required fields correctly.', variant: 'destructive' });
                return;
            }
            setIsTransferring(true);
            await transferCash({
                fromDrawerId: transferFrom,
                toDrawerId: transferTo,
                amount,
                notes: transferNotes,
            });
            toast({ title: 'Transfer Successful', description: 'Funds have been moved.' });
            setIsTransferDialogOpen(false);
            setTransferFrom('');
            setTransferTo('');
            setTransferAmount('');
            setTransferNotes('');
            
            // Refresh drawers and history
            await fetchDrawers();
            if (transferFrom === selectedAccountId || transferTo === selectedAccountId) {
                // Force a minor re-render effect by triggering the fetch logic
                setLedgerEntries([...ledgerEntries]); // Just to keep UI stable while effect reruns soon
            }
        } catch (err: any) {
            toast({ title: 'Transfer Failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsTransferring(false);
        }
    };

    const runningBalance = useMemo(() => {
        if (ledgerEntries.length === 0) return [];
        // Cash Drawer implies Asset (Debit Normal)
        const entriesAsc = [...ledgerEntries].reverse();
        const balanceById = new Map<string, number>();
        let balance = 0;
        entriesAsc.forEach(entry => {
            const debit = entry.debit || 0;
            const credit = entry.credit || 0;
            balance += (debit - credit);
            balanceById.set(entry.id, balance);
        });

        return ledgerEntries.map(entry => ({
            ...entry,
            balance: balanceById.get(entry.id) ?? 0,
        }));
    }, [ledgerEntries]);

    const totalSystemBalance = drawers.reduce((sum, d) => sum + d.balance, 0);
    const selectedDrawerDetails = drawers.find(d => d.accountId === selectedAccountId);

    return (
        <div className="flex flex-1 flex-col gap-6 p-4 lg:p-8 max-w-[1600px] mx-auto w-full">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Cash Drawers</h1>
                    <p className="text-muted-foreground mt-1">Live balances and transaction history across all cash endpoints.</p>
                </div>
                
                <Dialog open={isTransferDialogOpen} onOpenChange={setIsTransferDialogOpen}>
                    <DialogTrigger asChild>
                        <Button size="lg" className="shadow-md" disabled={drawers.length < 2}>
                            <ArrowRightLeft className="mr-2 h-4 w-4" /> 
                            Transfer Funds
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Transfer Cash</DialogTitle>
                            <DialogDescription>Move funds securely between cash drawers.</DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label>From Drawer</Label>
                                <Select value={transferFrom} onValueChange={setTransferFrom}>
                                    <SelectTrigger><SelectValue placeholder="Source drawer" /></SelectTrigger>
                                    <SelectContent>
                                        {drawers.filter(d => d.isActive).map(d => (
                                            <SelectItem key={`from-${d.id}`} value={d.id}>
                                                {d.name} ({formatMoney(d.balance)})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>To Drawer</Label>
                                <Select value={transferTo} onValueChange={setTransferTo}>
                                    <SelectTrigger><SelectValue placeholder="Destination drawer" /></SelectTrigger>
                                    <SelectContent>
                                        {drawers.filter(d => d.isActive && d.id !== transferFrom).map(d => (
                                            <SelectItem key={`to-${d.id}`} value={d.id}>{d.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>Amount</Label>
                                <Input type="number" step="0.01" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} placeholder="0.00" />
                            </div>
                            <div className="grid gap-2">
                                <Label>Notes (Optional)</Label>
                                <Input placeholder="E.g. End of day cash shift" value={transferNotes} onChange={e => setTransferNotes(e.target.value)} />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsTransferDialogOpen(false)} disabled={isTransferring}>Cancel</Button>
                            <Button onClick={handleTransfer} disabled={isTransferring}>
                                {isTransferring && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Complete Transfer
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Live Balances Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-4">
                <Card className="bg-primary/5 border-primary/20 shadow-sm relative overflow-hidden">
                    <div className="absolute right-0 top-0 opacity-10 pt-4 pr-4"><CreditCard size={64}/></div>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase opacity-80">Total System Cash</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoadingDrawers ? <Skeleton className="h-10 w-32" /> : (
                            <div className="text-3xl font-bold tracking-tight text-primary">
                                {formatMoney(totalSystemBalance)}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {isLoadingDrawers ? (
                    [...Array(3)].map((_, i) => <Skeleton key={i} className="h-[120px] rounded-xl" />)
                ) : (
                    drawers.map(drawer => (
                        <Card 
                            key={drawer.id}
                            className={cn(
                                "cursor-pointer transition-all hover:border-primary/50 hover:shadow-md",
                                selectedAccountId === drawer.accountId ? "ring-2 ring-primary border-primary shadow-sm" : "border-border",
                                !drawer.isActive && "opacity-60"
                            )}
                            onClick={() => setSelectedAccountId(drawer.accountId)}
                        >
                            <CardHeader className="pb-2 flex flex-row items-center gap-2 justify-between">
                                <CardTitle className="text-sm font-medium">{drawer.name}</CardTitle>
                                {drawer.isDefault && <Badge variant="secondary" className="text-[10px]">Default</Badge>}
                                {!drawer.isActive && <Badge variant="outline" className="text-[10px] text-destructive">Inactive</Badge>}
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold font-mono">
                                    {formatMoney(drawer.balance)}
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>

            {/* Drawer History Section */}
            <Card className="flex-1 flex flex-col min-h-[500px] shadow-sm">
                <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between border-b bg-muted/20 pb-4 gap-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <History className="h-5 w-5 text-primary" />
                            <CardTitle className="text-xl">Transaction History</CardTitle>
                        </div>
                        <CardDescription className="mt-1">
                            {selectedDrawerDetails 
                                ? `Showing inflows and outflows for ${selectedDrawerDetails.name}` 
                                : 'Select a drawer to view its history'}
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <DateRangePicker date={dateRange} onDateChange={setDateRange} />
                    </div>
                </CardHeader>
                <CardContent className="p-0 flex-1 flex flex-col">
                    {!selectedAccountId ? (
                         <div className="flex-1 flex flex-col items-center justify-center p-12 text-muted-foreground">
                            <CreditCard className="h-12 w-12 mb-4 opacity-20" />
                            <p>Select a drawer above to view its transaction history.</p>
                         </div>
                    ) : (
                        <div className="overflow-auto flex-1">
                            <Table>
                                <TableHeader className="bg-muted/30 sticky top-0 backdrop-blur-sm">
                                    <TableRow>
                                        <TableHead className="w-[120px]">Date</TableHead>
                                        <TableHead>Type/Source</TableHead>
                                        <TableHead>Description</TableHead>
                                        <TableHead className="text-right">In (Debit)</TableHead>
                                        <TableHead className="text-right">Out (Credit)</TableHead>
                                        <TableHead className="text-right font-bold">Balance</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoadingHistory ? (
                                        [...Array(6)].map((_, i) => (
                                            <TableRow key={i}>
                                                <TableCell colSpan={6}><Skeleton className="h-12 w-full" /></TableCell>
                                            </TableRow>
                                        ))
                                    ) : runningBalance.length > 0 ? (
                                        runningBalance.map(entry => (
                                            <TableRow key={entry.id} className="hover:bg-muted/30 transition-colors">
                                                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                                    {format(new Date(entry.date), 'dd MMM yyyy')}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs">
                                                    <span className="bg-secondary/50 px-2 py-1 rounded-md">
                                                        {entry.sourceLabel || entry.sourceTransactionId || 'Manual'}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-sm font-medium">
                                                    {entry.description}
                                                    {entry.entryNumber && <p className="text-[10px] text-muted-foreground font-mono mt-0.5">#{entry.entryNumber}</p>}
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-green-600">
                                                    {entry.debit ? (
                                                        <div className="flex items-center justify-end gap-1">
                                                            <ArrowDownRight className="h-3 w-3" />
                                                            {formatMoney(entry.debit)}
                                                        </div>
                                                    ) : '-'}
                                                </TableCell>
                                                <TableCell className="text-right font-mono text-red-500">
                                                    {entry.credit ? (
                                                        <div className="flex items-center justify-end gap-1">
                                                            <ArrowUpRight className="h-3 w-3" />
                                                            {formatMoney(entry.credit)}
                                                        </div>
                                                    ) : '-'}
                                                </TableCell>
                                                <TableCell className={cn(
                                                    "text-right font-mono font-bold", 
                                                    entry.balance < 0 ? "text-red-500" : ""
                                                )}>
                                                    {formatMoney(entry.balance)}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                                                <div className="flex flex-col items-center justify-center gap-2">
                                                    <History className="h-8 w-8 opacity-20" />
                                                    <p>No transactions found for the selected period.</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                            {!isLoadingHistory && nextCursor && (
                                <div className="p-4 border-t flex justify-center bg-muted/10">
                                    <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
                                        {isLoadingMore ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…</> : 'Load older transitions'}
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
