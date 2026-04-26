'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Search, Calendar, User as UserIcon, Clock, History, LayoutGrid, List, MessageSquare, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/use-permissions';
import { useUser } from '@clerk/nextjs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import useSWR from 'swr';
import { StaffRole, Task, TaskStatus, TaskPriority } from '@prisma/client';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { getStaffMembers } from '@/services/staff';

// Types
type TaskWithRelations = Task & {
    assignedTo?: { id: string; name: string };
    createdBy: { id: string; name: string };
};

const statusColors: Record<TaskStatus, string> = {
    ToDo: 'bg-slate-500',
    InProgress: 'bg-blue-500',
    InReview: 'bg-yellow-500',
    Done: 'bg-green-500',
    Cancelled: 'bg-red-500',
};

const priorityStyles: Record<TaskPriority, { bg: string; text: string; icon: any }> = {
    Low: { bg: 'bg-slate-100', text: 'text-slate-600', icon: Clock },
    Medium: { bg: 'bg-blue-100', text: 'text-blue-600', icon: Clock },
    High: { bg: 'bg-orange-100', text: 'text-orange-600', icon: AlertCircle },
    Urgent: { bg: 'bg-red-100', text: 'text-red-700', icon: AlertCircle },
};

export default function TasksPage() {
    const { toast } = useToast();
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

    // Filters & View
    const [statusFilter, setStatusFilter] = React.useState<string>('all');
    const [priorityFilter, setPriorityFilter] = React.useState<string>('all');
    const [view, setView] = React.useState<'table' | 'board'>('board');

    // Data Fetching
    const fetcher = async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch tasks');
        return res.json();
    };

    const { data: tasks, error, mutate } = useSWR<TaskWithRelations[]>(
        `/api/tasks?status=${statusFilter !== 'all' ? statusFilter : ''}&priority=${priorityFilter !== 'all' ? priorityFilter : ''}`,
        fetcher
    );

    const [isCreateOpen, setIsCreateOpen] = React.useState(false);
    const [editingTask, setEditingTask] = React.useState<TaskWithRelations | null>(null);

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-lg font-semibold md:text-2xl">Tasks</h1>
                    <p className="text-sm text-muted-foreground">Manage and track team tasks</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => window.location.href = '/dashboard/tasks/report'}>
                        <History className="mr-2 h-4 w-4" />
                        Reports
                    </Button>
                    <Button onClick={() => setIsCreateOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create Task
                    </Button>
                </div>
            </div>

            <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Filter by Status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            {Object.keys(statusColors).map(s => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Filter by Priority" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Priorities</SelectItem>
                            {Object.keys(priorityStyles).map(p => (
                                <SelectItem key={p} value={p}>{p}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center bg-muted p-1 rounded-lg">
                    <Button
                        variant={view === 'table' ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setView('table')}
                        className="h-8 w-8 p-0"
                    >
                        <List className="h-4 w-4" />
                    </Button>
                    <Button
                        variant={view === 'board' ? 'secondary' : 'ghost'}
                        size="sm"
                        onClick={() => setView('board')}
                        className="h-8 w-8 p-0"
                    >
                        <LayoutGrid className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {view === 'table' ? (
                <Card>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Title</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Priority</TableHead>
                                    <TableHead>Assigned To</TableHead>
                                    <TableHead>Due Date</TableHead>
                                    <TableHead className="text-right">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {tasks?.map((task) => (
                                    <TableRow key={task.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setEditingTask(task)}>
                                        <TableCell className="font-medium">
                                            {task.title}
                                            {task.description && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{task.description}</p>}
                                        </TableCell>
                                        <TableCell>
                                            <Badge className={statusColors[task.status]}>{task.status}</Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium", priorityStyles[task.priority].bg, priorityStyles[task.priority].text)}>
                                                {React.createElement(priorityStyles[task.priority].icon, { className: "h-3 w-3" })}
                                                {task.priority}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2 text-sm">
                                                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center border">
                                                    <UserIcon className="h-3 w-3 text-muted-foreground" />
                                                </div>
                                                {task.assignedTo?.name || 'Unassigned'}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {task.dueDate ? (
                                                <div className="flex items-center gap-1.5 text-sm">
                                                    <Calendar className="h-3 w-3 text-muted-foreground" />
                                                    {format(new Date(task.dueDate), 'MMM d, yyyy, h:mm a')}
                                                </div>
                                            ) : '-'}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm">Details</Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {!tasks && !error && <TableRow><TableCell colSpan={6} className="text-center py-10">Loading tasks...</TableCell></TableRow>}
                                {tasks && tasks.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-10">No tasks found</TableCell></TableRow>}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {(['ToDo', 'InProgress', 'InReview', 'Done'] as TaskStatus[]).map((status) => (
                        <div key={status} className="flex flex-col gap-3">
                            <div className="flex items-center justify-between px-1">
                                <div className="flex items-center gap-2">
                                    <div className={cn("h-2.5 w-2.5 rounded-full", statusColors[status])} />
                                    <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">{status === 'ToDo' ? 'To Do' : status === 'InProgress' ? 'In Progress' : status === 'InReview' ? 'In Review' : 'Done'}</h2>
                                </div>
                                <Badge variant="secondary" className="font-mono text-[10px]">{tasks?.filter(t => t.status === status).length || 0}</Badge>
                            </div>
                            <div className="flex flex-col gap-3 min-h-[200px]">
                                {tasks?.filter(t => t.status === status).map((task) => (
                                    <Card key={task.id} className="cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all shadow-sm" onClick={() => setEditingTask(task)}>
                                        <CardContent className="p-3">
                                            <div className="flex items-center justify-between mb-2">
                                                <div className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase", priorityStyles[task.priority].bg, priorityStyles[task.priority].text)}>
                                                    {task.priority}
                                                </div>
                                                {task.dueDate && (
                                                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                                                        <Clock className="h-3 w-3" />
                                                        {format(new Date(task.dueDate), 'MMM d, h:mm a')}
                                                    </div>
                                                )}
                                            </div>
                                            <h3 className="font-medium text-sm leading-tight mb-1">{task.title}</h3>
                                            {task.description && <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{task.description}</p>}
                                            <div className="flex items-center justify-between mt-auto pt-2 border-t">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center border">
                                                        <UserIcon className="h-2.5 w-2.5 text-muted-foreground" />
                                                    </div>
                                                    <span className="text-[11px] font-medium truncate max-w-[80px]">{task.assignedTo?.name || 'Unassigned'}</span>
                                                </div>
                                                <Badge variant="outline" className="text-[10px] py-0 px-1 font-normal opacity-70">
                                                    #{task.id.slice(-4)}
                                                </Badge>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                                {tasks?.filter(t => t.status === status).length === 0 && (
                                    <div className="border-2 border-dashed border-muted rounded-xl h-24 flex items-center justify-center text-muted-foreground text-xs italic">
                                        No tasks
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <TaskDialog
                open={isCreateOpen}
                onOpenChange={setIsCreateOpen}
                mode="create"
                isManager={!!isManager}
                currentStaffId={currentStaffId}
                onSuccess={() => { setIsCreateOpen(false); mutate(); }}
            />

            {editingTask && (
                <TaskDialog
                    open={!!editingTask}
                    onOpenChange={(open) => !open && setEditingTask(null)}
                    mode="edit"
                    isManager={!!isManager}
                    currentStaffId={currentStaffId}
                    initialData={editingTask}
                    onSuccess={() => { setEditingTask(null); mutate(); }}
                />
            )}
        </div>
    );
}

function TaskDialog({ open, onOpenChange, mode, initialData, onSuccess, isManager, currentStaffId }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode: 'create' | 'edit';
    isManager: boolean;
    currentStaffId?: string;
    initialData?: TaskWithRelations;
    onSuccess: () => void;
}) {
    const { toast } = useToast();
    const [title, setTitle] = React.useState(initialData?.title || '');
    const [description, setDescription] = React.useState(initialData?.description || '');
    const [status, setStatus] = React.useState<TaskStatus>(initialData?.status || 'ToDo');
    const [priority, setPriority] = React.useState<TaskPriority>(initialData?.priority || 'Medium');
    const [assignedToId, setAssignedToId] = React.useState(initialData?.assignedToId || 'unassigned');
    const [dueDate, setDueDate] = React.useState(initialData?.dueDate ? format(new Date(initialData.dueDate), "yyyy-MM-dd'T'HH:mm") : '');

    const [updateMessage, setUpdateMessage] = React.useState('');

    // Fetch staff for assignment
    const [staffList, setStaffList] = React.useState<{ id: string; name: string }[]>([]);

    React.useEffect(() => {
        if (open && isManager) {
            getStaffMembers().then(res => setStaffList(res.items.map((s: any) => ({ id: s.id, name: s.name }))));
        }
    }, [open, isManager]);

    React.useEffect(() => {
        if (!open) return;

        if (mode === 'edit' && initialData) {
            setTitle(initialData.title ?? '');
            setDescription(initialData.description ?? '');
            setStatus(initialData.status ?? 'ToDo');
            setPriority(initialData.priority ?? 'Medium');
            setAssignedToId(initialData.assignedToId ?? 'unassigned');
            setDueDate(initialData.dueDate ? format(new Date(initialData.dueDate), "yyyy-MM-dd'T'HH:mm") : '');
        }

        if (mode === 'create') {
            setTitle('');
            setDescription('');
            setStatus('ToDo');
            setPriority('Medium');
            setAssignedToId(isManager ? 'unassigned' : (currentStaffId ?? 'unassigned'));
            setDueDate('');
        }

        setUpdateMessage('');
    }, [open, mode, initialData?.id, initialData?.updatedAt, isManager, currentStaffId]);

    const handleSubmit = async () => {
        try {
            const body = {
                title,
                description,
                status,
                priority,
                assignedToId: assignedToId === 'unassigned' ? null : assignedToId,
                dueDate: dueDate || null,
                updateMessage: updateMessage || null,
            };

            const res = await fetch(mode === 'create' ? '/api/tasks' : `/api/tasks/${initialData?.id}`, {
                method: mode === 'create' ? 'POST' : 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!res.ok) throw new Error('Failed to save task');

            toast({ title: 'Success', description: `Task ${mode === 'create' ? 'created' : 'updated'}` });
            setUpdateMessage('');
            onSuccess();
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not save task' });
        }
    };

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this task?')) return;
        try {
            await fetch(`/api/tasks/${initialData?.id}`, { method: 'DELETE' });
            toast({ title: 'Success', description: 'Task deleted' });
            onSuccess();
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'Delete failed' });
        }
    }

    // Load logs if editing
    const { data: taskDetails } = useSWR(mode === 'edit' && initialData?.id ? `/api/tasks/${initialData.id}` : null);

    return (
        <Dialog open={open} onOpenChange={(val) => {
            if (!val) setUpdateMessage('');
            onOpenChange(val);
        }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle className="text-xl font-bold flex items-center gap-2">
                        {mode === 'create' ? <Plus className="h-5 w-5 text-primary" /> : <Clock className="h-5 w-5 text-primary" />}
                        {mode === 'create' ? 'Create New Task' : 'Task Details'}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-6">
                    <div className="space-y-4">
                        <div className="grid gap-2">
                            <Label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Title</Label>
                            <Input
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder="What needs to be done?"
                                className="text-base font-semibold border-0 bg-muted/30 focus-visible:ring-1"
                                disabled={mode === 'edit' && !isManager}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Description</Label>
                            <Textarea
                                value={description || ''}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Add more details about this task..."
                                className="min-h-[100px] resize-none border-0 bg-muted/30 focus-visible:ring-1"
                                disabled={mode === 'edit' && !isManager}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <div className="grid gap-2">
                                <Label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Status</Label>
                                <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                                    <SelectTrigger className="flex items-center gap-2">
                                        <div className={cn("h-2 w-2 rounded-full", statusColors[status])} />
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.keys(statusColors).map(s => (
                                            <SelectItem key={s} value={s}>
                                                <div className="flex items-center gap-2">
                                                    <div className={cn("h-2 w-2 rounded-full", statusColors[s as TaskStatus])} />
                                                    {s}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Priority</Label>
                                <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)} disabled={mode === 'edit' && !isManager}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.keys(priorityStyles).map(p => (
                                            <SelectItem key={p} value={p}>
                                                <div className="flex items-center gap-2">
                                                    {React.createElement(priorityStyles[p as TaskPriority].icon, { className: "h-3 w-3" })}
                                                    {p}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="grid gap-2">
                                <Label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Assigned To</Label>
                                <Select value={assignedToId || 'unassigned'} onValueChange={setAssignedToId} disabled={!isManager}>
                                    <SelectTrigger className="flex items-center gap-2">
                                        <UserIcon className="h-4 w-4 text-muted-foreground" />
                                        <SelectValue placeholder="Select Staff" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="unassigned">Unassigned</SelectItem>
                                        {isManager ? staffList.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>) : (
                                            <SelectItem value={currentStaffId || 'self'}>Myself</SelectItem>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Due Date</Label>
                                <div className="relative">
                                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                    <Input
                                        type="datetime-local"
                                        value={dueDate}
                                        onChange={e => setDueDate(e.target.value)}
                                        className="pl-10"
                                        disabled={mode === 'edit' && !isManager}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {mode === 'edit' && (
                        <>
                            <div className="grid gap-2 pt-2 border-t">
                                <Label className="text-xs uppercase tracking-wider font-bold text-muted-foreground flex items-center gap-2">
                                    <MessageSquare className="h-3 w-3" />
                                    Update Message (Optional)
                                </Label>
                                <Textarea
                                    value={updateMessage}
                                    onChange={e => setUpdateMessage(e.target.value)}
                                    placeholder="Leave a note about this change..."
                                    className="min-h-[60px] resize-none"
                                />
                            </div>

                            {taskDetails?.logs && taskDetails.logs.length > 0 && (
                                <div className="space-y-4 pt-4 border-t">
                                    <div className="flex items-center gap-2">
                                        <History className="h-4 w-4 text-muted-foreground" />
                                        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Activity Timeline</h3>
                                    </div>
                                    <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-muted">
                                        {taskDetails.logs.map((log: any, idx: number) => (
                                            <div key={log.id} className="relative">
                                                <div className={cn(
                                                    "absolute -left-[22px] top-1 h-3 w-3 rounded-full border-2 border-background shadow-sm",
                                                    idx === 0 ? "bg-primary" : "bg-muted-foreground"
                                                )} />
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center gap-2 text-xs">
                                                        <span className="font-bold text-foreground">{log.user?.name || 'Unknown'}</span>
                                                        <span className="text-muted-foreground">{log.action.toLowerCase()} task</span>
                                                        <span className="text-[10px] opacity-70 ml-auto">{format(new Date(log.timestamp), 'MMM d, h:mm a')}</span>
                                                    </div>
                                                    <div className="text-sm text-muted-foreground leading-relaxed bg-muted/20 p-2 rounded-md border border-muted/30">
                                                        {log.details}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="flex justify-between items-center p-6 border-t bg-muted/10">
                    {mode === 'edit' && (isManager || initialData?.createdById === currentStaffId) ? (
                        <Button variant="destructive" onClick={handleDelete} type="button" size="sm">
                            Delete Task
                        </Button>
                    ) : <div />}
                    <div className="flex gap-3">
                        <Button variant="outline" onClick={() => onOpenChange(false)} size="sm">Cancel</Button>
                        <Button onClick={handleSubmit} size="sm" className="px-6">
                            {mode === 'create' ? 'Create Task' : 'Update Task'}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
