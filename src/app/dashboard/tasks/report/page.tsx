'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar as CalendarIcon, ArrowLeft } from 'lucide-react';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { getStaffMembers } from '@/services/staff';
import { usePermissions } from '@/hooks/use-permissions';
import { useUser } from '@clerk/nextjs';
import { StaffRole } from '@prisma/client';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import useSWR from 'swr';

export default function TaskReportPage() {
    const { user } = useUser();
    const role = user?.publicMetadata?.role as StaffRole | undefined;
    const currentStaffId = user?.publicMetadata?.staffId as string | undefined;

    const isManager = role && ([
        StaffRole.Admin,
        StaffRole.Manager,
        StaffRole.CallCentreManager,
        StaffRole.CourierManager,
        StaffRole.FinanceManager
    ] as StaffRole[]).includes(role);

    const [date, setDate] = React.useState<{ from: Date; to: Date }>({
        from: startOfMonth(new Date()),
        to: endOfMonth(new Date())
    });

    const [staffId, setStaffId] = React.useState<string>('all');
    const [staffList, setStaffList] = React.useState<{ id: string; name: string }[]>([]);

    React.useEffect(() => {
        if (isManager) {
            getStaffMembers().then(res => setStaffList(res.items.map((s: any) => ({ id: s.id, name: s.name }))));
        }
    }, [isManager]);

    // Force staffId to current user if not manager
    React.useEffect(() => {
        if (role && !isManager && currentStaffId) {
            setStaffId(currentStaffId);
        }
    }, [role, isManager, currentStaffId]);

    const fetchUrl = `/api/tasks/report?from=${date.from.toISOString()}&to=${date.to.toISOString()}${staffId !== 'all' ? `&staffId=${staffId}` : ''}`;
    const { data: report, error } = useSWR(fetchUrl, async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch report');
        return res.json();
    });

    const metrics = report?.metrics || { totalTasks: 0, totalDuration: 0, avgDuration: 0 };
    const tasks = report?.tasks || [];

    // Format duration helper (minutes to H:MM)
    const formatDuration = (mins: number) => {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `${h}h ${m}m`;
    };

    return (
        <div className="flex flex-col gap-6 p-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => window.location.href = '/dashboard/tasks'}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold">Task Reports</h1>
                    <p className="text-muted-foreground">Performance metrics and time tracking</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Filters</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-4 items-end">
                    <div className="grid gap-2">
                        <span className="text-sm font-medium">Date Range</span>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className={cn("w-[240px] justify-start text-left font-normal", !date && "text-muted-foreground")}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {date?.from ? (
                                        date.to ? (
                                            <>
                                                {format(date.from, "LLL dd, y")} - {format(date.to, "LLL dd, y")}
                                            </>
                                        ) : (
                                            format(date.from, "LLL dd, y")
                                        )
                                    ) : (
                                        <span>Pick a date</span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    initialFocus
                                    mode="range"
                                    defaultMonth={date?.from}
                                    selected={date as any}
                                    onSelect={(val: any) => val && setDate(val)}
                                    numberOfMonths={2}
                                />
                            </PopoverContent>
                        </Popover>
                    </div>

                    {isManager && (
                        <div className="grid gap-2">
                            <span className="text-sm font-medium">Staff Member</span>
                            <Select value={staffId} onValueChange={setStaffId}>
                                <SelectTrigger className="w-[200px]">
                                    <SelectValue placeholder="Select Staff" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Staff</SelectItem>
                                    {staffList.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Completed Tasks</CardDescription>
                        <CardTitle className="text-4xl">{metrics.totalTasks}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Total Time Spent</CardDescription>
                        <CardTitle className="text-4xl">{formatDuration(metrics.totalDuration)}</CardTitle>
                    </CardHeader>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardDescription>Avg. Time per Task</CardDescription>
                        <CardTitle className="text-4xl">{formatDuration(metrics.avgDuration)}</CardTitle>
                    </CardHeader>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Detailed Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date Completed</TableHead>
                                <TableHead>Task Title</TableHead>
                                <TableHead>Assigned To</TableHead>
                                <TableHead className="text-right">Duration</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {tasks && tasks.length > 0 ? (
                                tasks.map((task: any) => (
                                    <TableRow key={task.id}>
                                        <TableCell>{format(new Date(task.completedAt), 'MMM d, yyyy h:mm a')}</TableCell>
                                        <TableCell className="font-medium">{task.title}</TableCell>
                                        <TableCell>{task.assignedTo?.name || 'Unknown'}</TableCell>
                                        <TableCell className="text-right font-mono">{formatDuration(task.totalDuration)}</TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                        No completed tasks found for this period.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
