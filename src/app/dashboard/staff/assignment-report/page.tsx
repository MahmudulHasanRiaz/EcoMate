'use client';

import * as React from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useUser } from '@clerk/nextjs';
import type { StaffRole } from '@/types';
import useSWR from 'swr';
import { getBusinesses } from '@/services/partners';

type AssignmentReportRow = {
    staffId: string;
    staffName: string;
    New: number;
    Confirmed: number;
    Hold: number;
    Total: number;
    OpenIncomplete: number;
};

const fetcher = (url: string) => fetch(url).then(res => res.json()).then(res => res.data);

export default function StaffAssignmentReportPage() {
    const { user, isLoaded } = useUser();
    const [businessFilter, setBusinessFilter] = React.useState<string>('all');
    const [businesses, setBusinesses] = React.useState<{ id: string, name: string }[]>([]);

    React.useEffect(() => {
        getBusinesses().then(res => setBusinesses(Array.isArray(res) ? res : []));
    }, []);

    const qs = new URLSearchParams();
    if (businessFilter !== 'all') {
        qs.set('businessId', businessFilter);
    }

    const { data, isLoading, error } = useSWR<AssignmentReportRow[]>(
        `/api/staff/assignment-report?${qs.toString()}`,
        fetcher
    );

    const role = user?.publicMetadata?.role as StaffRole;
    const canManageTasksRoles = ['Admin', 'Manager', 'Project Manager', 'Call Centre Manager', 'Courier Manager', 'Finance Manager'];
    const hasAccess = role && canManageTasksRoles.includes(role);

    if (!isLoaded || (user && user.publicMetadata?.status === 'loading')) return <div className="p-6">Loading...</div>;
    if (!user || !hasAccess) return <div className="p-6 text-red-500">Access Denied</div>;

    return (
        <div className="flex min-h-full w-full flex-1 flex-col gap-4 p-4 pb-24 lg:gap-6 lg:p-6 lg:pb-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold font-headline">Staff Assignment Report</h1>
                    <p className="text-muted-foreground">Snapshot of currently assigned active orders per staff.</p>
                </div>
                <div className="w-full sm:w-[200px]">
                    <Select value={businessFilter} onValueChange={setBusinessFilter}>
                        <SelectTrigger>
                            <SelectValue placeholder="All Businesses" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Businesses</SelectItem>
                            {businesses.map((b) => (
                                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Assignment Totals</CardTitle>
                    <CardDescription>Order assignments currently pending per staff member.</CardDescription>
                </CardHeader>
                <CardContent>
                    {error ? (
                        <div className="text-red-500 py-4">Failed to load assignment report.</div>
                    ) : (
                        <div className="rounded-md border">
                            <Table className="min-w-[650px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Staff Name</TableHead>
                                        <TableHead className="text-right">New</TableHead>
                                        <TableHead className="text-right text-sky-600">Confirmed</TableHead>
                                        <TableHead className="text-right text-amber-600">Hold</TableHead>
                                        <TableHead className="text-right font-bold">Total</TableHead>
                                        <TableHead className="text-right text-violet-600">Open Incomplete</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {isLoading ? (
                                        Array.from({ length: 5 }).map((_, i) => (
                                            <TableRow key={i}>
                                                <TableCell><Skeleton className="h-4 w-[150px]" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[50px] ml-auto" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[50px] ml-auto" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[50px] ml-auto" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[50px] ml-auto" /></TableCell>
                                                <TableCell><Skeleton className="h-4 w-[50px] ml-auto" /></TableCell>
                                            </TableRow>
                                        ))
                                    ) : data?.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-6 text-muted-foreground">
                                                No active assignments found matching criteria.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        data?.map((row) => (
                                            <TableRow key={row.staffId}>
                                                <TableCell className="font-medium">{row.staffName}</TableCell>
                                                <TableCell className="text-right">{row.New}</TableCell>
                                                <TableCell className="text-right text-sky-600">{row.Confirmed}</TableCell>
                                                <TableCell className="text-right text-amber-600">{row.Hold}</TableCell>
                                                <TableCell className="text-right font-bold text-lg">{row.Total}</TableCell>
                                                <TableCell className="text-right text-violet-600">{row.OpenIncomplete}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
