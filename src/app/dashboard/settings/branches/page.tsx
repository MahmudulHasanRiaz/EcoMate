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
import { useToast } from '@/hooks/use-toast';
import { getBranches, createBranch, updateBranch, deleteBranch } from '@/services/branches';
import type { Branch } from '@/types';

export default function BranchesSettingsPage() {
  const { toast } = useToast();
  const [branches, setBranches] = React.useState<Branch[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [editingBranch, setEditingBranch] = React.useState<Branch | null>(null);
  const [formName, setFormName] = React.useState('');
  const [formCode, setFormCode] = React.useState('');
  const [isSaving, setIsSaving] = React.useState(false);
  const [deleteDialog, setDeleteDialog] = React.useState<{ open: boolean; branch: Branch | null }>({
    open: false,
    branch: null,
  });

  const fetchBranches = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getBranches();
      setBranches(data);
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load branches.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    fetchBranches();
  }, [fetchBranches]);

  const openDialog = (branch?: Branch) => {
    setEditingBranch(branch || null);
    setFormName(branch?.name || '');
    setFormCode(branch?.code || '');
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Branch name is required.' });
      return;
    }
    setIsSaving(true);
    try {
      if (editingBranch) {
        await updateBranch(editingBranch.id, { name: formName.trim(), code: formCode.trim() || undefined });
      } else {
        await createBranch({ name: formName.trim(), code: formCode.trim() || undefined });
      }
      toast({ title: 'Success', description: `Branch ${editingBranch ? 'updated' : 'created'}.` });
      setIsDialogOpen(false);
      fetchBranches();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message || 'Failed to save.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (branch: Branch) => {
    try {
      await updateBranch(branch.id, { isActive: !branch.isActive });
      toast({ title: 'Success', description: `Branch ${branch.isActive ? 'deactivated' : 'activated'}.` });
      fetchBranches();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  const handleDelete = async () => {
    if (!deleteDialog.branch) return;
    try {
      await deleteBranch(deleteDialog.branch.id);
      toast({ title: 'Deleted', description: `Branch "${deleteDialog.branch.name}" deleted.` });
      fetchBranches();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setDeleteDialog({ open: false, branch: null });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Branch Management</h2>
        <p className="text-muted-foreground">
          Create and manage branches for expense tracking.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Branches</CardTitle>
            <CardDescription>Organize expenses by branch location.</CardDescription>
          </div>
          <Button onClick={() => openDialog()} size="sm">
            <PlusCircle className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Add Branch</span>
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}><Skeleton className="h-6 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : branches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                    No branches created yet. Click "Add Branch" to start.
                  </TableCell>
                </TableRow>
              ) : branches.map((branch) => (
                <TableRow key={branch.id}>
                  <TableCell className="font-medium">{branch.name}</TableCell>
                  <TableCell className="text-muted-foreground">{branch.code || '-'}</TableCell>
                  <TableCell>
                    <Badge variant={branch.isActive ? 'default' : 'secondary'}>
                      {branch.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button aria-haspopup="true" size="icon" variant="ghost" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Toggle menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem onSelect={() => openDialog(branch)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => handleToggleActive(branch)}>
                            {branch.isActive ? 'Deactivate' : 'Activate'}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteDialog({ open: true, branch })}>
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBranch ? 'Edit Branch' : 'Add Branch'}</DialogTitle>
            <DialogDescription>
              {editingBranch ? 'Update branch details.' : 'Create a new branch.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="branch-name">Branch Name</Label>
              <Input
                id="branch-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g., Main Office"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-code">Code (optional)</Label>
              <Input
                id="branch-code"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder="e.g., HQ"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialog.open} onOpenChange={(open) => { if (!open) setDeleteDialog({ open: false, branch: null }); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Branch?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteDialog.branch?.name}</strong>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
