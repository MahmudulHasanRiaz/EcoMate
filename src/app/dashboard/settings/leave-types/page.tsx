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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { fetchLeaveTypes, createLeaveType, updateLeaveType } from '@/services/leaves';

type LeaveType = {
  id: string;
  name: string;
  isPaid: boolean;
  annualAllocation: number;
  maxCarryForward: number;
  isActive: boolean;
  createdAt: string;
};

export default function LeaveTypesPage() {
  const { toast } = useToast();
  const [types, setTypes] = React.useState<LeaveType[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LeaveType | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  // form state
  const [formName, setFormName] = React.useState('');
  const [formIsPaid, setFormIsPaid] = React.useState(true);
  const [formAllocation, setFormAllocation] = React.useState(0);
  const [formCarry, setFormCarry] = React.useState(0);

  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchLeaveTypes(true);
      setTypes(data);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load leave types.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { loadData(); }, [loadData]);

  const openDialog = (t?: LeaveType) => {
    setEditing(t || null);
    setFormName(t?.name || '');
    setFormIsPaid(t?.isPaid ?? true);
    setFormAllocation(t?.annualAllocation || 0);
    setFormCarry(t?.maxCarryForward || 0);
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
        isPaid: formIsPaid,
        annualAllocation: formAllocation,
        maxCarryForward: formCarry,
      };
      if (editing) {
        await updateLeaveType(editing.id, payload);
      } else {
        await createLeaveType(payload);
      }
      toast({ title: 'Success', description: `Leave type ${editing ? 'updated' : 'created'}.` });
      setIsDialogOpen(false);
      loadData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message || 'Failed to save.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (t: LeaveType) => {
    try {
      await updateLeaveType(t.id, { isActive: !t.isActive });
      toast({ title: 'Updated', description: `Leave type ${t.isActive ? 'deactivated' : 'activated'}.` });
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
            <CardTitle>Leave Types</CardTitle>
            <CardDescription>Configure leave categories and annual allocations.</CardDescription>
          </div>
          <Button size="sm" onClick={() => openDialog()}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add Leave Type
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : types.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No leave types configured yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Paid/Unpaid</TableHead>
                  <TableHead>Annual Allocation</TableHead>
                  <TableHead>Max Carry Forward</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      <Badge variant={t.isPaid ? 'default' : 'outline'}>{t.isPaid ? 'Paid' : 'Unpaid'}</Badge>
                    </TableCell>
                    <TableCell>{t.annualAllocation} days</TableCell>
                    <TableCell>{t.maxCarryForward} days</TableCell>
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
            <DialogTitle>{editing ? 'Edit Leave Type' : 'New Leave Type'}</DialogTitle>
            <DialogDescription>Configure leave type details.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="leave-name">Name</Label>
              <Input id="leave-name" value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Annual Leave" />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label>Paid Leave</Label>
                <p className="text-sm text-muted-foreground">Staff will receive pay during this leave.</p>
              </div>
              <Switch checked={formIsPaid} onCheckedChange={setFormIsPaid} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="leave-alloc">Annual Allocation (days)</Label>
                <Input id="leave-alloc" type="number" min={0} value={formAllocation} onChange={(e) => setFormAllocation(Number(e.target.value))} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="leave-carry">Max Carry Forward (days)</Label>
                <Input id="leave-carry" type="number" min={0} value={formCarry} onChange={(e) => setFormCarry(Number(e.target.value))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
