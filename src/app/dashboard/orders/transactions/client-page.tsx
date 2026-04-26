'use client';

import * as React from 'react';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, X, CreditCard, ExternalLink, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import Link from 'next/link';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
};

export function TransactionsClientPage() {
  const [status, setStatus] = React.useState('Pending');
  const { data, error, mutate, isLoading } = useSWR(`/api/orders/transactions?status=${status}`, fetcher);
  const { toast } = useToast();
  const [actionId, setActionId] = React.useState<string | null>(null);

  const transactions = data?.data || [];

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    try {
      setActionId(id);
      const res = await fetch(`/api/orders/transactions/${id}/${action}`, { method: 'POST' });
      const json = await res.json();
      
      if (!res.ok) throw new Error(json.error || `Failed to ${action}`);
      
      toast({ title: "Success", description: `Transaction ${action}d successfully.` });
      mutate();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Order Transactions</h1>
          <p className="text-muted-foreground mt-1">Review and verify non-COD payments (bKash, Bank, etc) before they enter the ledger.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" /> 
            Transactions
          </CardTitle>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filtered by Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Pending">Pending Verification</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="whitespace-nowrap">Order</TableHead>
                  <TableHead className="whitespace-nowrap">Date</TableHead>
                  <TableHead className="whitespace-nowrap">Method</TableHead>
                  <TableHead className="whitespace-nowrap">Type</TableHead>
                  <TableHead className="whitespace-nowrap">Reference</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Amount</TableHead>
                  <TableHead className="whitespace-nowrap">Account</TableHead>
                  <TableHead className="whitespace-nowrap">Creator</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-64 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground gap-2">
                        <Loader2 className="w-8 h-8 animate-spin text-primary/50" />
                        <p>Loading transactions...</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-64 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <CreditCard className="w-12 h-12 stroke-1 opacity-20 mb-2" />
                        <p>No {status.toLowerCase()} transactions found.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((tx: any) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        <div className="flex flex-col">
                          <Link href={`/dashboard/orders?search=${tx.Order.orderNumber}`} className="text-primary hover:underline flex items-center gap-1">
                            #{tx.Order.orderNumber}
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                          <span className="text-xs text-muted-foreground">{tx.Order.customerName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {format(new Date(tx.createdAt), 'dd MMM yyyy, hh:mm a')}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant="outline" className="font-mono text-xs shadow-sm bg-white">
                          {tx.paymentMethod}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={tx.paymentType === 'Advance' ? 'secondary' : 'default'} className="font-normal text-[10px] uppercase tracking-widest">
                          {tx.paymentType}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {tx.reference || '-'}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap font-bold">
                        ৳{tx.amount.toFixed(2)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-slate-600">
                        {tx.Account?.name || '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-slate-600">
                        {tx.StaffCreator?.name || 'System'}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {tx.status === 'Pending' ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 shadow-sm hover:text-green-600 hover:bg-green-50 border-green-200"
                              disabled={actionId === tx.id}
                              onClick={() => handleAction(tx.id, 'approve')}
                            >
                              {actionId === tx.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 mr-1" />}
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 shadow-sm hover:text-red-600 hover:bg-red-50 border-red-200"
                              disabled={actionId === tx.id}
                              onClick={() => handleAction(tx.id, 'reject')}
                            >
                              {actionId === tx.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4 mr-1" />}
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <Badge variant={tx.status === 'Approved' ? 'default' : 'destructive'} className={tx.status === 'Approved' ? 'bg-green-600' : ''}>
                            {tx.status}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
