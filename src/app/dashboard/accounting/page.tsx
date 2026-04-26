'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { DateRange } from 'react-day-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from 'next/link';
import { format } from 'date-fns';
import { getChartOfAccounts, getLedgerEntries, getBalanceSheet, postJournalEntry } from '@/services/accounting';
import type { Account, LedgerEntry, BalanceSheet } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import useSWR from 'swr';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const formatMoney = (value: number) =>
  `Tk ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function LedgerView() {
    const [accounts, setAccounts] = React.useState<Account[]>([]);
    const [ledgerEntries, setLedgerEntries] = React.useState<LedgerEntry[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isLoadingMore, setIsLoadingMore] = React.useState(false);
    const [nextCursor, setNextCursor] = React.useState<string | null>(null);
    const ALL_ACCOUNTS_VALUE = '__all__';
    const [selectedAccount, setSelectedAccount] = React.useState<string>(ALL_ACCOUNTS_VALUE);
    const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);
    const PAGE_SIZE = 50;
    
    React.useEffect(() => {
        let isActive = true;
        setIsLoading(true);
        setLedgerEntries([]);
        setNextCursor(null);
        const accountFilter = selectedAccount === ALL_ACCOUNTS_VALUE ? undefined : selectedAccount;
        Promise.all([
            getChartOfAccounts(),
            getLedgerEntries(accountFilter, dateRange, null, PAGE_SIZE)
        ]).then(([accountsData, pageData]) => {
            if (!isActive) return;
            setAccounts(accountsData);
            setLedgerEntries(pageData.entries || []);
            setNextCursor(pageData.nextCursor ?? null);
            setIsLoading(false);
        }).catch(() => {
            if (!isActive) return;
            setIsLoading(false);
        });
        return () => {
            isActive = false;
        };
    }, [selectedAccount, dateRange]);

    const handleLoadMore = async () => {
        if (!nextCursor || isLoadingMore) return;
        setIsLoadingMore(true);
        try {
            const accountFilter = selectedAccount === ALL_ACCOUNTS_VALUE ? undefined : selectedAccount;
            const pageData = await getLedgerEntries(accountFilter, dateRange, nextCursor, PAGE_SIZE);
            setLedgerEntries(prev => [...prev, ...(pageData.entries || [])]);
            setNextCursor(pageData.nextCursor ?? null);
        } finally {
            setIsLoadingMore(false);
        }
    };

    const isAllAccounts = selectedAccount === ALL_ACCOUNTS_VALUE;
    const currentAccount = isAllAccounts ? undefined : accounts.find(a => a.id === selectedAccount);

    const runningBalance = React.useMemo(() => {
        if (ledgerEntries.length === 0) return [];
        if (isAllAccounts || !currentAccount?.type) {
            return ledgerEntries.map(entry => ({ ...entry, balance: null }));
        }

        const isDebitNormal = currentAccount.type === 'Asset' || currentAccount.type === 'Expense';
        const entriesAsc = [...ledgerEntries].reverse();
        const balanceById = new Map<string, number>();
        let balance = 0;
        entriesAsc.forEach(entry => {
            const debit = entry.debit || 0;
            const credit = entry.credit || 0;
            const delta = isDebitNormal ? (debit - credit) : (credit - debit);
            balance += delta;
            balanceById.set(entry.id, balance);
        });

        return ledgerEntries.map(entry => ({
            ...entry,
            balance: balanceById.get(entry.id) ?? 0,
        }));
    }, [ledgerEntries, isAllAccounts, currentAccount?.type]);

    const fetcher = (url: string) => fetch(url).then(r => r.json());
    const { data: summaryData, isLoading: isSummaryLoading } = useSWR(
        `/api/accounting/account-summary?from=${dateRange?.from?.toISOString() || ''}&to=${dateRange?.to?.toISOString() || ''}`,
        fetcher
    );

    const renderTable = () => (
         <div className="space-y-4">
            <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Entry #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {isLoading ? (
                    [...Array(5)].map((_, i) => (
                        <TableRow key={i}>
                            <TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell>
                        </TableRow>
                    ))
                ) : runningBalance.length > 0 ? (
                    runningBalance.map(entry => {
                        const balanceValue = typeof entry.balance === 'number' ? entry.balance : null;
                        return (
                            <TableRow key={entry.id}>
                                <TableCell>{format(new Date(entry.date), 'PP')}</TableCell>
                                <TableCell className="font-mono">{entry.entryNumber || '-'}</TableCell>
                                <TableCell>{entry.description}</TableCell>
                                <TableCell className="font-mono">{entry.sourceLabel || entry.sourceTransactionId}</TableCell>
                                <TableCell className="text-right font-mono">{entry.debit ? formatMoney(entry.debit) : '-'}</TableCell>
                                <TableCell className="text-right font-mono text-red-500">{entry.credit ? formatMoney(entry.credit) : '-'}</TableCell>
                                <TableCell className={cn("text-right font-mono", balanceValue !== null && balanceValue < 0 ? "text-red-500" : "")}>
                                    {balanceValue === null ? '-' : formatMoney(balanceValue)}
                                </TableCell>
                            </TableRow>
                        );
                    })
                ) : (
                    <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center">
                            No entries found for the selected criteria.
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
        {!isLoading && nextCursor && (
            <div className="flex justify-center">
                <Button variant="outline" onClick={handleLoadMore} disabled={isLoadingMore}>
                    {isLoadingMore ? 'Loading…' : 'Load more'}
                </Button>
            </div>
        )}
    </div>
    );

    const renderCards = () => (
        <div className="space-y-4">
            {isLoading ? (
                [...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
            ) : runningBalance.length > 0 ? (
                runningBalance.map(entry => {
                    const balanceValue = typeof entry.balance === 'number' ? entry.balance : null;
                    return (
                        <Card key={entry.id}>
                            <CardContent className="p-4 space-y-3">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="font-semibold">{entry.description}</p>
                                        <p className="text-sm text-muted-foreground">{format(new Date(entry.date), 'PP')}</p>
                                        <p className="text-xs text-muted-foreground">Entry: {entry.entryNumber || '-'}</p>
                                        <p className="text-xs text-muted-foreground">Ref: {entry.sourceLabel || entry.sourceTransactionId}</p>
                                    </div>
                                    <div className={cn("text-right font-mono font-semibold", balanceValue !== null && balanceValue < 0 ? "text-red-500" : "")}>
                                        {balanceValue === null ? '-' : formatMoney(balanceValue)}
                                        <p className="text-xs font-normal">Balance</p>
                                    </div>
                                </div>
                                <Separator />
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="text-muted-foreground">Debit</p>
                                        <p className="font-mono">{entry.debit ? formatMoney(entry.debit) : '-'}</p>
                                    </div>
                                     <div className="text-right">
                                        <p className="text-muted-foreground">Credit</p>
                                        <p className="font-mono text-red-500">{entry.credit ? formatMoney(entry.credit) : '-'}</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })
            ) : (
                 <div className="h-24 text-center flex items-center justify-center">
                    No entries found for the selected criteria.
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
                    <Button
                        variant={selectedAccount === ALL_ACCOUNTS_VALUE ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedAccount(ALL_ACCOUNTS_VALUE)}
                        className="flex-shrink-0"
                    >
                        All Accounts
                    </Button>
                    {accounts.map(acc => (
                        <Button
                            key={acc.id}
                            variant={selectedAccount === acc.id ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSelectedAccount(acc.id)}
                            className="flex-shrink-0"
                        >
                            {acc.name}
                        </Button>
                    ))}
                </div>
                <div className="flex justify-end">
                    <DateRangePicker date={dateRange} onDateChange={setDateRange} />
                </div>
            </div>

            {/* Account Monitor MVP */}
            <Card>
                <CardHeader className="py-3">
                    <CardTitle className="text-sm">Account Monitor (Period Summary)</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/50">
                                <TableHead className="h-8 text-xs">Account</TableHead>
                                <TableHead className="h-8 text-xs text-right">Period Debit</TableHead>
                                <TableHead className="h-8 text-xs text-right">Period Credit</TableHead>
                                <TableHead className="h-8 text-xs text-right">Balance</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isSummaryLoading ? (
                                <TableRow>
                                    <TableCell colSpan={4}><Skeleton className="h-8 w-full" /></TableCell>
                                </TableRow>
                            ) : summaryData && Array.isArray(summaryData) ? (
                                (selectedAccount === ALL_ACCOUNTS_VALUE ? summaryData : summaryData.filter((s: any) => s.accountId === selectedAccount)).map((s: any) => {
                                    if (s.periodDebit === 0 && s.periodCredit === 0 && s.balance === 0 && selectedAccount === ALL_ACCOUNTS_VALUE) return null;
                                    return (
                                        <TableRow key={s.accountId}>
                                            <TableCell className="py-2 text-xs font-medium">{s.name}</TableCell>
                                            <TableCell className="py-2 text-xs text-right font-mono">{s.periodDebit ? formatMoney(s.periodDebit) : '-'}</TableCell>
                                            <TableCell className="py-2 text-xs text-right font-mono text-red-500">{s.periodCredit ? formatMoney(s.periodCredit) : '-'}</TableCell>
                                            <TableCell className={cn("py-2 text-xs text-right font-mono", s.balance < 0 ? "text-red-500" : "text-green-600")}>
                                                {formatMoney(s.balance)}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            ) : null}
                            {(!summaryData || summaryData.length === 0) && !isSummaryLoading && (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-12 text-center text-xs text-muted-foreground italic">
                                        No data available.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>General Ledger: {isAllAccounts ? 'All Accounts' : (currentAccount?.name || 'N/A')}</CardTitle>
                    <CardDescription>
                        Detailed transaction history for the selected account and date range.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                   <div className="hidden sm:block">
                       {renderTable()}
                   </div>
                   <div className="sm:hidden">
                       {renderCards()}
                   </div>
                </CardContent>
            </Card>
        </div>
    );
}

function BalanceSheetView() {
    const [balanceSheet, setBalanceSheet] = React.useState<BalanceSheet | null>(null);
    const [date, setDate] = React.useState(new Date());
    const [isLoading, setIsLoading] = React.useState(true);

    React.useEffect(() => {
        setIsLoading(true);
        getBalanceSheet(date).then(data => {
            setBalanceSheet(data);
            setIsLoading(false);
        });
    }, [date]);

    if (isLoading || !balanceSheet) {
        return (
            <div className="space-y-4">
                 <Skeleton className="h-96 w-full" />
            </div>
        )
    }

    const { assets, liabilities, equity } = balanceSheet;

    return (
         <Card>
            <CardHeader>
                <CardTitle>Balance Sheet</CardTitle>
                <CardDescription>As of {format(date, 'MMMM d, yyyy')}</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Assets */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold border-b pb-2">Assets</h3>
                        {assets.accounts.map(acc => (
                            <div key={acc.id} className="flex justify-between text-sm">
                                <span>{acc.name}</span>
                                <span className="font-mono">{formatMoney(acc.balance)}</span>
                            </div>
                        ))}
                         <Separator />
                         <div className="flex justify-between font-bold">
                            <span>Total Assets</span>
                            <span className="font-mono">{formatMoney(assets.total)}</span>
                        </div>
                    </div>
                    {/* Liabilities and Equity */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-semibold border-b pb-2">Liabilities & Equity</h3>
                        <h4 className="font-medium text-muted-foreground">Liabilities</h4>
                         {liabilities.accounts.map(acc => (
                            <div key={acc.id} className="flex justify-between text-sm">
                                <span>{acc.name}</span>
                                <span className="font-mono">{formatMoney(acc.balance)}</span>
                            </div>
                        ))}
                        <div className="flex justify-between font-semibold">
                            <span>Total Liabilities</span>
                            <span className="font-mono">{formatMoney(liabilities.total)}</span>
                        </div>
                        
                        <Separator className="my-4" />

                        <h4 className="font-medium text-muted-foreground">Equity</h4>
                          {equity.accounts.map(acc => (
                            <div key={acc.id} className="flex justify-between text-sm">
                                <span>{acc.name}</span>
                                <span className="font-mono">{formatMoney(acc.balance)}</span>
                            </div>
                        ))}
                         <div className="flex justify-between font-semibold">
                            <span>Total Equity</span>
                            <span className="font-mono">{formatMoney(equity.total)}</span>
                        </div>
                        <Separator />
                         <div className="flex justify-between font-bold">
                            <span>Total Liabilities & Equity</span>
                            <span className="font-mono">{formatMoney(liabilities.total + equity.total)}</span>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

type JournalRow = {
    id: number;
    accountId: string;
    debit: number;
    credit: number;
};

function JournalEntryView() {
    const { toast } = useToast();
    const [accounts, setAccounts] = React.useState<Account[]>([]);
    const [date, setDate] = React.useState(format(new Date(), 'yyyy-MM-dd'));
    const [description, setDescription] = React.useState('');
    const [isPosting, setIsPosting] = React.useState(false);
    const [rows, setRows] = React.useState<JournalRow[]>([
        { id: Date.now(), accountId: '', debit: 0, credit: 0 },
        { id: Date.now() + 1, accountId: '', debit: 0, credit: 0 },
    ]);

    React.useEffect(() => {
        getChartOfAccounts().then(setAccounts);
    }, []);

    const handleRowChange = (id: number, field: keyof Omit<JournalRow, 'id'>, value: string | number) => {
        setRows(rows.map(row => row.id === id ? { ...row, [field]: value } : row));
    };

    const addRow = () => {
        setRows([...rows, { id: Date.now(), accountId: '', debit: 0, credit: 0 }]);
    };
    
    const removeRow = (id: number) => {
        if (rows.length > 2) {
            setRows(rows.filter(row => row.id !== id));
        }
    };

    const totals = React.useMemo(() => {
        return rows.reduce((acc, row) => ({
            debit: acc.debit + Number(row.debit || 0),
            credit: acc.credit + Number(row.credit || 0),
        }), { debit: 0, credit: 0 });
    }, [rows]);

    const isBalanced = totals.debit > 0 && Math.abs(totals.debit - totals.credit) <= 0.01;
    
    const handlePostEntry = async () => {
        if (!isBalanced) {
            toast({
                variant: 'destructive',
                title: "Unbalanced Entry",
                description: "Total debits must equal total credits and cannot be zero.",
            });
            return;
        }
        try {
            setIsPosting(true);
            await postJournalEntry({
                date,
                description,
                entries: rows.map((row) => ({
                    accountId: row.accountId,
                    debit: Number(row.debit || 0),
                    credit: Number(row.credit || 0),
                })),
            });
            toast({
                title: "Journal Entry Posted",
                description: "The transaction has been successfully recorded.",
            });
            setDescription('');
            setRows([
                { id: Date.now(), accountId: '', debit: 0, credit: 0 },
                { id: Date.now() + 1, accountId: '', debit: 0, credit: 0 },
            ]);
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: "Failed to post entry",
                description: error?.message || 'Something went wrong.',
            });
        } finally {
            setIsPosting(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Manual Journal Entry</CardTitle>
                <CardDescription>
                    Record transactions that aren&apos;t automatically captured, like bank transfers or owner&apos;s drawings.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="entry-date">Date</Label>
                        <Input id="entry-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="entry-description">Description</Label>
                        <Input id="entry-description" value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g., Owner's drawing for personal use" />
                    </div>
                </div>
                 <div className="w-full overflow-x-auto">
                    {/* For larger screens */}
                    <Table className="hidden sm:table">
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[40%]">Account</TableHead>
                                <TableHead className="text-right">Debit</TableHead>
                                <TableHead className="text-right">Credit</TableHead>
                                <TableHead><span className="sr-only">Remove</span></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row, index) => (
                                <TableRow key={row.id}>
                                    <TableCell>
                                        <Select value={row.accountId} onValueChange={(value) => handleRowChange(row.id, 'accountId', value)}>
                                            <SelectTrigger><SelectValue placeholder="Select Account" /></SelectTrigger>
                                            <SelectContent>
                                                {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </TableCell>
                                    <TableCell>
                                        <Input type="number" placeholder="0.00" className="text-right" value={row.debit || ''} onChange={e => handleRowChange(row.id, 'debit', e.target.valueAsNumber || 0)} disabled={!!row.credit}/>
                                    </TableCell>
                                     <TableCell>
                                        <Input type="number" placeholder="0.00" className="text-right" value={row.credit || ''} onChange={e => handleRowChange(row.id, 'credit', e.target.valueAsNumber || 0)} disabled={!!row.debit}/>
                                    </TableCell>
                                    <TableCell>
                                        {rows.length > 2 && <Button variant="ghost" size="icon" onClick={() => removeRow(row.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                     {/* For smaller screens */}
                    <div className="sm:hidden space-y-4">
                        {rows.map((row, index) => (
                            <Card key={row.id}>
                                <CardContent className="p-4 space-y-4">
                                    <div className="flex justify-between items-center">
                                        <Label>Entry #{index + 1}</Label>
                                         {rows.length > 2 && <Button variant="ghost" size="icon" onClick={() => removeRow(row.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Account</Label>
                                        <Select value={row.accountId} onValueChange={(value) => handleRowChange(row.id, 'accountId', value)}>
                                            <SelectTrigger><SelectValue placeholder="Select Account" /></SelectTrigger>
                                            <SelectContent>
                                                {accounts.map(acc => <SelectItem key={acc.id} value={acc.id}>{acc.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                         <div className="space-y-2">
                                             <Label>Debit</Label>
                                            <Input type="number" placeholder="0.00" value={row.debit || ''} onChange={e => handleRowChange(row.id, 'debit', e.target.valueAsNumber || 0)} disabled={!!row.credit}/>
                                        </div>
                                         <div className="space-y-2">
                                            <Label>Credit</Label>
                                            <Input type="number" placeholder="0.00" value={row.credit || ''} onChange={e => handleRowChange(row.id, 'credit', e.target.valueAsNumber || 0)} disabled={!!row.debit}/>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <Button variant="outline" size="sm" onClick={addRow}><PlusCircle className="mr-2 h-4 w-4" /> Add Row</Button>
                    <div className="flex items-center gap-4 text-sm font-medium">
                        <div className="text-right">
                            <p className="text-muted-foreground">Total Debits:</p>
                            <p className="font-mono">{formatMoney(totals.debit)}</p>
                        </div>
                        <div className="text-right">
                             <p className="text-muted-foreground">Total Credits:</p>
                            <p className="font-mono">{formatMoney(totals.credit)}</p>
                        </div>
                        <div className={cn("text-right", isBalanced ? 'text-green-600' : 'text-destructive')}>
                             <p>Difference:</p>
                            <p className="font-mono">{formatMoney(totals.debit - totals.credit)}</p>
                        </div>
                    </div>
                </div>
                 <Separator />
                 <div className="flex justify-end">
                    <Button onClick={handlePostEntry} disabled={!isBalanced || isPosting}>
                        {isPosting ? 'Posting...' : 'Post Entry'}
                    </Button>
                 </div>
            </CardContent>
        </Card>
    );
}

export default function AccountingPage() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold font-headline">Accounting</h1>
                    <p className="text-muted-foreground">Manage your chart of accounts, journal entries, and financial reports.</p>
                </div>
                <Button variant="outline" asChild>
                    <Link href="/dashboard/check-passing">Go to Check Passing</Link>
                </Button>
            </div>
             <Tabs defaultValue="entry">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="entry">Journal Entry</TabsTrigger>
                    <TabsTrigger value="ledger">General Ledger</TabsTrigger>
                    <TabsTrigger value="sheet">Balance Sheet</TabsTrigger>
                </TabsList>
                 <TabsContent value="entry" className="mt-6">
                    <JournalEntryView />
                </TabsContent>
                <TabsContent value="ledger" className="mt-6">
                    <LedgerView />
                </TabsContent>
                <TabsContent value="sheet" className="mt-6">
                    <BalanceSheetView />
                </TabsContent>
            </Tabs>
        </div>
    );
}
