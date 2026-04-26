'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { format, startOfDay, endOfDay } from 'date-fns';
import { DateRange } from 'react-day-picker';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { useToast } from '@/hooks/use-toast';

type Showroom = { id: string; name: string };
type StaffItem = { id: string; name: string };

type SalesReport = {
  orderCount: number;
  totalCollected: number;
  totalRefunded: number;
  netCollected: number;
  totalOrderValue: number;
  breakdown: { paymentMethod: string; amount: number }[];
  statusBreakdown: { status: string; count: number }[];
};

const money = (n: number) => `৳${(Number.isFinite(n) ? n : 0).toLocaleString('en-BD')}`;

export default function POSReportsClient({
  showrooms,
  staffList,
}: {
  showrooms: Showroom[];
  staffList: StaffItem[];
}) {
  const { toast } = useToast();

  const [selectedShowroomId, setSelectedShowroomId] = useState(showrooms[0]?.id || '');
  const [selectedStaffId, setSelectedStaffId] = useState('all');
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  });
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SalesReport | null>(null);

  const fetchReport = useCallback(async () => {
    if (!selectedShowroomId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        showroomId: selectedShowroomId,
        ...(dateRange?.from ? { from: dateRange.from.toISOString() } : {}),
        ...(dateRange?.to ? { to: dateRange.to.toISOString() } : {}),
        ...(selectedStaffId !== 'all' ? { staffId: selectedStaffId } : {}),
      });
      const res = await fetch(`/api/pos/reports/sales?${qs.toString()}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        toast({ title: 'Error', description: json?.message || 'Failed to load report', variant: 'destructive' });
        setReport(null);
        return;
      }
      setReport(json.data);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message || 'Failed', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [selectedShowroomId, selectedStaffId, dateRange, toast]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const showroomName = showrooms.find((s) => s.id === selectedShowroomId)?.name || '-';

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h2 className="text-2xl font-bold">POS Sales Report</h2>
        <p className="text-muted-foreground">View sales totals and breakdown for showroom POS transactions.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 md:flex-row md:items-end flex-wrap">
        <div className="space-y-1 max-w-xs">
          <Label>Showroom</Label>
          <Select value={selectedShowroomId} onValueChange={setSelectedShowroomId}>
            <SelectTrigger>
              <SelectValue placeholder="Select showroom" />
            </SelectTrigger>
            <SelectContent>
              {showrooms.map((sr) => (
                <SelectItem key={sr.id} value={sr.id}>
                  {sr.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 max-w-xs">
          <Label>Staff</Label>
          <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
            <SelectTrigger>
              <SelectValue placeholder="All Staff" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Staff</SelectItem>
              {staffList.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Date Range</Label>
          <DateRangePicker date={dateRange} onDateChange={setDateRange} />
        </div>

        <Button onClick={fetchReport} disabled={loading}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      {report && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Orders</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">{report.orderCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Total Collected</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums text-green-600">{money(report.totalCollected)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Refunded</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums text-red-500">{money(report.totalRefunded)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Net Collected</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">{money(report.netCollected)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Breakdown Tables */}
      {report && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">By Payment Method</CardTitle>
            </CardHeader>
            <CardContent>
              {report.breakdown.length === 0 ? (
                <p className="text-muted-foreground text-sm">No data</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-2 text-left font-medium">Method</th>
                        <th className="p-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.breakdown.map((b) => (
                        <tr key={b.paymentMethod} className="border-t">
                          <td className="p-2">{b.paymentMethod}</td>
                          <td className="p-2 text-right tabular-nums font-medium">{money(b.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">By Status</CardTitle>
            </CardHeader>
            <CardContent>
              {report.statusBreakdown.length === 0 ? (
                <p className="text-muted-foreground text-sm">No data</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-2 text-left font-medium">Status</th>
                        <th className="p-2 text-right font-medium">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.statusBreakdown.map((s) => (
                        <tr key={s.status} className="border-t">
                          <td className="p-2">{s.status}</td>
                          <td className="p-2 text-right tabular-nums font-medium">{s.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
