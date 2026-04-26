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
import { CalendarDays, Check, X, Clock, AlertCircle } from 'lucide-react';
import { fetchLeaveRequests, fetchLeaveTypes, fetchLeaveBalances, approveLeaveRequest, rejectLeaveRequest } from '@/services/leaves';
import { getCurrentStaff } from '@/services/staff';
import type { LeaveRequestUI, LeaveBalanceUI, LeaveTypeUI, LeaveRequestStatus } from '@/types';
import { useToast } from '@/hooks/use-toast';

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }> = {
  Pending: { label: 'Pending', variant: 'secondary', icon: <Clock className="h-3.5 w-3.5" /> },
  ManagerApproved: { label: 'Manager OK', variant: 'outline', icon: <Check className="h-3.5 w-3.5" /> },
  AdminApproved: { label: 'Approved', variant: 'default', icon: <Check className="h-3.5 w-3.5" /> },
  Rejected: { label: 'Rejected', variant: 'destructive', icon: <X className="h-3.5 w-3.5" /> },
  Cancelled: { label: 'Cancelled', variant: 'secondary', icon: <AlertCircle className="h-3.5 w-3.5" /> },
};

export default function LeavesPage() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<LeaveRequestUI[]>([]);
  const [balances, setBalances] = useState<LeaveBalanceUI[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [reqs, types, bals, auth] = await Promise.all([
        fetchLeaveRequests(),
        fetchLeaveTypes(),
        fetchLeaveBalances(),
        getCurrentStaff()
      ]);
      setRequests(reqs);
      setLeaveTypes(types);
      setBalances(bals);
      if (auth && auth.status === 'ok') {
        setRole(auth.staff.role);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Unknown error', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);



  const handleApprove = async (id: string) => {
    try {
      await approveLeaveRequest(id);
      toast({ title: 'Success', description: 'Leave request approved' });
      loadData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Unknown error', variant: 'destructive' });
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectLeaveRequest(id);
      toast({ title: 'Success', description: 'Leave request rejected' });
      loadData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Unknown error', variant: 'destructive' });
    }
  };



  if (!loading && role !== 'Admin' && role !== 'Manager') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-lg rounded-2xl border bg-gradient-to-b from-muted/40 via-background to-background p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Access restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You do not have permission to view Leave Management.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leave Management</h1>
          <p className="text-sm text-muted-foreground">Review and manage leave requests</p>
        </div>
      </div>

      {/* Leave Requests */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Leave Requests
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
                        <div>
                          <div className="font-semibold">{req.staffName}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-sm font-medium">{req.leaveTypeName}</span>
                            {req.isPaid ? <Badge variant="outline" className="text-[10px]">Paid</Badge> : <Badge variant="secondary" className="text-[10px]">Unpaid</Badge>}
                          </div>
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
                      {(req.status === 'Pending' || req.status === 'ManagerApproved') && (
                        <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t">
                          <Button size="sm" variant="outline" className="flex-1" onClick={() => handleApprove(req.id)}>
                            <Check className="h-4 w-4 mr-2" /> Approve
                          </Button>
                          <Button size="sm" variant="destructive" className="flex-1" onClick={() => handleReject(req.id)}>
                            <X className="h-4 w-4 mr-2" /> Reject
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
                      <th className="py-2 text-left font-medium">Staff</th>
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
                          <td className="py-3 pr-4">
                            <div className="font-medium whitespace-nowrap">{req.staffName}</div>
                            {req.reason && <div className="text-xs text-muted-foreground line-clamp-1 max-w-[200px]" title={req.reason}>{req.reason}</div>}
                          </td>
                          <td className="py-3 pr-4 whitespace-nowrap">
                            <span className="text-sm">{req.leaveTypeName}</span>
                            {req.isPaid ? <Badge variant="outline" className="ml-2 text-xs">Paid</Badge> : <Badge variant="secondary" className="ml-2 text-xs">Unpaid</Badge>}
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
                          <td className="py-3 text-right space-x-2 whitespace-nowrap">
                            {(req.status === 'Pending' || req.status === 'ManagerApproved') && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => handleApprove(req.id)}>
                                  <Check className="h-3.5 w-3.5 mr-1" /> Approve
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => handleReject(req.id)}>
                                  <X className="h-3.5 w-3.5 mr-1" /> Reject
                                </Button>
                              </>
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
