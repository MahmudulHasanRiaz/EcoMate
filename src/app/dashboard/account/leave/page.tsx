'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { CalendarDays, Check, X, Clock, AlertCircle, Plus } from 'lucide-react';
import { fetchLeaveRequests, fetchLeaveTypes, fetchLeaveBalances, submitLeaveRequest, cancelLeaveRequest } from '@/services/leaves';
import type { LeaveRequestUI, LeaveBalanceUI, LeaveTypeUI } from '@/types';
import { useToast } from '@/hooks/use-toast';

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
  Pending: { label: 'Pending', variant: 'secondary', icon: <Clock className="h-3.5 w-3.5" /> },
  ManagerApproved: { label: 'Manager OK', variant: 'outline', icon: <Check className="h-3.5 w-3.5" /> },
  AdminApproved: { label: 'Approved', variant: 'default', icon: <Check className="h-3.5 w-3.5" /> },
  Rejected: { label: 'Rejected', variant: 'destructive', icon: <X className="h-3.5 w-3.5" /> },
  Cancelled: { label: 'Cancelled', variant: 'secondary', icon: <AlertCircle className="h-3.5 w-3.5" /> },
};

export default function MyLeavePage() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<LeaveRequestUI[]>([]);
  const [balances, setBalances] = useState<LeaveBalanceUI[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ leaveTypeId: '', fromDate: '', toDate: '', days: 1, reason: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [reqs, types, bals] = await Promise.all([
        fetchLeaveRequests(),
        fetchLeaveTypes(),
        fetchLeaveBalances(),
      ]);
      setRequests(reqs);
      setLeaveTypes(types);
      setBalances(bals);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSubmit = async () => {
    try {
      if (!form.leaveTypeId || !form.fromDate || !form.toDate || form.days < 1) {
        toast({ title: 'Error', description: 'Please fill all required fields', variant: 'destructive' });
        return;
      }
      await submitLeaveRequest(form);
      toast({ title: 'Success', description: 'Leave request submitted' });
      setDialogOpen(false);
      setForm({ leaveTypeId: '', fromDate: '', toDate: '', days: 1, reason: '' });
      loadData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Unknown error', variant: 'destructive' });
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelLeaveRequest(id);
      toast({ title: 'Success', description: 'Leave request cancelled' });
      loadData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Unknown error', variant: 'destructive' });
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Leave</h1>
          <p className="text-sm text-muted-foreground">View your leave balances and request time off</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-1 h-4 w-4" /> Request Leave</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Leave Request</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Leave Type</Label>
                <Select value={form.leaveTypeId} onValueChange={(v) => setForm((p) => ({ ...p, leaveTypeId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {leaveTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name} {t.isPaid ? '(Paid)' : '(Unpaid)'}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>From Date</Label>
                  <Input type="date" value={form.fromDate} onChange={(e) => setForm((p) => ({ ...p, fromDate: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>To Date</Label>
                  <Input type="date" value={form.toDate} onChange={(e) => setForm((p) => ({ ...p, toDate: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Number of Days</Label>
                <Input type="number" min="1" value={form.days} onChange={(e) => setForm((p) => ({ ...p, days: parseInt(e.target.value) || 1 }))} />
              </div>
              <div className="space-y-2">
                <Label>Reason (optional)</Label>
                <Textarea value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} placeholder="Enter reason for leave" />
              </div>
              <Button className="w-full" onClick={handleSubmit}>Submit Request</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {balances.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {balances.map((bal) => (
            <Card key={bal.leaveTypeId}>
              <CardContent className="pt-4">
                <div className="text-sm font-medium">{bal.leaveTypeName}</div>
                <div className="mt-1 text-2xl font-bold">{bal.remaining}</div>
                <div className="text-xs text-muted-foreground">
                  {bal.used} used of {bal.allocated + bal.carried} {bal.isPaid ? '(Paid)' : '(Unpaid)'}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            My Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-sm text-muted-foreground py-8">Loading...</p>
          ) : requests.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">No leave requests found</p>
          ) : (
            <>
              <div className="grid gap-4 md:hidden">
                {requests.map((req) => {
                  const sc = statusConfig[req.status] || statusConfig.Pending;
                  return (
                    <Card key={req.id} className="p-4 flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-sm font-medium">{req.leaveTypeName}</span>
                          {req.isPaid ? <Badge variant="outline" className="text-[10px]">Paid</Badge> : <Badge variant="secondary" className="text-[10px]">Unpaid</Badge>}
                        </div>
                        <Badge variant={sc.variant} className="gap-1 whitespace-nowrap">
                          {sc.icon} {sc.label}
                        </Badge>
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Dates:</span> {req.fromDate?.slice(0, 10)} to {req.toDate?.slice(0, 10)} ({req.days} days)
                      </div>
                      {req.reason && (
                        <div className="text-sm bg-muted/50 p-2 rounded-md">
                          <span className="text-muted-foreground text-xs block mb-1">Reason</span>
                          {req.reason}
                        </div>
                      )}
                      {req.status === 'Pending' && (
                        <div className="flex justify-end mt-2 pt-2 border-t">
                          <Button size="sm" variant="ghost" onClick={() => handleCancel(req.id)}>
                            Cancel Request
                          </Button>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 text-left font-medium">Type</th>
                      <th className="py-2 text-left font-medium">Dates</th>
                      <th className="py-2 text-left font-medium">Days</th>
                      <th className="py-2 text-left font-medium">Status</th>
                      <th className="py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((req) => {
                      const sc = statusConfig[req.status] || statusConfig.Pending;
                      return (
                        <tr key={req.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="py-3 pr-4 whitespace-nowrap">
                            <span className="font-medium">{req.leaveTypeName}</span>
                            {req.isPaid ? <Badge variant="outline" className="ml-2 text-xs">Paid</Badge> : <Badge variant="secondary" className="ml-2 text-xs">Unpaid</Badge>}
                            {req.reason && <div className="text-xs text-muted-foreground line-clamp-1 max-w-[200px]" title={req.reason}>{req.reason}</div>}
                          </td>
                          <td className="py-3 pr-4 text-xs whitespace-nowrap">
                            {req.fromDate?.slice(0, 10)} to {req.toDate?.slice(0, 10)}
                          </td>
                          <td className="py-3 pr-4">{req.days}</td>
                          <td className="py-3 pr-4 whitespace-nowrap">
                            <Badge variant={sc.variant} className="gap-1">
                              {sc.icon} {sc.label}
                            </Badge>
                          </td>
                          <td className="py-3 text-right whitespace-nowrap">
                            {req.status === 'Pending' && (
                              <Button size="sm" variant="ghost" onClick={() => handleCancel(req.id)}>Cancel</Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
