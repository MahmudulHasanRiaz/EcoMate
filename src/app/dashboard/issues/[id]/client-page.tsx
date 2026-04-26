
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ChevronLeft,
    MessageSquare,
    Save,
    Loader2,
    History,
    AlertCircle,
    User,
} from 'lucide-react';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { updateIssue } from '@/services/issues';
import type { Issue, IssueLog, IssueStatus, StaffMember } from '@/types';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const statusColors: Record<IssueStatus, string> = {
    'Open': 'bg-blue-500/20 text-blue-700',
    'In Progress': 'bg-yellow-500/20 text-yellow-700',
    'Resolved': 'bg-green-500/20 text-green-700',
    'Closed': 'bg-gray-500/20 text-gray-700',
};

const allStatuses: IssueStatus[] = ['Open', 'In Progress', 'Resolved', 'Closed'];

function IssueLogTimeline({ logs }: { logs: IssueLog[] }) {
    const sortedLogs = React.useMemo(() => logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [logs]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="relative">
                    <div className="absolute left-4 top-0 bottom-0 w-px bg-border -translate-x-1/2"></div>
                    <ul className="space-y-6">
                        {sortedLogs.map((log, index) => {
                            const isLast = index === 0;
                            return (
                                <li key={log.id} className="relative flex items-start gap-4">
                                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center bg-background border", isLast ? "border-primary" : "border-border")}>
                                        <History className={cn("h-4 w-4", isLast ? "text-primary" : "text-muted-foreground")} />
                                    </div>
                                    <div className="flex-1 pt-1">
                                        <p className="text-sm text-muted-foreground">{log.action}</p>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            <span>{format(new Date(log.timestamp), "MMM d, yyyy, h:mm a")}</span>
                                            {log.user && <span className="font-medium"> by {log.user}</span>}
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </CardContent>
        </Card>
    );
}

type IssueDetailsClientPageProps = {
    initialIssue: Issue | null;
    initialStaff: StaffMember[];
    currentUser: StaffMember | null;
};

export default function IssueDetailsClientPage({ initialIssue, initialStaff, currentUser }: IssueDetailsClientPageProps) {
    const { toast } = useToast();
    const router = useRouter();

    const [issue, setIssue] = React.useState<Issue | undefined>(initialIssue || undefined);
    const [allStaff, setAllStaff] = React.useState<StaffMember[]>(initialStaff);
    const [isUpdating, setIsUpdating] = React.useState(false);
    const [newStatus, setNewStatus] = React.useState<IssueStatus | undefined>(initialIssue?.status);
    const [newAssignee, setNewAssignee] = React.useState<string | undefined>(initialIssue?.assignedTo);
    const [comment, setComment] = React.useState('');

    const getAssigneeName = (id: string | null | undefined) => {
        if (!id) return 'Unassigned';
        const staff = allStaff.find(s => s.id === id);
        return staff ? staff.name : 'Unknown Staff';
    };

    const handleUpdate = async () => {
        if (!issue) return;
        setIsUpdating(true);
        const previousAssignee = issue.assignedTo;

        const updatePayload: Partial<Issue> & { comment?: string } = {};
        if (newStatus && newStatus !== issue.status) {
            updatePayload.status = newStatus;
        }
        if (newAssignee !== issue.assignedTo) {
            updatePayload.assignedTo = newAssignee;
        }
        if (comment) {
            updatePayload.comment = comment;
        }

        try {
            const updatedIssue = await updateIssue(issue.id, updatePayload);
            if (updatedIssue) {
                setIssue(updatedIssue);
                setNewAssignee(updatedIssue.assignedTo);
                setNewStatus(updatedIssue.status);
                setComment('');
                if (updatedIssue.assignedTo && updatedIssue.assignedTo !== previousAssignee) {
                    toast({
                        title: "Issue Assigned",
                        description: `Assigned to ${getAssigneeName(updatedIssue.assignedTo)}.`,
                    });
                } else {
                    toast({
                        title: "Issue Updated",
                        description: `The issue has been successfully updated.`,
                    });
                }
                router.refresh(); // Refresh server components
            }
        } catch (err: any) {
            toast({
                variant: 'destructive',
                title: 'Update failed',
                description: err?.message || 'Could not update issue.',
            });
        } finally {
            setIsUpdating(false);
        }
    };

    if (!issue) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 lg:gap-6 lg:p-6">
                <p>Issue not found.</p>
                <Button asChild variant="outline">
                    <Link href="/dashboard/issues">Back to Issues</Link>
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" className="h-7 w-7" asChild>
                    <Link href="/dashboard/issues">
                        <ChevronLeft className="h-4 w-4" />
                        <span className="sr-only">Back</span>
                    </Link>
                </Button>
                <div className="flex-1">
                    <h1 className="font-headline text-xl font-semibold sm:text-2xl">
                        Issue: {issue.id}
                    </h1>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>{issue.title}</CardTitle>
                            {issue.orderId && (
                                <CardDescription>
                                    For Order <Link href={`/dashboard/orders/${issue.orderId}`} className="text-primary underline">{issue.orderNumber || issue.orderId}</Link>
                                </CardDescription>
                            )}
                        </CardHeader>
                        <CardContent>
                            <div className="flex justify-between items-center mb-4">
                                <Badge variant="outline" className={cn(statusColors[issue.status])}>{issue.status}</Badge>
                                <Badge variant={issue.priority === 'High' ? 'destructive' : 'secondary'}>{issue.priority} Priority</Badge>
                            </div>
                            <p className="text-muted-foreground">{issue.description}</p>
                            <Separator className="my-4" />
                            <div className="text-xs text-muted-foreground grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <p><strong>Created by:</strong> {issue.createdBy}</p>
                                <p><strong>Created at:</strong> {format(new Date(issue.createdAt), 'PPpp')}</p>
                                <p><strong>Assigned to:</strong> {getAssigneeName(issue.assignedTo)}</p>
                                {issue.resolvedAt && <p><strong>Resolved at:</strong> {format(new Date(issue.resolvedAt), 'PPpp')}</p>}
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <MessageSquare className="w-5 h-5 text-muted-foreground" />
                                Update Issue
                            </CardTitle>
                            <CardDescription>Change the status, assignee, or add a comment to the issue log.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="status">Change Status</Label>
                                    <Select value={newStatus} onValueChange={(value: IssueStatus) => setNewStatus(value)}>
                                        <SelectTrigger id="status"><SelectValue placeholder="Select a status" /></SelectTrigger>
                                        <SelectContent>
                                            {allStatuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="assignee">Assign To</Label>
                                    <Select
                                        value={newAssignee || 'unassigned'}
                                        onValueChange={(value) => setNewAssignee(value === 'unassigned' ? undefined : value)}
                                    >
                                        <SelectTrigger id="assignee"><SelectValue placeholder="Select a staff member" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="unassigned">Unassigned</SelectItem>
                                            {allStaff.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="comment">Add a Comment (Optional)</Label>
                                <Textarea id="comment" placeholder="Provide details about the update..." value={comment} onChange={(e) => setComment(e.target.value)} />
                            </div>
                            <Button onClick={handleUpdate} disabled={isUpdating}>
                                {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                {isUpdating ? 'Updating...' : 'Save Update'}
                            </Button>
                        </CardContent>
                    </Card>
                </div>
                <div className="lg:col-span-1">
                    <IssueLogTimeline logs={issue.logs} />
                </div>
            </div>
        </div>
    );
}
