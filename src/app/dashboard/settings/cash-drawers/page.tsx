'use client';

import React, { useState, useEffect } from 'react';
import { getCashDrawers, createCashDrawer, updateCashDrawer, deleteCashDrawer, transferCash } from '@/services/cash-drawers';
import { CashDrawerBalanceInfo } from '@/server/modules/cash-drawers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import { Trash2, Edit, ArrowRightLeft, Plus } from 'lucide-react';

export default function CashDrawersPage() {
  const [drawers, setDrawers] = useState<CashDrawerBalanceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTransferDialogOpen, setIsTransferDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  
  const { toast } = useToast();

  const fetchDrawers = async () => {
    try {
      setIsLoading(true);
      const data = await getCashDrawers();
      setDrawers(data);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDrawers();
  }, []);

  const totalBalance = drawers.reduce((sum, d) => sum + d.balance, 0);

  const [addName, setAddName] = useState('');
  const [addIsDefault, setAddIsDefault] = useState(false);

  const handleAddDrawer = async () => {
    try {
      await createCashDrawer({ name: addName, isDefault: addIsDefault });
      toast({ title: 'Success', description: 'Cash drawer created.' });
      setIsAddDialogOpen(false);
      setAddName('');
      setAddIsDefault(false);
      fetchDrawers();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const [transferFrom, setTransferFrom] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNotes, setTransferNotes] = useState('');

  const handleTransfer = async () => {
    try {
      const amount = parseFloat(transferAmount);
      if (!transferFrom || !transferTo || isNaN(amount) || amount <= 0) {
        toast({ title: 'Error', description: 'Please fill all required fields correctly.', variant: 'destructive' });
        return;
      }
      await transferCash({
        fromDrawerId: transferFrom,
        toDrawerId: transferTo,
        amount,
        notes: transferNotes,
      });
      toast({ title: 'Success', description: 'Transfer completed successfully.' });
      setIsTransferDialogOpen(false);
      setTransferFrom('');
      setTransferTo('');
      setTransferAmount('');
      setTransferNotes('');
      fetchDrawers();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string, balance: number) => {
    if (balance !== 0) {
      toast({ title: 'Error', description: 'Cannot delete drawer with non-zero balance. Transfer funds first.', variant: 'destructive' });
      return;
    }
    if (!confirm('Are you sure you want to delete/deactivate this drawer?')) return;
    try {
      await deleteCashDrawer(id);
      toast({ title: 'Success', description: 'Drawer deactivated/deleted.' });
      fetchDrawers();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Cash Drawers</h2>
        <p className="text-muted-foreground">Manage your diverse cash drawers and balances.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Total Cash</CardTitle>
            <CardDescription>Aggregate cash in all drawers</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold">{formatCurrency(totalBalance)}</p>
          </CardContent>
        </Card>

        <Card className="flex flex-col justify-center items-center p-6 gap-4 border-dashed border-2">
           <Dialog open={isTransferDialogOpen} onOpenChange={setIsTransferDialogOpen}>
             <DialogTrigger asChild>
                <Button size="lg" className="w-full" disabled={drawers.length < 2}>
                  <ArrowRightLeft className="mr-2 h-5 w-5" /> Transfer Cash Between Drawers
                </Button>
             </DialogTrigger>
             <DialogContent>
               <DialogHeader>
                 <DialogTitle>Transfer Cash</DialogTitle>
                 <DialogDescription>Move funds between cash drawers securely.</DialogDescription>
               </DialogHeader>
               <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>From Drawer</Label>
                    <Select value={transferFrom} onValueChange={setTransferFrom}>
                      <SelectTrigger><SelectValue placeholder="Select source drawer" /></SelectTrigger>
                      <SelectContent>
                        {drawers.filter(d => d.isActive).map(d => (
                          <SelectItem key={d.id} value={d.id}>{d.name} ({formatCurrency(d.balance)})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>To Drawer</Label>
                    <Select value={transferTo} onValueChange={setTransferTo}>
                      <SelectTrigger><SelectValue placeholder="Select destination drawer" /></SelectTrigger>
                      <SelectContent>
                         {drawers.filter(d => d.isActive && d.id !== transferFrom).map(d => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Amount</Label>
                    <Input type="number" step="0.01" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} placeholder="0.00" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Notes (Optional)</Label>
                    <Input placeholder="E.g. End of day swap" value={transferNotes} onChange={e => setTransferNotes(e.target.value)} />
                  </div>
               </div>
               <DialogFooter>
                 <Button variant="outline" onClick={() => setIsTransferDialogOpen(false)}>Cancel</Button>
                 <Button onClick={handleTransfer}>Complete Transfer</Button>
               </DialogFooter>
             </DialogContent>
           </Dialog>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Cash Drawers</CardTitle>
            <CardDescription>All established drawers linked to your business cash account.</CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-2" /> Add Drawer</Button>
            </DialogTrigger>
            <DialogContent>
               <DialogHeader>
                 <DialogTitle>Add Custom Cash Drawer</DialogTitle>
                 <DialogDescription>Create a new physical or conceptual drawer.</DialogDescription>
               </DialogHeader>
               <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>Drawer Name</Label>
                    <Input placeholder="e.g. Sales Register 1" value={addName} onChange={e => setAddName(e.target.value)} />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch id="is-default" checked={addIsDefault} onCheckedChange={setAddIsDefault} />
                    <Label htmlFor="is-default">Make Default Cash Drawer</Label>
                  </div>
               </div>
               <DialogFooter>
                 <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
                 <Button onClick={handleAddDrawer}>Create Drawer</Button>
               </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Drawer Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Loading drawers...</TableCell></TableRow>}
              {!isLoading && drawers.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No cash drawers found.</TableCell></TableRow>}
              {drawers.map(drawer => (
                <TableRow key={drawer.id}>
                  <TableCell className="font-medium">
                    {drawer.name} {drawer.isDefault && <Badge variant="secondary" className="ml-2">Default</Badge>}
                  </TableCell>
                  <TableCell>
                    {drawer.isActive ? <Badge variant="outline" className="text-green-600 bg-green-50">Active</Badge> : <Badge variant="outline" className="text-red-600 bg-red-50">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(drawer.balance)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(drawer.id, drawer.balance)}>
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-600" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
