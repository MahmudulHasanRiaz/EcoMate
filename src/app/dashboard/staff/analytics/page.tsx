'use client';

import * as React from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { 
  format, 
  differenceInDays, 
  startOfDay, 
  endOfDay, 
  isWithinInterval,
  eachDayOfInterval,
  isSameDay
} from 'date-fns';
import { 
  Search, 
  Calendar as CalendarIcon, 
  CheckCircle2, 
  Clock, 
  TrendingUp, 
  DollarSign, 
  Target, 
  User,
  LayoutDashboard,
  Check,
  AlertCircle,
  Activity
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getStaffMembers } from '@/services/staff';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StaffCombobox } from '@/components/orders/staff-combobox';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { type DateRange } from 'react-day-picker';


// Types
interface AnalyticsResponse {
  staff: {
    id: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    commission?: any;
  };
  summary: {
    activeDays: number;
    presentDays: number;
    commission: {
      enabled: boolean;
      rates: {
        onOrderCreate: number;
        onOrderConfirm: number;
        onOrderPacked: number;
        onOrderConvert: number;
      };
      targetPeriod: string;
      targetCount: number;
      totalTasksWorked: number;
      excessTasks: number;
      deliveredEligibleTasks: number;
      finalCommissionable: number;
      finalBreakdown: { create: number; confirm: number; convert: number; packed: number };
    };
  };
  dailyStats: Record<string, { created: number; confirmed: number; converted: number; delivered: number; commissionable: number }>;
}

const fetchAnalytics = async (staffId: string, from: string, to: string) => {
  const res = await fetch(`/api/staff/analytics?staffId=${staffId}&dateFrom=${from}&dateTo=${to}`);
  if (!res.ok) throw new Error('Failed to fetch analytics');
  return res.json();
};

export default function StaffAnalyticsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [staffId, setStaffId] = React.useState<string | null>(null);
  const [allStaff, setAllStaff] = React.useState<any[]>([]);
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    getStaffMembers().then(res => setAllStaff(res.items));
  }, []);

  const { data, error: swrError, mutate } = useSWR(
    staffId && dateRange?.from && dateRange?.to 
      ? { staffId, from: format(dateRange.from, 'yyyy-MM-dd'), to: format(dateRange.to, 'yyyy-MM-dd') }
      : null,
    ({ staffId, from, to }) => fetchAnalytics(staffId, from, to)
  ) as { 
    data: AnalyticsResponse | undefined; 
    error: any; 
    mutate: () => void 
  };

  const handleSearch = (id: string) => {
    if (id) {
      setStaffId(id);
      // Default to last 30 days if no range selected
      if (!dateRange) {
        const to = new Date();
        const from = new Date();
        from.setDate(to.getDate() - 30);
        setDateRange({ from, to });
      }
    } else {
      setStaffId(null);
    }
  };

  const handleDateChange = (range: DateRange | undefined) => {
    setDateRange(range);
    if (range?.from && range?.to) {
      if (differenceInDays(range.to, range.from) > 31) {
        // In a real app, we'd show a toast. For now, just clamp or warn.
        // For simplicity, we just don't trigger if too large.
        return;
      }
      mutate();
    }
  };



  if (error || swrError) return <div className="p-8 text-destructive">Error loading analytics. Please try again.</div>;

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:gap-8 lg:p-6">
      {/* Header & Search */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff Performance Analytics</h1>
          <p className="text-muted-foreground">Deep dive into staff productivity and commission progress.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="w-full sm:w-[250px]">
            <StaffCombobox 
              value={staffId || ""} 
              onChange={handleSearch} 
              staffMembers={allStaff}
            />
          </div>

          <div className="w-full sm:w-auto">
            <DateRangePicker
              date={dateRange}
              onDateChange={handleDateChange}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {!staffId ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center py-20 space-y-4">
          <div className="p-4 bg-muted rounded-full">
            <User className="h-12 w-12 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">No Staff Selected</h2>
            <p className="text-muted-foreground max-w-xs">Please select a staff member to view their performance and commission analytics.</p>
          </div>
        </div>
      ) : !data ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="h-32">
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-4" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Overview Section */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Days</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.summary.activeDays} / {differenceInDays(dateRange!.to!, dateRange!.from!) + 1}</div>
                <p className="text-xs text-muted-foreground">Days with recorded actions</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Attendance</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.summary.presentDays}</div>
                <p className="text-xs text-muted-foreground">Days present</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Commission</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.summary.commission.enabled ? 'Enabled' : 'N/A'}</div>
                <p className="text-xs text-muted-foreground">
                  {data.summary.commission.enabled ? `Rates: C:${data.summary.commission.rates.onOrderCreate} | CF:${data.summary.commission.rates.onOrderConfirm} | CP:${data.summary.commission.rates.onOrderPacked} | CV:${data.summary.commission.rates.onOrderConvert}` : 'No commission set'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Commission Progress</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{data.summary.commission.finalCommissionable}</div>
                <p className="text-xs text-muted-foreground">
                  Final commissionable tasks
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Commission Detail Card */}
          {data.summary.commission.enabled && (
             <Card className="border-primary/20 bg-primary/5">
               <CardHeader>
                 <CardTitle>Commission Summary</CardTitle>
               </CardHeader>
               <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Total Tasks Worked</p>
                    <p className="text-2xl font-bold">{data.summary.commission.totalTasksWorked}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Target (Excess)</p>
                    <p className="text-2xl font-bold">{data.summary.commission.targetCount} ({data.summary.commission.excessTasks})</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Delivered Eligible</p>
                    <p className="text-2xl font-bold text-primary">{data.summary.commission.deliveredEligibleTasks}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Final Commissionable</p>
                    <p className="text-2xl font-bold text-blue-600">{data.summary.commission.finalCommissionable}</p>
                  </div>
                  
                  <div className="col-span-full pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-sm text-muted-foreground">Create: <span className="font-semibold text-foreground">{data.summary.commission.finalBreakdown.create}</span></div>
                    <div className="text-sm text-muted-foreground">Confirm: <span className="font-semibold text-foreground">{data.summary.commission.finalBreakdown.confirm}</span></div>
                    <div className="text-sm text-muted-foreground">Convert: <span className="font-semibold text-foreground">{data.summary.commission.finalBreakdown.convert}</span></div>
                    <div className="text-sm text-muted-foreground">Packed: <span className="font-semibold text-foreground">{data.summary.commission.finalBreakdown.packed}</span></div>
                  </div>
               </CardContent>
             </Card>
          )}


          {/* Daily Performance Grid */}
          <Card>
            <CardHeader>
              <CardTitle>Daily Performance Breakdown</CardTitle>
              <CardDescription>Detailed count of actions and deliveries for each day in the selected range.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-7">
                {eachDayOfInterval({ start: startOfDay(dateRange!.from!), end: endOfDay(dateRange!.to!) }).map((day) => {
                  const key = format(day, 'yyyy-MM-dd');
                  const stats = data.dailyStats[key] || { created: 0, confirmed: 0, converted: 0, delivered: 0, commissionable: 0 };
                  
                  return (
                    <div key={key} className="flex flex-col gap-2 p-3 rounded-lg border bg-card text-card-foreground shadow-sm">
                      <div className="text-center border-b pb-2 mb-1">
                        <div className="text-xs font-bold uppercase text-muted-foreground">{format(day, 'EEE')}</div>
                        <div className="text-lg font-bold">{format(day, 'd')}</div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">Created</span>
                          <span className="font-medium">{stats.created}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">Confirm</span>
                          <span className="font-medium">{stats.confirmed}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">Convert</span>
                          <span className="font-medium">{stats.converted}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] pt-1 border-t mt-1">
                          <span className="text-primary font-semibold">Deliver</span>
                          <span className="font-bold text-primary">{stats.delivered}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] pt-1 border-t mt-1">
                          <span className="text-blue-600 font-semibold">Comm. (Excess)</span>
                          <span className="font-bold text-blue-600">{stats.commissionable}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

        </div>
      )}
    </div>
  );
}
