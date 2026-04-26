'use client';

import { MoreHorizontal, PlusCircle } from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Business } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { ImageUploader } from '@/components/ui/image-uploader';

export default function BusinessSettingsPage() {
  const { toast } = useToast();

  const [allBusinesses, setAllBusinesses] = useState<Business[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Edit dialog (central)
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState<Business | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete dialog (central)
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; id: string | null; name: string; }>({
    open: false,
    id: null,
    name: '',
  });

  // Force remount dropdowns/poppers after dialog close
  const [menuResetKey, setMenuResetKey] = useState(0);

  // ---------- Helpers: focus-timing ----------
  const releaseFocusToBody = () => {
    try {
      const el = document.activeElement as HTMLElement | null;
      el?.blur?.();
    } catch { }
    setTimeout(() => {
      try { document.body?.focus?.(); } catch { }
    }, 0);
  };

  // Dropdown থেকে dialog খুলতে গেলে: menu auto-close হতে দাও (onSelect), তারপর 2×RAF এ open
  const openAfterMenuSettles = (fn: () => void) => {
    // একেবারে safe timing: microtask -> RAF -> RAF -> open
    setTimeout(() => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
            fn();
          });
        });
      } else {
        try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
        fn();
      }
    }, 0);
  };

  // ---------- Data ----------
  const fetchBusinesses = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/settings/business');
      if (!res.ok) throw new Error('Failed to fetch businesses.');
      const data = await res.json();
      setAllBusinesses(data || []);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load businesses.' });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  // ---------- Edit flow ----------
  const handleOpenDialog = (business?: Business) => {
    // dropdown থেকে এলে menu আগে close হবে (onSelect), তারপর এখানে call
    openAfterMenuSettles(() => {
      setEditingBusiness(business ?? null);
      setIsDialogOpen(true);
    });
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingBusiness(null);
    releaseFocusToBody();
    setMenuResetKey(k => k + 1);
  };

  const handleSaveBusiness = async (formData: FormData) => {
    setIsSubmitting(true);
    const isEdit = !!editingBusiness;
    const method = isEdit ? 'PUT' : 'POST';
    const url = '/api/settings/business';

    if (isEdit && editingBusiness?.id) {
      formData.append('id', editingBusiness.id);
    }

    try {
      const response = await fetch(url, { method, body: formData });
      if (!response.ok) {
        let msg = 'Failed to save business.';
        try {
          const json = await response.json();
          if (json.message) msg = json.message;
        } catch {
          // Not JSON — keep default message
        }
        throw new Error(msg);
      }
      toast({ title: 'Success', description: `Business successfully ${isEdit ? 'updated' : 'created'}.` });
      handleCloseDialog();
      await fetchBusinesses();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---------- Delete flow ----------
  const openDeleteDialog = (id: string, name: string) => {
    openAfterMenuSettles(() => {
      setDeleteDialog({ open: true, id, name });
    });
  };

  const closeDeleteDialog = () => {
    setDeleteDialog(prev => ({ ...prev, open: false }));
    setTimeout(() => setDeleteDialog({ open: false, id: null, name: '' }), 0);
    releaseFocusToBody();
    setMenuResetKey(k => k + 1);
  };

  const handleDeleteOpenChange = (open: boolean) => {
    if (!open) closeDeleteDialog();
  };

  const confirmDelete = async () => {
    if (!deleteDialog.id) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/settings/business?id=${deleteDialog.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.message || 'Failed to delete business.');
      }
      setAllBusinesses(prev => prev.filter(b => b.id !== deleteDialog.id));
      toast({ title: 'Success', description: 'Business has been deleted.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
      setIsSubmitting(false);
      closeDeleteDialog();
    }
  };

  // ---------- Form ----------
  const BusinessForm = ({ business, onSave }: { business: Business | null, onSave: (data: FormData) => void }) => {
    const [name, setName] = useState(business?.name || '');
    const [phone, setPhone] = useState(business?.phone || '');
    const [address, setAddress] = useState(business?.address || '');
    const [logo, setLogo] = useState<(File | { id: string; url: string })[]>(business?.logo ? [{ id: business.id, url: business.logo }] : []);

    const handleSubmit = () => {
      if (!name.trim()) {
        toast({ variant: 'destructive', title: 'Error', description: 'Business name is required.' });
        return;
      }
      const formData = new FormData();
      formData.append('name', name);
      if (phone) formData.append('phone', phone);
      if (address) formData.append('address', address);
      if (logo.length > 0) {
        const item = logo[0];
        if (item instanceof File) formData.append('logo', item);
        else if ('url' in item) formData.append('logo', item.url);
      }
      onSave(formData);
    };

    return (
      <>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="business-name">Business Name</Label>
            <Input
              id="business-name"
              placeholder="e.g., Urban Threads"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="business-phone">Phone</Label>
            <Input
              id="business-phone"
              placeholder="e.g., +8801..."
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="business-address">Address</Label>
            <Input
              id="business-address"
              placeholder="Full address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Logo</Label>
            <ImageUploader
              images={logo}
              onImagesChange={(files) => setLogo(files)}
              isMultiple={false}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCloseDialog} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : (business ? 'Save Changes' : 'Add Business')}
          </Button>
        </DialogFooter>
      </>
    )
  };

  // ---------- Render ----------
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Business Settings</h2>
        <p className="text-muted-foreground">
          Manage your different business entities or brands.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Your Businesses</CardTitle>
            <CardDescription>
              Add, edit, or remove your business profiles.
            </CardDescription>
          </div>
          <Button onClick={() => handleOpenDialog()} size="sm">
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Business
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Logo</TableHead>
                <TableHead>Business Name</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-10 w-10 rounded-md" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-1/2" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 float-right" /></TableCell>
                  </TableRow>
                ))
              ) : allBusinesses.length > 0 ? (
                allBusinesses.map((business) => (
                  <TableRow key={`${business.id}-${menuResetKey}`}>
                    <TableCell>
                      <Image
                        src={business.logo || '/placeholder.svg'}
                        alt={`${business.name} logo`}
                        width={40}
                        height={40}
                        className="rounded-md object-cover bg-muted"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          if (target.src.indexOf('placeholder.svg') === -1) {
                            target.src = '/placeholder.svg';
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{business.name}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="icon" variant="ghost">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Toggle menu</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>

                            {/* onSelect ব্যবহৃত; preventDefault করা হয়নি → menu auto-close হবে */}
                            <DropdownMenuItem
                              onSelect={() => handleOpenDialog(business)}
                            >
                              Edit
                            </DropdownMenuItem>

                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() => openDeleteDialog(business.id, business.name)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="text-center h-24">
                    No businesses found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Central Edit Dialog */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog();
          else setIsDialogOpen(true);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBusiness ? 'Edit Business' : 'Add New Business'}</DialogTitle>
            <DialogDescription>
              {editingBusiness ? `Update the details for ${editingBusiness.name}.` : 'Enter the details for your new business entity.'}
            </DialogDescription>
          </DialogHeader>
          <BusinessForm business={editingBusiness} onSave={handleSaveBusiness} />
        </DialogContent>
      </Dialog>

      {/* Central Delete Dialog */}
      <AlertDialog open={deleteDialog.open} onOpenChange={handleDeleteOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the business profile for <strong>{deleteDialog.name}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeDeleteDialog}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={isSubmitting}>
              {isSubmitting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
