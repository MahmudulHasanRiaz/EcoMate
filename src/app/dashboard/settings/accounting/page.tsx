

'use client';

import * as React from 'react';
import { MoreHorizontal, PlusCircle } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createAccount, deleteAccount, getChartOfAccounts } from '@/services/accounting';
import type { Account, AccountType } from '@/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';

const accountTypes: AccountType[] = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];

export default function ChartOfAccountsSettingsPage() {
    const { toast } = useToast();
    const [accounts, setAccounts] = React.useState<Account[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [isDialogOpen, setIsDialogOpen] = React.useState(false);
    const [menuResetKey, setMenuResetKey] = React.useState(0);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [newAccountName, setNewAccountName] = React.useState('');
    const [newAccountType, setNewAccountType] = React.useState<AccountType | ''>('');
    const [newAccountGroup, setNewAccountGroup] = React.useState<string>('none');
    const [deleteDialog, setDeleteDialog] = React.useState<{ open: boolean; account: Account | null }>({
        open: false,
        account: null,
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

     React.useEffect(() => {
        setIsLoading(true);
        getChartOfAccounts().then(data => {
            setAccounts(data);
            setIsLoading(false);
        });
    }, []);

    const openDeleteDialog = (account: Account) => {
        openAfterMenu(() => setDeleteDialog({ open: true, account }));
    };

    const closeDeleteDialog = () => {
        setDeleteDialog({ open: false, account: null });
        setTimeout(() => {
            releaseFocus();
            setMenuResetKey(k => k + 1);
        }, 0);
    };

    const handleCreateAccount = async () => {
        if (!newAccountName.trim() || !newAccountType) return;
        try {
            setIsSubmitting(true);
            await createAccount({ 
                name: newAccountName.trim(), 
                type: newAccountType,
                group: newAccountGroup !== 'none' ? newAccountGroup : null
            });
            const refreshed = await getChartOfAccounts();
            setAccounts(refreshed);
            setNewAccountName('');
            setNewAccountType('');
            setNewAccountGroup('none');
            setIsDialogOpen(false);
            toast({ title: 'Account created' });
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Failed to create account',
                description: error?.message || 'Something went wrong.',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteAccount = async () => {
        if (!deleteDialog.account) return;
        try {
            setIsSubmitting(true);
            await deleteAccount(deleteDialog.account.id);
            const refreshed = await getChartOfAccounts();
            setAccounts(refreshed);
            toast({ title: 'Account deleted' });
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Failed to delete account',
                description: error?.message || 'Something went wrong.',
            });
        } finally {
            setIsSubmitting(false);
            closeDeleteDialog();
        }
    };
    
    const renderTable = () => (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Account Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {isLoading ? (
                    [...Array(5)].map((_, i) => (
                        <TableRow key={i}>
                            <TableCell colSpan={4}><Skeleton className="h-6 w-full" /></TableCell>
                        </TableRow>
                    ))
                ) : accounts.map(account => (
                    <TableRow key={account.id}>
                        <TableCell className="font-medium">{account.name}</TableCell>
                        <TableCell>{account.type}</TableCell>
                        <TableCell>{account.group || '-'}</TableCell>
                        <TableCell>
                            <div className="flex justify-end">
                                <DropdownMenu key={`${account.id}-${menuResetKey}`}>
                                    <DropdownMenuTrigger asChild>
                                        <Button aria-haspopup="true" size="icon" variant="ghost">
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                        <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialog(account)}>Delete</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );

    const renderCards = () => (
        <div className="space-y-4">
            {isLoading ? (
                 [...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
            ) : (
                accounts.map(account => (
                     <Card key={account.id}>
                        <CardContent className="p-4">
                            <div className="flex justify-between items-start">
                                <div>
                                    <p className="font-semibold">{account.name}</p>
                                    <p className="text-sm text-muted-foreground">{account.type}</p>
                                    {account.group && <p className="text-xs text-muted-foreground mt-1">Group: {account.group}</p>}
                                </div>
                                <DropdownMenu key={`${account.id}-card-${menuResetKey}`}>
                                    <DropdownMenuTrigger asChild>
                                        <Button aria-haspopup="true" size="icon" variant="ghost">
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                        <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialog(account)}>Delete</DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </CardContent>
                    </Card>
                ))
            )}
        </div>
    );

    return (
        <div className="space-y-6">
             <div>
                <h2 className="text-2xl font-bold tracking-tight">Chart of Accounts</h2>
                <p className="text-muted-foreground">
                    Manage all financial accounts used for tracking transactions.
                </p>
            </div>
            <Card>
                <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex-1 mb-4 sm:mb-0">
                        <CardTitle>All Accounts</CardTitle>
                        <CardDescription>A list of all financial accounts for your business.</CardDescription>
                    </div>
                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                        <DialogTrigger asChild>
                            <Button>
                                <PlusCircle className="mr-2 h-4 w-4" /> Add Account
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Add New Account</DialogTitle>
                                <DialogDescription>
                                    Create a new account for tracking transactions. E.g., &quot;City Bank Account&quot; or &quot;bKash Merchant&quot;.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="space-y-2">
                                    <Label htmlFor="account-name">Account Name</Label>
                                    <Input
                                        id="account-name"
                                        placeholder="e.g., City Bank"
                                        value={newAccountName}
                                        onChange={(e) => setNewAccountName(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="account-type">Account Type</Label>
                                    <Select value={newAccountType} onValueChange={(value) => setNewAccountType(value as AccountType)}>
                                        <SelectTrigger id="account-type">
                                            <SelectValue placeholder="Select a type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {accountTypes.map(type => (
                                                <SelectItem key={type} value={type}>{type}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="account-group">Account Group</Label>
                                    <Select value={newAccountGroup} onValueChange={(value) => setNewAccountGroup(value)}>
                                        <SelectTrigger id="account-group">
                                            <SelectValue placeholder="Select a group (optional)" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">None</SelectItem>
                                            <SelectItem value="LIQUID">LIQUID</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                                <Button onClick={handleCreateAccount} disabled={isSubmitting || !newAccountName.trim() || !newAccountType}>
                                    {isSubmitting ? 'Saving...' : 'Save Account'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </CardHeader>
                <CardContent>
                   <div className="hidden sm:block">
                       {renderTable()}
                   </div>
                    <div className="sm:hidden">
                       {renderCards()}
                   </div>
                </CardContent>
            </Card>
            <AlertDialog open={deleteDialog.open} onOpenChange={(open) => { if (!open) closeDeleteDialog(); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the account <strong>{deleteDialog.account?.name}</strong>.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteAccount}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
