
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

import type { StockLocation } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

export default function LocationsSettingsPage() {
    const { toast } = useToast();
    const [allLocations, setAllLocations] = useState<StockLocation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
    const [selectedLocation, setSelectedLocation] = useState<StockLocation | null>(null);
    const [locationName, setLocationName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [menuResetKey, setMenuResetKey] = useState(0);
    const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; location: StockLocation | null }>({
        open: false,
        location: null,
    });

    const releaseFocus = () => {
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            (document.activeElement as HTMLElement | null)?.blur?.();
        } catch { /* no-op */ }
        setTimeout(() => {
            try { document.body?.focus?.(); } catch {}
        }, 0);
    };

    const openAfterMenu = (fn: () => void) => {
        releaseFocus();
        setTimeout(() => {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => requestAnimationFrame(fn));
            } else {
                fn();
            }
        }, 0);
    };

    const fetchLocations = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/settings/locations');
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();
            setAllLocations(data);
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to load locations.' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchLocations();
    }, [fetchLocations]);

    const handleOpenDialog = (mode: 'add' | 'edit', location?: StockLocation) => {
        openAfterMenu(() => {
            setDialogMode(mode);
            setSelectedLocation(location || null);
            setLocationName(location ? location.name : '');
            setIsDialogOpen(true);
        });
    };

    const handleCloseDialog = () => {
        setIsDialogOpen(false);
        setSelectedLocation(null);
        setLocationName('');
        setTimeout(() => {
            releaseFocus();
            setMenuResetKey(k => k + 1);
        }, 0);
    }

    const handleSaveLocation = async () => {
        if (!locationName.trim()) {
            toast({ variant: 'destructive', title: 'Error', description: 'Location name cannot be empty.' });
            return;
        }
        
        setIsSubmitting(true);
        const isEdit = dialogMode === 'edit';
        const url = '/api/settings/locations';
        const method = isEdit ? 'PUT' : 'POST';
        const body = JSON.stringify(isEdit ? { id: selectedLocation?.id, name: locationName } : { name: locationName });

        try {
            const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to save location.');
            }
            toast({ title: 'Success', description: `Location successfully ${isEdit ? 'updated' : 'created'}.` });
            handleCloseDialog();
            await fetchLocations(); // Re-fetch to update the list
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleDeleteLocation = async (location: StockLocation) => {
        try {
            const response = await fetch(`/api/settings/locations?id=${location.id}`, { method: 'DELETE' });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to delete location.');
            }
            toast({ title: 'Success', description: `Location "${location.name}" has been deleted.` });
            // Optimistically update UI
            setAllLocations(prev => prev.filter(l => l.id !== location.id));
            closeDeleteDialog();
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        }
    };

    const openDeleteDialog = (location: StockLocation) => {
        openAfterMenu(() => setDeleteDialog({ open: true, location }));
    };

    const closeDeleteDialog = () => {
        setDeleteDialog({ open: false, location: null });
        setTimeout(() => {
            releaseFocus();
            setMenuResetKey(k => k + 1);
        }, 0);
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight">Stock Locations</h2>
                <p className="text-muted-foreground">
                    Manage your warehouses, showrooms, and other stock locations.
                </p>
            </div>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Your Locations</CardTitle>
                        <CardDescription>
                            Add, edit, or remove your stock locations.
                        </CardDescription>
                    </div>
                    <Button onClick={() => handleOpenDialog('add')}>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Add Location
                    </Button>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Location Name</TableHead>
                                <TableHead>
                                    <span className="sr-only">Actions</span>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                [...Array(3)].map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell><Skeleton className="h-5 w-1/2" /></TableCell>
                                        <TableCell><Skeleton className="h-8 w-8 float-right" /></TableCell>
                                    </TableRow>
                                ))
                            ) : allLocations.length > 0 ? (
                                allLocations.map((location) => (
                                    <TableRow key={location.id}>
                                        <TableCell className="font-medium">{location.name}</TableCell>
                                        <TableCell>
                                            <div className="flex justify-end">
                                                 <DropdownMenu key={`${location.id}-${menuResetKey}`}>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button aria-haspopup="true" size="icon" variant="ghost">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                            <span className="sr-only">Toggle menu</span>
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                                        <DropdownMenuItem onSelect={() => handleOpenDialog('edit', location)}>Edit</DropdownMenuItem>
                                                        <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialog(location)}>Delete</DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={2} className="text-center h-24">
                                        No locations found.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="flex flex-col max-h-[90vh] overflow-hidden p-0">
                    <div className="flex-none p-6 pb-2">
                        <DialogHeader>
                            <DialogTitle>{dialogMode === 'edit' ? 'Edit Location' : 'Add New Location'}</DialogTitle>
                            <DialogDescription>
                               {dialogMode === 'edit' ? 'Update the name of this location.' : 'Enter the name for your new stock location.'}
                            </DialogDescription>
                        </DialogHeader>
                    </div>
                    <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
                        <div className="grid gap-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="location-name">Location Name</Label>
                                <Input 
                                    id="location-name" 
                                    placeholder="e.g., Showroom 3"
                                    value={locationName}
                                    onChange={(e) => setLocationName(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="flex-none p-6 pt-0">
                        <DialogFooter>
                            <Button variant="outline" onClick={handleCloseDialog} disabled={isSubmitting}>Cancel</Button>
                            <Button onClick={handleSaveLocation} disabled={isSubmitting}>
                                {isSubmitting ? 'Saving...' : 'Save'}
                            </Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>
            <AlertDialog open={deleteDialog.open} onOpenChange={(open) => { if (!open) closeDeleteDialog(); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the <strong>{deleteDialog.location?.name}</strong> location.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteDialog.location && handleDeleteLocation(deleteDialog.location)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
