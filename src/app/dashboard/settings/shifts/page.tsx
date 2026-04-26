'use client';

import * as React from 'react';
import { MoreHorizontal, PlusCircle } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { fetchShiftTemplates, createShiftTemplate, updateShiftTemplate, deleteShiftTemplate } from '@/services/shifts';

const ROLES = [
  'Admin', 'Manager', 'ProjectManager', 'OfficeAssistant', 'PackingAssistant',
  'Moderator', 'Seller', 'CallAssistant', 'CallCentreManager', 'CourierManager',
  'CourierCallAssistant', 'Vendor_Supplier', 'Custom', 'CuttingMan', 'Marketer', 'FinanceManager', 'ModaratorManager',
];

type ShiftTemplate = {
  id: string;
  name: string;
  role: string | null;
  startTime: string;
  endTime: string;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  isActive: boolean;
  createdAt: string;
};

export default function ShiftTemplatesPage() {
  const { toast } = useToast();
  const [templates, setTemplates] = React.useState<ShiftTemplate[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ShiftTemplate | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [deleteDialog, setDeleteDialog] = React.useState<{ open: boolean; template: ShiftTemplate | null }>({ open: false, template: null });

  // form state
  const [formName, setFormName] = React.useState('');
  const [formRole, setFormRole] = React.useState<string>('ALL');
  const [formStart, setFormStart] = React.useState('09:00');
  const [formEnd, setFormEnd] = React.useState('18:00');
  const [formLateGrace, setFormLateGrace] = React.useState(0);
  const [formEarlyGrace, setFormEarlyGrace] = React.useState(0);

  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchShiftTemplates();
      setTemplates(data);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load shift templates.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { loadData(); }, [loadData]);

  const openDialog = (t?: ShiftTemplate) => {
    setEditing(t || null);
    setFormName(t?.name || '');
    setFormRole(t?.role || 'ALL');
    setFormStart(t?.startTime || '09:00');
    setFormEnd(t?.endTime || '18:00');
    setFormLateGrace(t?.lateGraceMinutes || 0);
    setFormEarlyGrace(t?.earlyLeaveGraceMinutes || 0);
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Name is required.' });
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        role: (formRole && formRole !== 'ALL') ? formRole : undefined,
        startTime: formStart,
        endTime: formEnd,
        lateGraceMinutes: formLateGrace,
        earlyLeaveGraceMinutes: formEarlyGrace,
      };
      if (editing) {
        await updateShiftTemplate(editing.id, payload);
      } else {
        await createShiftTemplate(payload);
      }
      toast({ title: 'Success', description: `Shift template ${editing ? 'updated' : 'created'}.` });
      setIsDialogOpen(false);
      loadData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message || 'Failed to save.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteDialog.template) return;
    try {
      await deleteShiftTemplate(deleteDialog.template.id);
      toast({ title: 'Deleted', description: 'Shift template deleted.' });
      setDeleteDialog({ open: false, template: null });
      loadData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message || 'Failed to delete.' });
    }
  };

  const handleToggleActive = async (t: ShiftTemplate) => {
    try {
      await updateShiftTemplate(t.id, { isActive: !t.isActive });
      toast({ title: 'Updated', description: `Template ${t.isActive ? 'deactivated' : 'activated'}.` });
      loadData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message || 'Failed.' });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Shift Templates</CardTitle>
            <CardDescription>Define shift schedules for different roles.</CardDescription>
          </div>
          <Button size="sm" onClick={() => openDialog()}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add Template
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No shift templates yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Late Grace</TableHead>
                  <TableHead>Early Leave Grace</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{t.role || '—'}</TableCell>
                    <TableCell>{t.startTime}</TableCell>
                    <TableCell>{t.endTime}</TableCell>
                    <TableCell>{t.lateGraceMinutes} min</TableCell>
                    <TableCell>{t.earlyLeaveGraceMinutes} min</TableCell>
                    <TableCell>
                      <Badge variant={t.isActive ? 'default' : 'secondary'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openDialog(t)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleToggleActive(t)}>
                            {t.isActive ? 'Deactivate' : 'Activate'}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-red-600" onClick={() => setDeleteDialog({ open: true, template: t })}>
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Shift Template' : 'New Shift Template'}</DialogTitle>
            <DialogDescription>Configure the shift schedule details.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="shift-name">Name</Label>
              <Input id="shift-name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Morning Shift" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="shift-role">Role (optional)</Label>
              <Select value={formRole} onValueChange={setFormRole}>
                <SelectTrigger><SelectValue placeholder="All roles" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All roles</SelectItem>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r.replace(/_/g, '/').replace(/([A-Z])/g, ' $1').trim()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="shift-start">Start Time</Label>
                <Input id="shift-start" type="time" value={formStart} onChange={(e) => setFormStart(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="shift-end">End Time</Label>
                <Input id="shift-end" type="time" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="shift-late">Late Grace (min)</Label>
                <Input id="shift-late" type="number" min={0} value={formLateGrace} onChange={(e) => setFormLateGrace(Number(e.target.value))} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="shift-early">Early Leave Grace (min)</Label>
                <Input id="shift-early" type="number" min={0} value={formEarlyGrace} onChange={(e) => setFormEarlyGrace(Number(e.target.value))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ open, template: deleteDialog.template })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shift Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteDialog.template?.name}&quot;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
