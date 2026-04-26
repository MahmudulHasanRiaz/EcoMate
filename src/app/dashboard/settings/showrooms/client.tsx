'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function ShowroomsClient({ initialData, locations, cashDrawers, staff, usedLocationIds = [], usedCashDrawerIds = [] }: any) {
    const { toast } = useToast();

    const router = useRouter();
    const [data, setData] = useState(initialData);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    
    const [id, setId] = useState('');
    const [name, setName] = useState('');
    const [locationId, setLocationId] = useState('');
    const [cashDrawerId, setCashDrawerId] = useState('');
    const [defaultInvoiceNote, setDefaultInvoiceNote] = useState('');
    const [isActive, setIsActive] = useState(true);
    const [staffAccess, setStaffAccess] = useState<string[]>([]);

    useEffect(() => {
        setData(initialData);
    }, [initialData]);

    const handleOpen = (item?: any) => {
        if (item) {
            setId(item.id);
            setName(item.name);
            setLocationId(item.locationId);
            setCashDrawerId(item.cashDrawerId);
            setDefaultInvoiceNote(item.defaultInvoiceNote || '');
            setIsActive(Boolean(item.isActive));
            setStaffAccess((item.Accesses || []).map((a: any) => a.staffId));
        } else {
            setId('');
            setName('');
            setLocationId('');
            setCashDrawerId('');
            setDefaultInvoiceNote('');
            setIsActive(true);
            setStaffAccess([]);
        }
        setOpen(true);
    };

    const handleSave = async () => {
        if (!name || !locationId || !cashDrawerId) {
            toast({ title: 'Error', description: 'Name, Location, and Cash Drawer are required', variant: 'destructive' });
            return;
        }

        setLoading(true);
        try {
            const method = id ? 'PUT' : 'POST';
            const url = '/api/settings/showrooms' + (id ? `?id=${id}` : '');
            
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, locationId, cashDrawerId, defaultInvoiceNote, isActive, staffIds: staffAccess })
            });

            const result = await res.json();
            if (!res.ok) throw new Error(result.message || result.error || 'Failed to save');

            toast({ title: 'Success', description: id ? 'Showroom updated' : 'Showroom created' });
            setOpen(false);
            router.refresh();
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (deleteId: string) => {
        if (!confirm('Deactivate this showroom?')) return;
        try {
            const res = await fetch(`/api/settings/showrooms?id=${deleteId}`, { method: 'DELETE' });
            const result = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(result?.message || 'Failed to deactivate');
            toast({ title: 'Success', description: 'Showroom deactivated' });
            router.refresh();
        } catch (e: any) {
            toast({ title: 'Error', description: e.message, variant: 'destructive' });
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Showrooms</h2>
                    <p className="text-muted-foreground">Manage POS showrooms and their stock/cash mappings.</p>
                </div>
                <Button onClick={() => handleOpen()}><Plus className="w-4 h-4 mr-2" /> Add Showroom</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.map((item: any) => (
                    <div key={item.id} className="border rounded-lg p-5 bg-card shadow-sm space-y-4 relative">
                        <div className="flex justify-between items-start">
                            <h3 className="font-semibold text-lg">{item.name}</h3>
                            <div className="flex space-x-2">
                                <Button variant="ghost" size="icon" onClick={() => handleOpen(item)}><Edit2 className="w-4 h-4" /></Button>
                                <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="w-4 h-4" /></Button>
                            </div>
                        </div>
                        <div className="text-sm space-y-1 text-muted-foreground">
                            <p><strong>Status:</strong> {item.isActive ? 'Active' : 'Inactive'}</p>
                            <p><strong>Location:</strong> {item.StockLocation?.name || 'N/A'}</p>
                            <p><strong>Cash Drawer:</strong> {item.CashDrawer?.name || 'N/A'}</p>
                            <p><strong>Staff Access:</strong> {item.Accesses?.length || 0} assigned</p>
                        </div>
                    </div>
                ))}
                {data.length === 0 && (
                    <div className="col-span-full text-center py-12 text-muted-foreground bg-muted/20 border-dashed border-2 rounded-lg">
                        No showrooms configured yet.
                    </div>
                )}
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-[425px] max-h-[90vh] flex flex-col overflow-hidden p-0">
                    <div className="flex-none p-6 pb-2">
                        <DialogHeader>
                            <DialogTitle>{id ? 'Edit Showroom' : 'Add Showroom'}</DialogTitle>
                        </DialogHeader>
                    </div>
                    <div className="flex-1 overflow-y-auto px-6 py-2 custom-scrollbar">
                        <div className="space-y-4 py-2">
                            <div className="space-y-2">
                                <Label>Showroom Name</Label>
                                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Main Branch POS" />
                            </div>
                            <div className="space-y-2">
                                <Label>Inventory Location</Label>
                                <Select value={locationId} onValueChange={setLocationId}>
                                    <SelectTrigger><SelectValue placeholder="Select Location" /></SelectTrigger>
                                    <SelectContent>
                                        {locations
                                            .filter((l: any) => !usedLocationIds.includes(l.id) || l.id === locationId)
                                            .map((l: any) => (
                                                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                                            ))}
                                        {locations.filter((l: any) => !usedLocationIds.includes(l.id) || l.id === locationId).length === 0 && (
                                            <div className="px-3 py-2 text-sm text-muted-foreground">No available locations. Create a new stock location first.</div>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Assigned Cash Drawer</Label>
                                <Select value={cashDrawerId} onValueChange={setCashDrawerId}>
                                    <SelectTrigger><SelectValue placeholder="Select Cash Drawer" /></SelectTrigger>
                                    <SelectContent>
                                        {cashDrawers
                                            .filter((c: any) => !usedCashDrawerIds.includes(c.id) || c.id === cashDrawerId)
                                            .map((c: any) => (
                                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                            ))}
                                        {cashDrawers.filter((c: any) => !usedCashDrawerIds.includes(c.id) || c.id === cashDrawerId).length === 0 && (
                                            <div className="px-3 py-2 text-sm text-muted-foreground">No available cash drawers. Create one in Cash Drawers settings.</div>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Default Invoice Note (Optional)</Label>
                                <Input value={defaultInvoiceNote} onChange={(e) => setDefaultInvoiceNote(e.target.value)} placeholder="Shown on thermal/A4 print" />
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    id="showroom-active"
                                    type="checkbox"
                                    checked={isActive}
                                    onChange={(e) => setIsActive(e.target.checked)}
                                />
                                <Label htmlFor="showroom-active">Active</Label>
                            </div>
                            <div className="space-y-2">
                                <Label>Staff Access</Label>
                                <div className="border rounded p-2 max-h-40 overflow-y-auto space-y-1">
                                    {staff.map((s: any) => (
                                        <label key={s.id} className="flex items-center space-x-2 text-sm">
                                            <input 
                                                type="checkbox" 
                                                checked={staffAccess.includes(s.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) setStaffAccess([...staffAccess, s.id]);
                                                    else setStaffAccess(staffAccess.filter(id => id !== s.id));
                                                }}
                                            />
                                            <span>{s.name} ({s.phone})</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex-none p-6 pt-2 border-t">
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                            <Button onClick={handleSave} disabled={loading}>{loading ? 'Saving...' : 'Save'}</Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
