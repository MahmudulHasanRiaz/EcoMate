'use client';

import { MoreHorizontal, PlusCircle, Handshake, DollarSign, Loader2, Coins } from "lucide-react";
import React, { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
    CardFooter,
} from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getPartnerOverviewStats, getSuppliers, getVendors } from "@/services/partners";
import type { Supplier, Vendor } from "@/types";
import { useToast } from "@/hooks/use-toast";

const ITEMS_PER_PAGE = 5;
type Partner = Supplier | Vendor;

export default function PartnersPage() {
    const { toast } = useToast();
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [totalSuppliers, setTotalSuppliers] = useState(0);
    const [totalVendors, setTotalVendors] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [partnerDues, setPartnerDues] = useState<Record<string, number>>({});
    const [partnerCredits, setPartnerCredits] = useState<Record<string, number>>({});
    const [overviewStats, setOverviewStats] = useState({ totalBusiness: 0, totalDue: 0, totalCredit: 0 });

    // Pagination State
    const [supplierCursor, setSupplierCursor] = useState<string | null>(null);
    const [supplierKey, setSupplierKey] = useState(0);
    const [hasMoreSuppliers, setHasMoreSuppliers] = useState(false);
    const [loadingMoreSuppliers, setLoadingMoreSuppliers] = useState(false);

    const [vendorCursor, setVendorCursor] = useState<string | null>(null);
    const [vendorKey, setVendorKey] = useState(0);
    const [hasMoreVendors, setHasMoreVendors] = useState(false);
    const [loadingMoreVendors, setLoadingMoreVendors] = useState(false);

    // Dialog & Other states
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [dialogMode, setDialogMode] = useState<'addSupplier' | 'addVendor' | 'editSupplier' | 'editVendor' | null>(null);
    const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [menuResetKey, setMenuResetKey] = useState(0);
    const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; partner: Partner | null }>({
        isOpen: false,
        partner: null,
    });

    const itemsPerPage = ITEMS_PER_PAGE;

    // Initial Load
    useEffect(() => {
        setIsLoading(true);
        Promise.all([
            getSuppliers({ pageSize: itemsPerPage, includeTotal: true }),
            getVendors({ pageSize: itemsPerPage, includeTotal: true }),
            getPartnerOverviewStats(),
        ]).then(([suppliersData, vendorsData, overviewData]) => {
            const sData = (suppliersData as any) || {};
            const vData = (vendorsData as any) || {};

            setSuppliers(sData.items || []);
            setTotalSuppliers(sData.total || 0);
            setSupplierCursor(sData.nextCursor || null);
            setHasMoreSuppliers(!!sData.nextCursor);

            setVendors(vData.items || []);
            setTotalVendors(vData.total || 0);
            setVendorCursor(vData.nextCursor || null);
            setHasMoreVendors(!!vData.nextCursor);

            setPartnerDues(overviewData.partnerDues || {});
            setPartnerCredits(overviewData.partnerCredits || {});
            setOverviewStats({
                totalBusiness: Number(overviewData.totalBusiness) || 0,
                totalDue: Number(overviewData.totalDue) || 0,
                totalCredit: Number(overviewData.totalCredit) || 0,
            });
            setIsLoading(false);
        }).catch((err) => {
            console.error(err);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to load partner data.' });
            setIsLoading(false);
        });
    }, [supplierKey, vendorKey, toast]);

    const loadMoreSuppliers = async () => {
        if (!supplierCursor || loadingMoreSuppliers) return;
        setLoadingMoreSuppliers(true);
        try {
            const response = await getSuppliers({ cursor: supplierCursor, pageSize: itemsPerPage });
            const data = (response as any) || {};
            if (data.items?.length) {
                setSuppliers(prev => [...prev, ...data.items]);
                setSupplierCursor(data.nextCursor);
                setHasMoreSuppliers(!!data.nextCursor);
            } else {
                setHasMoreSuppliers(false);
            }
        } catch (err) {
            console.error(err);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to load more suppliers.' });
        } finally {
            setLoadingMoreSuppliers(false);
        }
    };

    const loadMoreVendors = async () => {
        if (!vendorCursor || loadingMoreVendors) return;
        setLoadingMoreVendors(true);
        try {
            const response = await getVendors({ cursor: vendorCursor, pageSize: itemsPerPage });
            const data = (response as any) || {};
            if (data.items?.length) {
                setVendors(prev => [...prev, ...data.items]);
                setVendorCursor(data.nextCursor);
                setHasMoreVendors(!!data.nextCursor);
            } else {
                setHasMoreVendors(false);
            }
        } catch (err) {
            console.error(err);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to load more vendors.' });
        } finally {
            setLoadingMoreVendors(false);
        }
    };

    // Refresh helper
    const refreshData = () => {
        setSupplierKey(k => k + 1);
        setVendorKey(k => k + 1);
    };

    const openDialog = (mode: typeof dialogMode, partner?: Partner) => {
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            (document.activeElement as HTMLElement | null)?.blur?.();
        } catch { /* no-op */ }
        window.setTimeout(() => {
            setDialogMode(mode);
            setSelectedPartner(partner || null);
            setIsDialogOpen(true);
        }, 0);
    };

    const closeDialog = () => {
        setIsDialogOpen(false);
        setDialogMode(null);
        setSelectedPartner(null);
        window.setTimeout(() => {
            try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
            try { document.body?.focus?.(); } catch { }
            setMenuResetKey((key) => key + 1);
        }, 0);
    };

    const openDeleteDialog = (partner: Partner) => {
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            (document.activeElement as HTMLElement | null)?.blur?.();
        } catch { /* no-op */ }
        window.setTimeout(() => {
            setDeleteDialog({ isOpen: true, partner });
        }, 0);
    };

    const closeDeleteDialog = () => {
        setDeleteDialog({ isOpen: false, partner: null });
        window.setTimeout(() => {
            try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
            try { document.body?.focus?.(); } catch { }
            setMenuResetKey((key) => key + 1);
        }, 0);
    };

    const handleSave = async (partnerData: Partial<Partner>, alsoCreate: boolean = false) => {
        setIsSubmitting(true);
        const isEdit = dialogMode === 'editSupplier' || dialogMode === 'editVendor';
        const isSupplier = dialogMode?.includes('Supplier');

        // Define explicit payloads to ensure only relevant fields are sent to each endpoint
        const baseData = {
            name: partnerData.name,
            contactPerson: partnerData.contactPerson,
            email: partnerData.email,
            phone: partnerData.phone,
        };
        const supplierPayload = { ...baseData, address: (partnerData as any).address };
        const vendorPayload = { ...baseData, type: (partnerData as any).type };

        if (isEdit && partnerData.id) {
            (supplierPayload as any).id = partnerData.id;
            (vendorPayload as any).id = partnerData.id;
        }

        const primaryEndpoint = isSupplier ? '/api/partners/suppliers' : '/api/partners/vendors';
        const primaryPayload = isSupplier ? supplierPayload : vendorPayload;

        try {
            const response = await fetch(primaryEndpoint, {
                method: isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(primaryPayload),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `Failed to ${isEdit ? 'update' : 'create'} partner.`);
            }

            if (alsoCreate && !isEdit) {
                const secondaryEndpoint = isSupplier ? '/api/partners/vendors' : '/api/partners/suppliers';
                const secondaryPayload = isSupplier ? vendorPayload : supplierPayload;

                // Strip ID from secondary creation if somehow present
                delete (secondaryPayload as any).id;

                const secondaryResponse = await fetch(secondaryEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(secondaryPayload),
                });

                if (!secondaryResponse.ok) {
                    const error = await secondaryResponse.json();
                    throw new Error(error.message || `Primary partner created, but secondary role creation failed.`);
                }
            }

            toast({ title: 'Success', description: `Partner successfully ${isEdit ? 'updated' : 'created'}${alsoCreate ? ' (dual entry created)' : ''}.` });
            closeDialog();
            refreshData();
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (partner: Partner) => {
        const isSupplier = 'address' in partner;
        const endpoint = isSupplier ? `/api/partners/suppliers?id=${partner.id}` : `/api/partners/vendors?id=${partner.id}`;

        try {
            const response = await fetch(endpoint, { method: 'DELETE' });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to delete partner.');
            }
            toast({ title: 'Success', description: `Partner "${partner.name}" has been deleted.` });
            refreshData();
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Error', description: error.message });
        } finally {
            closeDeleteDialog();
        }
    }

    const renderSupplierTable = () => (
        <Table>
            <TableHeader><TableRow><TableHead>Supplier Name</TableHead><TableHead>Contact Person</TableHead><TableHead className="hidden sm:table-cell">Email</TableHead><TableHead className="text-right">Total Due</TableHead><TableHead className="text-right">Credit Balance</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
                {suppliers.map((supplier) => {
                    const due = Number(partnerDues[supplier.name]) || 0;
                    return (
                        <TableRow key={supplier.id}>
                            <TableCell className="font-medium"><Link href={`/dashboard/partners/${supplier.id}`} className="hover:underline">{supplier.name}</Link></TableCell>
                            <TableCell>{supplier.contactPerson}</TableCell>
                            <TableCell className="hidden sm:table-cell">{supplier.email}</TableCell>
                            <TableCell className={cn("text-right font-mono", due > 0 ? "text-destructive" : "")}>Tk {due.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono text-primary">Tk {(Number(supplier.creditBalance) || 0).toLocaleString()}</TableCell>
                            <TableCell>
                                <DropdownMenu key={`${supplier.id}-menu-${menuResetKey}`}>
                                    <DropdownMenuTrigger asChild><Button aria-haspopup="true" size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /><span className="sr-only">Toggle menu</span></Button></DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                        <DropdownMenuItem asChild><Link href={`/dashboard/partners/${supplier.id}`}>View Details</Link></DropdownMenuItem>
                                        <DropdownMenuItem asChild><Link href={`/dashboard/partners/${supplier.id}?pay=1`}>Record Payment</Link></DropdownMenuItem>
                                        <DropdownMenuItem onSelect={() => openDialog('editSupplier', supplier)}>Edit</DropdownMenuItem>
                                        <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialog(supplier)}>Delete</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );

    const renderSupplierCards = () => (
        <div className="space-y-4">
            {suppliers.map((supplier) => {
                const due = Number(partnerDues[supplier.name]) || 0;
                return (
                    <Card key={supplier.id} className="overflow-hidden">
                        <CardContent className="p-4 space-y-3">
                            <div className="flex justify-between items-start">
                                <div><Link href={`/dashboard/partners/${supplier.id}`} className="font-semibold hover:underline">{supplier.name}</Link><p className="text-sm text-muted-foreground">{supplier.contactPerson}</p></div>
                                <DropdownMenu key={`${supplier.id}-card-menu-${menuResetKey}`}>
                                    <DropdownMenuTrigger asChild><Button aria-haspopup="true" size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /><span className="sr-only">Toggle menu</span></Button></DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                        <DropdownMenuItem asChild><Link href={`/dashboard/partners/${supplier.id}`}>View Details</Link></DropdownMenuItem>
                                        <DropdownMenuItem asChild><Link href={`/dashboard/partners/${supplier.id}?pay=1`}>Record Payment</Link></DropdownMenuItem>
                                        <DropdownMenuItem onSelect={() => openDialog('editSupplier', supplier)}>Edit</DropdownMenuItem>
                                        <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialog(supplier)}>Delete</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <Separator />
                            <div className="flex justify-between items-end">
                                <div>
                                    <p className="text-xs text-muted-foreground">{supplier.email}</p>
                                    <p className="text-xs font-semibold text-primary">Credit: Tk {(Number(supplier.creditBalance) || 0).toLocaleString()}</p>
                                </div>
                                <div className="text-right"><p className="text-sm text-muted-foreground">Total Due</p><p className={cn("font-semibold font-mono", due > 0 ? "text-destructive" : "")}>Tk {due.toLocaleString()}</p></div>
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );

    const renderVendorTable = () => (
        <Table>
            <TableHeader><TableRow><TableHead>Vendor Name</TableHead><TableHead>Type</TableHead><TableHead>Contact Person</TableHead><TableHead className="text-right">Total Due</TableHead><TableHead className="text-right">Credit Balance</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
            <TableBody>
                {vendors.map((vendor) => {
                    const due = Number(partnerDues[vendor.name]) || 0;
                    return (
                        <TableRow key={vendor.id}>
                            <TableCell className="font-medium"><Link href={`/dashboard/partners/${vendor.id}`} className="hover:underline">{vendor.name}</Link></TableCell>
                            <TableCell><Badge variant={vendor.type === "Printing" ? "secondary" : "outline"}>{vendor.type}</Badge></TableCell>
                            <TableCell>{vendor.contactPerson}</TableCell>
                            <TableCell className={cn("text-right font-mono", due > 0 ? "text-destructive" : "")}>Tk {due.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono text-primary">Tk {(Number(vendor.creditBalance) || 0).toLocaleString()}</TableCell>
                            <TableCell>
                                <DropdownMenu key={`${vendor.id}-menu-${menuResetKey}`}>
                                    <DropdownMenuTrigger asChild><Button aria-haspopup="true" size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /><span className="sr-only">Toggle menu</span></Button></DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                        <DropdownMenuItem asChild><Link href={`/dashboard/partners/${vendor.id}`}>View Details</Link></DropdownMenuItem>
                                        <DropdownMenuItem asChild><Link href={`/dashboard/partners/${vendor.id}?pay=1`}>Record Payment</Link></DropdownMenuItem>
                                        <DropdownMenuItem onSelect={() => openDialog('editVendor', vendor)}>Edit</DropdownMenuItem>
                                        <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialog(vendor)}>Delete</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );

    const renderVendorCards = () => (
        <div className="space-y-4">
            {vendors.map((vendor) => {
                const due = Number(partnerDues[vendor.name]) || 0;
                return (
                    <Card key={vendor.id} className="overflow-hidden">
                        <CardContent className="p-4 space-y-3">
                            <div className="flex justify-between items-start">
                                <div><Link href={`/dashboard/partners/${vendor.id}`} className="font-semibold hover:underline">{vendor.name}</Link><p className="text-sm text-muted-foreground">{vendor.contactPerson}</p></div>
                                <DropdownMenu key={`${vendor.id}-card-menu-${menuResetKey}`}>
                                    <DropdownMenuTrigger asChild><Button aria-haspopup="true" size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /><span className="sr-only">Toggle menu</span></Button></DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                        <DropdownMenuItem asChild><Link href={`/dashboard/partners/${vendor.id}`}>View Details</Link></DropdownMenuItem>
                                        <DropdownMenuItem asChild><Link href={`/dashboard/partners/${vendor.id}?pay=1`}>Record Payment</Link></DropdownMenuItem>
                                        <DropdownMenuItem onSelect={() => openDialog('editVendor', vendor)}>Edit</DropdownMenuItem>
                                        <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialog(vendor)}>Delete</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <Separator />
                            <div className="flex justify-between items-end">
                                <div>
                                    <Badge variant={vendor.type === "Printing" ? "secondary" : "outline"}>{vendor.type}</Badge>
                                    <p className="text-xs font-semibold text-primary mt-1">Credit: Tk {(Number(vendor.creditBalance) || 0).toLocaleString()}</p>
                                </div>
                                <div className="text-right"><p className="text-sm text-muted-foreground">Total Due</p><p className={cn("font-semibold font-mono", due > 0 ? "text-destructive" : "")}>Tk {due.toLocaleString()}</p></div>
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );

    const PartnerForm = ({ partner, mode, onSave }: { partner: Partner | null; mode: typeof dialogMode; onSave: (data: any, alsoCreate: boolean) => void; }) => {
        const isSupplier = mode?.includes('Supplier');
        const isEdit = mode?.startsWith('edit');
        const [alsoCreate, setAlsoCreate] = useState(false);
        const [selectedTypes, setSelectedTypes] = useState<string[]>(() => {
            if (!isSupplier && partner) {
                const t = (partner as Vendor).type || '';
                return t.split(',').map(x => x.trim()).filter(Boolean);
            }
            return [];
        });

        const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const data: Record<string, any> = Object.fromEntries(formData.entries());
            if (partner?.id) {
                data.id = partner.id;
            }
            if (!isSupplier || alsoCreate) {
                const type = selectedTypes.join(', ');
                if ((alsoCreate || !isSupplier) && !type) {
                    toast({ variant: 'destructive', title: 'Error', description: 'Please select at least one vendor type.' });
                    return;
                }
                data.type = type;
            }

            if (alsoCreate && !isSupplier && !data.address) {
                toast({ variant: 'destructive', title: 'Error', description: 'Please provide an address for the supplier record.' });
                return;
            }

            onSave(data, alsoCreate);
        };

        const toggleType = (t: string) => {
            setSelectedTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
        };

        return (
            <form onSubmit={handleSubmit}>
                <div className="grid gap-4 py-4">
                    <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={partner?.name} required /></div>
                    <div className="space-y-2"><Label htmlFor="contactPerson">Contact Person</Label><Input id="contactPerson" name="contactPerson" defaultValue={partner?.contactPerson} required /></div>
                    <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" defaultValue={partner?.email} required /></div>
                    <div className="space-y-2"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" defaultValue={partner?.phone} required /></div>
                    <div className="space-y-2"><Label htmlFor="address">Address</Label><Input id="address" name="address" defaultValue={(partner as Supplier)?.address || (partner as any)?.address} required={isSupplier || alsoCreate} /></div>

                    {(!isSupplier || alsoCreate) && (
                        <div className="space-y-2">
                            <Label>Vendor Type</Label>
                            <div className="flex flex-wrap gap-3 pt-1">
                                {['Printing', 'Cutting'].map((t) => (
                                    <div key={t} className="flex items-center space-x-2">
                                        <input type="checkbox" id={`type-${t}`} checked={selectedTypes.includes(t)} onChange={() => toggleType(t)} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
                                        <label htmlFor={`type-${t}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">{t}</label>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {!isEdit && (
                        <div className="flex items-center space-x-2 pt-2">
                            <input type="checkbox" id="alsoCreate" checked={alsoCreate} onChange={(e) => setAlsoCreate(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" />
                            <Label htmlFor="alsoCreate" className="text-sm text-muted-foreground">{isSupplier ? "Also create as Vendor" : "Also create as Supplier"}</Label>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" type="button" onClick={closeDialog} disabled={isSubmitting}>Cancel</Button>
                    <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Save'}</Button>
                </DialogFooter>
            </form>
        );
    };

    return (
        <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center mb-4"><div className="flex-1"><h1 className="font-headline text-2xl font-bold">Partners</h1><p className="text-muted-foreground hidden sm:block">Manage your suppliers and vendors.</p></div></div>
            <div className="grid gap-4 grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Business</CardTitle><Handshake className="h-4 w-4 text-muted-foreground" /></CardHeader>
                    <CardContent><div className="text-2xl font-bold">Tk {overviewStats.totalBusiness.toLocaleString()}</div><p className="text-xs text-muted-foreground">Total transaction with all partners</p></CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Due</CardTitle><DollarSign className="h-4 w-4 text-muted-foreground" /></CardHeader>
                    <CardContent><div className={cn("text-2xl font-bold", overviewStats.totalDue > 0 && "text-destructive")}>Tk {overviewStats.totalDue.toLocaleString()}</div><p className="text-xs text-muted-foreground">Total outstanding amount to all partners</p></CardContent>
                </Card>
                <Card className="bg-primary/5">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Credit</CardTitle>
                        <Coins className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-primary">Tk {overviewStats.totalCredit.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground text-primary/80">Total advance credit available</p>
                    </CardContent>
                </Card>
            </div>
            <Tabs defaultValue="suppliers">
                <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="suppliers">Suppliers</TabsTrigger><TabsTrigger value="vendors">Vendors</TabsTrigger></TabsList>
                <TabsContent value="suppliers">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>Suppliers</CardTitle><CardDescription>Manage your material and service suppliers.</CardDescription></div><Button onClick={() => openDialog('addSupplier')}><PlusCircle className="mr-2 h-4 w-4" />Add Supplier</Button></CardHeader>
                        <CardContent>{isLoading ? <div className="h-24 text-center flex items-center justify-center text-muted-foreground">Loading...</div> : <><div className="hidden sm:block">{renderSupplierTable()}</div><div className="sm:hidden">{renderSupplierCards()}</div></>}</CardContent>
                        <CardFooter className="flex flex-col items-center">
                            <div className="w-full text-xs text-muted-foreground text-center mb-2">
                                Showing <strong>{suppliers.length}</strong> of <strong>{totalSuppliers}</strong> suppliers
                            </div>
                            {hasMoreSuppliers && (
                                <Button variant="outline" onClick={loadMoreSuppliers} disabled={loadingMoreSuppliers}>
                                    {loadingMoreSuppliers ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</> : "Load More Suppliers"}
                                </Button>
                            )}
                        </CardFooter>
                    </Card>
                </TabsContent>
                <TabsContent value="vendors">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>Vendors</CardTitle><CardDescription>Manage your printing and cutting vendors.</CardDescription></div><Button onClick={() => openDialog('addVendor')}><PlusCircle className="mr-2 h-4 w-4" />Add Vendor</Button></CardHeader>
                        <CardContent>{isLoading ? <div className="h-24 text-center flex items-center justify-center text-muted-foreground">Loading...</div> : <><div className="hidden sm:block">{renderVendorTable()}</div><div className="sm:hidden">{renderVendorCards()}</div></>}</CardContent>
                        <CardFooter className="flex flex-col items-center">
                            <div className="w-full text-xs text-muted-foreground text-center mb-2">
                                Showing <strong>{vendors.length}</strong> of <strong>{totalVendors}</strong> vendors
                            </div>
                            {hasMoreVendors && (
                                <Button variant="outline" onClick={loadMoreVendors} disabled={loadingMoreVendors}>
                                    {loadingMoreVendors ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</> : "Load More Vendors"}
                                </Button>
                            )}
                        </CardFooter>
                    </Card>
                </TabsContent>
            </Tabs>
            <AlertDialog open={deleteDialog.isOpen} onOpenChange={(open) => { if (!open) closeDeleteDialog(); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete <strong>{deleteDialog.partner?.name}</strong>. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteDialog.partner && handleDelete(deleteDialog.partner)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{dialogMode?.startsWith('edit') ? 'Edit ' : 'Add New '}{dialogMode?.includes('Supplier') ? 'Supplier' : 'Vendor'}</DialogTitle>
                        <DialogDescription>Fill in the details for the partner.</DialogDescription>
                    </DialogHeader>
                    <PartnerForm partner={selectedPartner} mode={dialogMode} onSave={handleSave} />
                </DialogContent>
            </Dialog>
        </div>
    );
}
