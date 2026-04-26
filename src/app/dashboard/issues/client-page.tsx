'use client';

import * as React from 'react';
import { MoreHorizontal, AlertCircle, PlusCircle, Search, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
    CardDescription
} from '@/components/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { createIssue, updateIssue, getIssues } from '@/services/issues';
import type { Issue, IssueStatus, StaffMember } from '@/types';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

const statusColors: Record<IssueStatus, string> = {
    'Open': 'bg-blue-500/20 text-blue-700',
    'In Progress': 'bg-yellow-500/20 text-yellow-700',
    'Resolved': 'bg-green-500/20 text-green-700',
    'Closed': 'bg-gray-500/20 text-gray-700',
};

const allStatuses: IssueStatus[] = ['Open', 'In Progress', 'Resolved', 'Closed'];

const issueFormSchema = z.object({
    orderId: z.string().optional(),
    title: z.string().min(5, "Title must be at least 5 characters."),
    description: z.string().min(10, "Please provide a detailed description."),
    priority: z.enum(['Low', 'Medium', 'High']),
});
type IssueFormValues = z.infer<typeof issueFormSchema>;

type IssuesClientPageProps = {
    initialIssues: Issue[];
    initialNextCursor: string | null | undefined;
    totalIssues?: number;
    initialStaff: StaffMember[];
    currentUser: StaffMember | null;
};

export default function IssuesClientPage({ initialIssues, initialNextCursor, totalIssues: initialTotal, initialStaff, currentUser }: IssuesClientPageProps) {
    const { toast } = useToast();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [isPending, startTransition] = React.useTransition();

    // State for Client-Side Pagination (Load More)
    const [issues, setIssues] = React.useState<Issue[]>(initialIssues);
    const [nextCursor, setNextCursor] = React.useState<string | null>(initialNextCursor || null);
    const [hasMore, setHasMore] = React.useState(!!initialNextCursor);
    const [isLoadingMore, setIsLoadingMore] = React.useState(false);

    const [isDialogOpen, setIsDialogOpen] = React.useState(false);
    const [inlineSaving, setInlineSaving] = React.useState<Record<string, boolean>>({});
    const [searchTerm, setSearchTerm] = React.useState(searchParams.get('search') || '');

    // Current filters from URL (client still uses URL for filters to keep shareable links)
    const statusFilter = searchParams.get('status') || 'all';
    const priorityFilter = searchParams.get('priority') || 'all';
    const assigneeFilter = searchParams.get('assignedTo') || 'all';

    const currentUserId = currentUser?.id || '';

    const issueForm = useForm<IssueFormValues>({
        resolver: zodResolver(issueFormSchema),
        defaultValues: {
            orderId: '',
            title: '',
            description: '',
            priority: 'Medium',
        },
    });

    // Sync when filters change (server re-renders this component with new initial data)
    React.useEffect(() => {
        setIssues(initialIssues);
        setNextCursor(initialNextCursor || null);
        setHasMore(!!initialNextCursor);
    }, [initialIssues, initialNextCursor]);

    const getAssigneeName = (id: string | null | undefined) => {
        if (!id) return 'Unassigned';
        const staff = initialStaff.find(s => s.id === id);
        return staff ? staff.name : 'Unknown Staff';
    };

    const updateUrl = (params: Record<string, string | null>) => {
        const newParams = new URLSearchParams(searchParams.toString());
        Object.entries(params).forEach(([key, value]) => {
            if (value === null || value === 'all' || value === '') {
                newParams.delete(key);
            } else {
                newParams.set(key, value);
            }
        });

        // Remove page param if it exists, logic is now cursor based from top
        newParams.delete('page');

        startTransition(() => {
            router.push(`${pathname}?${newParams.toString()}`);
        });
    };

    const handleStatusChange = (value: string) => updateUrl({ status: value });
    const handlePriorityChange = (value: string) => updateUrl({ priority: value });
    const handleAssigneeChange = (value: string) => updateUrl({ assignedTo: value });

    const handleAssignToMe = () => {
        if (!currentUserId) return;
        updateUrl({ assignedTo: currentUserId });
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        updateUrl({ search: searchTerm });
    };

    const handleLoadMore = async () => {
        if (!nextCursor || isLoadingMore) return;
        setIsLoadingMore(true);
        try {
            // Fetch next batch
            const response = await getIssues({
                status: statusFilter !== 'all' ? statusFilter : undefined,
                priority: priorityFilter !== 'all' ? priorityFilter : undefined,
                assignedTo: assigneeFilter !== 'all' ? assigneeFilter : undefined,
                search: searchTerm || undefined,
                cursor: nextCursor,
                pageSize: 20
            });

            const data = (response as any) || {};
            const newItems = data.items || [];

            setIssues(prev => {
                const seen = new Set(prev.map(i => i.id));
                return [...prev, ...newItems.filter((i: Issue) => !seen.has(i.id))];
            });
            setNextCursor(data.nextCursor);
            setHasMore(!!data.nextCursor);

        } catch (err) {
            console.error("Failed to load more issues", err);
            toast({
                variant: 'destructive',
                title: "Error loading more",
                description: "Could not load more issues."
            });
        } finally {
            setIsLoadingMore(false);
        }
    };

    const handleInlineStatus = async (issueId: string, status: IssueStatus) => {
        setInlineSaving(prev => ({ ...prev, [issueId]: true }));
        try {
            const updated = await updateIssue(issueId, { status });
            if (updated) {
                setIssues(prev => prev.map(i => i.id === issueId ? { ...i, status: updated.status } : i));
                toast({ title: 'Status updated', description: `Issue marked ${status}.` });
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Update failed', description: err?.message || 'Could not update issue status.' });
        } finally {
            setInlineSaving(prev => ({ ...prev, [issueId]: false }));
        }
    };

    async function onIssueSubmit(data: IssueFormValues) {
        try {
            await createIssue(data.orderId, data.title, data.description, data.priority, currentUser?.name || currentUser?.id);
            toast({
                title: "Issue Created",
                description: `Issue has been successfully created.`,
            });
            setIsDialogOpen(false);
            issueForm.reset();
            router.refresh(); // Refresh to show new issue at top (server re-render)
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Issue creation failed',
                description: error?.message || 'Unable to create issue. Please try again.',
            });
        }
    }

    const renderTable = () => (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Issue ID</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Created At</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {issues.map(issue => {
                    const displayIssueId = `ISS-${issue.id.slice(-6).toUpperCase()}`;
                    const displayOrder = issue.orderNumber || issue.orderId;
                    return (
                        <TableRow key={issue.id}>
                            <TableCell className="font-medium">{displayIssueId}</TableCell>
                            <TableCell>
                                {displayOrder ? (
                                    <Button variant="link" asChild className="p-0 h-auto">
                                        <Link href={`/dashboard/orders/${issue.orderId || displayOrder}`}>{displayOrder}</Link>
                                    </Button>
                                ) : (
                                    <span className="text-muted-foreground">-</span>
                                )}
                            </TableCell>
                            <TableCell>{issue.title}</TableCell>
                            <TableCell>
                                <Select
                                    value={issue.status}
                                    onValueChange={(v) => handleInlineStatus(issue.id, v as IssueStatus)}
                                    disabled={inlineSaving[issue.id]}
                                >
                                    <SelectTrigger className={cn("w-[150px]", statusColors[issue.status])}>
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {allStatuses.map(status => (
                                            <SelectItem key={status} value={status}>{status}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </TableCell>
                            <TableCell>
                                <Badge variant={issue.priority === 'High' ? 'destructive' : issue.priority === 'Medium' ? 'secondary' : 'outline'}>{issue.priority}</Badge>
                            </TableCell>
                            <TableCell>{getAssigneeName(issue.assignedTo)}</TableCell>
                            <TableCell>{format(new Date(issue.createdAt), 'MMM d, yyyy')}</TableCell>
                            <TableCell>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button aria-haspopup="true" size="icon" variant="ghost">
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                        <DropdownMenuItem asChild>
                                            <Link href={`/dashboard/issues/${issue.id}`}>View Details</Link>
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    )
                })}
            </TableBody>
        </Table>
    );

    const renderCardList = () => (
        <div className="space-y-4">
            {issues.map(issue => (
                <Card key={issue.id}>
                    <CardContent className="p-4 space-y-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <Link href={`/dashboard/issues/${issue.id}`} className="font-semibold hover:underline">
                                    {`ISS-${issue.id.slice(-6).toUpperCase()}`}
                                </Link>
                                <p className="text-sm text-muted-foreground">
                                    {issue.orderId ? (
                                        <>
                                            Order: <Link href={`/dashboard/orders/${issue.orderId}`} className="text-primary hover:underline">{issue.orderNumber || issue.orderId}</Link>
                                        </>
                                    ) : 'General Issue'}
                                </p>
                            </div>
                            <Select
                                value={issue.status}
                                onValueChange={(v) => handleInlineStatus(issue.id, v as IssueStatus)}
                                disabled={inlineSaving[issue.id]}
                            >
                                <SelectTrigger className={cn("w-full sm:w-[150px]", statusColors[issue.status])}>
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    {allStatuses.map(status => (
                                        <SelectItem key={status} value={status}>{status}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <p className="font-medium text-sm">{issue.title}</p>
                        <Separator />
                        <div className="flex justify-between items-center text-xs">
                            <Badge variant="outline" className={cn(statusColors[issue.status])}>{issue.status}</Badge>
                            <Badge variant={issue.priority === 'High' ? 'destructive' : issue.priority === 'Medium' ? 'secondary' : 'outline'}>{issue.priority} Priority</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground pt-2 border-t">
                            <p>Assigned to: <span className="font-medium">{getAssigneeName(issue.assignedTo)}</span></p>
                            <p>Created: {format(new Date(issue.createdAt), 'PP')}</p>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 w-full max-w-6xl mx-auto">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex-1 space-y-1">
                    <h1 className="font-headline text-2xl font-bold">Issue Management</h1>
                    <p className="text-muted-foreground hidden sm:block">
                        Track and resolve customer and order-related issues.
                    </p>
                </div>
                <div className="w-full sm:w-auto">
                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="w-full sm:w-auto" size="sm" variant="destructive">
                                <PlusCircle className="h-4 w-4 sm:mr-2" />
                                <span className="hidden sm:inline">New Issue</span>
                                <span className="sr-only sm:hidden">New Issue</span>
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                            <DialogHeader>
                                <DialogTitle>Create New Issue</DialogTitle>
                                <DialogDescription>
                                    Report a new problem or issue.
                                </DialogDescription>
                            </DialogHeader>
                            <Form {...issueForm}>
                                <form onSubmit={issueForm.handleSubmit(onIssueSubmit)} className="space-y-4">
                                    <FormField control={issueForm.control} name="orderId" render={({ field }) => (<FormItem><FormLabel>Order Number / ID (Optional)</FormLabel><FormControl><Input placeholder="e.g., 150226-02 or ORD-123" {...field} /></FormControl><FormMessage /></FormItem>)} />
                                    <FormField control={issueForm.control} name="title" render={({ field }) => (<FormItem><FormLabel>Title</FormLabel><FormControl><Input placeholder="e.g., Wrong product delivered" {...field} /></FormControl><FormMessage /></FormItem>)} />
                                    <FormField control={issueForm.control} name="description" render={({ field }) => (<FormItem><FormLabel>Description</FormLabel><FormControl><Textarea placeholder="Provide a detailed description of the issue..." {...field} /></FormControl><FormMessage /></FormItem>)} />
                                    <FormField control={issueForm.control} name="priority" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Priority</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl><SelectTrigger><SelectValue placeholder="Select priority" /></SelectTrigger></FormControl>
                                                <SelectContent><SelectItem value="Low">Low</SelectItem><SelectItem value="Medium">Medium</SelectItem><SelectItem value="High">High</SelectItem></SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                    <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                                        <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="w-full sm:w-auto">Cancel</Button>
                                        <Button type="submit" className="w-full sm:w-auto">Create Issue</Button>
                                    </DialogFooter>
                                </form>
                            </Form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>All Issues</CardTitle>
                    <CardDescription>A list of all reported issues.</CardDescription>
                    <div className="pt-4 flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full">
                            <Select value={statusFilter} onValueChange={handleStatusChange}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Filter by status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Statuses</SelectItem>
                                    {allStatuses.map(status => (
                                        <SelectItem key={status} value={status}>{status}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={priorityFilter} onValueChange={handlePriorityChange}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Filter by priority" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Priority</SelectItem>
                                    <SelectItem value="Low">Low</SelectItem>
                                    <SelectItem value="Medium">Medium</SelectItem>
                                    <SelectItem value="High">High</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={assigneeFilter} onValueChange={handleAssigneeChange}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Filter by assignee" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Staff</SelectItem>
                                    {initialStaff.map(staff => (
                                        <SelectItem key={staff.id} value={staff.id}>{staff.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
                            <form onSubmit={handleSearch} className="relative w-full sm:w-[240px] xl:w-[260px]">
                                <Input
                                    placeholder="Search ID, Order, Title"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pr-8"
                                />
                                <Button type="submit" size="icon" variant="ghost" className="absolute right-0 top-0 h-full w-8 text-muted-foreground hover:text-foreground">
                                    <Search className="h-4 w-4" />
                                </Button>
                            </form>
                            <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={handleAssignToMe}>Assigned to me</Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {isPending ? (
                        <div className="h-48 flex items-center justify-center text-muted-foreground">Loading...</div>
                    ) : issues.length > 0 ? (
                        <>
                            <div className="hidden sm:block">{renderTable()}</div>
                            <div className="sm:hidden">{renderCardList()}</div>
                        </>
                    ) : (
                        <div className="h-48 flex flex-col items-center justify-center text-center text-muted-foreground">
                            <AlertCircle className="w-12 h-12 mb-4" />
                            <h3 className="font-semibold">No Issues Found</h3>
                            <p className="text-sm">No issues match the current filter.</p>
                        </div>
                    )}
                </CardContent>
                <CardFooter className="flex flex-col items-center gap-4">
                    <div className="text-xs text-muted-foreground">
                        Showing {issues.length} {initialTotal ? `of ${initialTotal}` : 'issues'}
                    </div>
                    {hasMore && (
                        <Button
                            onClick={handleLoadMore}
                            disabled={isLoadingMore}
                            variant="outline"
                            className="min-w-[200px]"
                        >
                            {isLoadingMore ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</> : "Load More"}
                        </Button>
                    )}
                </CardFooter>
            </Card>
        </div>
    );
}
