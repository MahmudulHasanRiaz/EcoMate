
'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { MoreHorizontal, PlusCircle, Users, Repeat, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { DateRange } from "react-day-picker";
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCustomer, updateCustomer, deleteCustomer } from '@/services/customers';
import type { Customer, CustomerCreateInput, CustomerUpdateInput, CustomerType } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { handleApiResponse } from '@/lib/api-helper';
import { defaultBadgeRules, getBadgeForValue, normalizeBadgeRules } from '@/lib/badges';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const ITEMS_PER_PAGE = 20;

const fetcher = (url: string) => fetch(url).then((res) => handleApiResponse(res)) as Promise<any>;

type CustomersApi = { customers: Customer[]; nextCursor?: string | null; totalCustomers?: number; repeatCustomers?: number };

interface CustomerStats {
  totalCustomers: number;
  repeatCustomers: number;
}


export default function CustomersClientPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  const [searchTerm, setSearchTerm] = React.useState(initialSearch);
  const [deferredSearch, setDeferredSearch] = React.useState(initialSearch);
  const [, startTransition] = React.useTransition();
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined);
  const [customerType, setCustomerType] = React.useState<'All' | 'Retail' | 'Wholesaler'>('All');

  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [editingCustomer, setEditingCustomer] = React.useState<Customer | null>(null);
  const [menuResetKey, setMenuResetKey] = React.useState(0);
  const [deleteDialog, setDeleteDialog] = React.useState<{ isOpen: boolean; customer: Customer | null }>({
    isOpen: false,
    customer: null,
  });

  const releaseFocus = () => {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch { }
  };

  const openAfterMenu = (fn: () => void) => {
    releaseFocus();
    window.setTimeout(() => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(fn));
      } else {
        fn();
      }
    }, 0);
  };

  const resetMenuFocus = () => {
    try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
    window.setTimeout(() => {
      try { document.body?.focus?.(); } catch { }
      setMenuResetKey(k => k + 1);
    }, 0);
  };

  // Fetch Stats
  const { data: stats, error: statsError } = useSWR<CustomerStats>(
    dateRange?.from ? `/api/customers/stats?dateFrom=${dateRange.from.toISOString()}&dateTo=${dateRange.to?.toISOString() || ''}` : '/api/customers/stats',
    fetcher
  );

  const { data: generalSettings } = useSWR('/api/settings/general', fetcher);
  const badgeRules = React.useMemo(
    () => normalizeBadgeRules(generalSettings?.badgeRules, defaultBadgeRules),
    [generalSettings]
  );

  // Infinite Loading for Customers
  const getKey = (pageIndex: number, previousPageData: any) => {
    if (previousPageData && !previousPageData.nextCursor) return null;
    const cursor = previousPageData?.nextCursor || '';
    const typeQuery = customerType !== 'All' ? `&type=${customerType}` : '';
    return `/api/customers?search=${deferredSearch}&cursor=${cursor}&pageSize=${ITEMS_PER_PAGE}${typeQuery}`;
  };

  const { data: infiniteData, size, setSize, isValidating, mutate, error: customersError } = useSWRInfinite<CustomersApi>(getKey, fetcher);

  const allCustomers = React.useMemo(() => {
    return infiniteData ? infiniteData.flatMap(page => page.customers || []) : [];
  }, [infiniteData]);

  const lastPage = infiniteData ? infiniteData[infiniteData.length - 1] : null;
  const nextCursor = lastPage?.nextCursor ?? null;
  const hasMore = !!nextCursor;
  const isLoading = !infiniteData && isValidating;

  React.useEffect(() => {
    if (statsError) {
      toast({
        variant: 'destructive',
        title: 'Failed to load customer stats',
        description: statsError?.message || 'Please try again.',
      });
    }
  }, [statsError, toast]);

  React.useEffect(() => {
    if (customersError) {
      toast({
        variant: 'destructive',
        title: 'Failed to load customers',
        description: customersError?.message || 'Please try again.',
      });
    }
  }, [customersError, toast]);

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    startTransition(() => {
      setDeferredSearch(val);
    });
  };

  const handleOpenDialog = (customer?: Customer) => {
    openAfterMenu(() => {
      setEditingCustomer(customer || null);
      setIsDialogOpen(true);
    });
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingCustomer(null);
    resetMenuFocus();
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      closeDialog();
    } else {
      setIsDialogOpen(true);
    }
  };

  const handleSaveCustomer = async (data: { name: string, phone: string, address: string, type: string }) => {
    try {
      if (editingCustomer) {
        const updateData: CustomerUpdateInput = {
          name: data.name,
          phone: data.phone,
          address: data.address,
          type: data.type as CustomerType,
        };
        await updateCustomer(editingCustomer.id, updateData);
        toast({ title: "Customer Updated", description: `${data.name}'s details have been updated.` });
      } else {
        const createData: CustomerCreateInput = {
          name: data.name,
          phone: data.phone,
          address: data.address,
          type: data.type as CustomerType,
          email: '',
          district: 'Dhaka',
          country: 'Bangladesh',
        };
        await createCustomer(createData);
        toast({ title: "Customer Added", description: `${data.name} has been added.` });
      }
      mutate();
      closeDialog();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const openDeleteDialog = (customer: Customer) => {
    openAfterMenu(() => setDeleteDialog({ isOpen: true, customer }));
  };

  const closeDeleteDialog = () => {
    setDeleteDialog({ isOpen: false, customer: null });
    resetMenuFocus();
  };

  const handleDeleteCustomer = async () => {
    const customer = deleteDialog.customer;
    if (!customer) return;
    try {
      await deleteCustomer(customer.id);
      mutate();
      toast({ title: "Customer Deleted", description: `${customer.name} has been deleted.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      closeDeleteDialog();
    }
  };

  const renderTable = () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Customer Name</TableHead>
          <TableHead className="hidden sm:table-cell">Phone</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="hidden md:table-cell">Total Orders</TableHead>
          <TableHead className="hidden md:table-cell text-right">Total Spent</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {allCustomers.map(customer => {
          const customerBadge = getBadgeForValue(badgeRules.customerOrders, customer.totalOrders || 0);
          return (
          <TableRow key={customer.id}>
            <TableCell className="font-medium">
              <div className="flex flex-wrap items-center gap-2">
                <span>{customer.name}</span>
                {customerBadge && (
                  <Badge variant="outline" className={customerBadge.color}>
                    {customerBadge.label}
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="hidden sm:table-cell">{customer.phone}</TableCell>
            <TableCell>
              <Badge variant="outline" className={cn(
                customer.type === 'Wholesaler' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'
              )}>
                {customer.type || 'Retail'}
              </Badge>
            </TableCell>
            <TableCell className="hidden md:table-cell">{customer.totalOrders}</TableCell>
            <TableCell className="hidden md:table-cell text-right font-mono text-primary font-bold">
              Tk {(customer.totalSpent ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </TableCell>
            <TableCell>
              <DropdownMenu key={`${customer.id}-${menuResetKey}`}>
                <DropdownMenuTrigger asChild>
                  <Button aria-haspopup="true" size="icon" variant="ghost">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Toggle menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href={`/dashboard/customers/${customer.id}`}>View Details</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleOpenDialog(customer)}>Edit</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialog(customer)}>Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
          );
        })}
        {allCustomers.length === 0 && !isLoading && (
          <TableRow>
            <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
              No customers found.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  const renderCardList = () => (
    <div className="space-y-4">
      {allCustomers.map(customer => {
        const customerBadge = getBadgeForValue(badgeRules.customerOrders, customer.totalOrders || 0);
        return (
        <Card key={customer.id}>
          <CardContent className="p-4 space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{customer.name}</p>
                  {customerBadge && (
                    <Badge variant="outline" className={customerBadge.color}>
                      {customerBadge.label}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{customer.phone}</p>
              </div>
              <DropdownMenu key={`${customer.id}-card-${menuResetKey}`}>
                <DropdownMenuTrigger asChild>
                  <Button aria-haspopup="true" size="icon" variant="ghost">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">Toggle menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <Link href={`/dashboard/customers/${customer.id}`}>View Details</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleOpenDialog(customer)}>Edit</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onSelect={() => openDeleteDialog(customer)}>Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Separator />
            <div className="flex justify-between items-center text-sm">
              <div>
                <p className="text-muted-foreground">Orders</p>
                <p className="font-medium">{customer.totalOrders}</p>
              </div>
              <div className="text-right">
                <p className="text-muted-foreground">Total Spent</p>
                <p className="font-semibold font-mono text-primary font-bold">Tk {(customer.totalSpent ?? 0).toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        );
      })}
    </div>
  );

  const CustomerForm = ({ customer, onSave }: { customer: Customer | null; onSave: (data: any) => void; }) => {
    const [name, setName] = React.useState(customer?.name || '');
    const [phone, setPhone] = React.useState(customer?.phone || '');
    const [address, setAddress] = React.useState(customer?.address || '');
    const [type, setType] = React.useState(customer?.type || 'Retail');

    const handleSubmit = () => {
      onSave({ name, phone, address, type });
    };

    return (
      <>
        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="customer-name">Name</Label>
            <Input id="customer-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter customer's name" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-phone">Phone</Label>
            <Input id="customer-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter phone number" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-type">Type</Label>
            <Select value={type} onValueChange={(v: any) => setType(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Retail">Retail</SelectItem>
                <SelectItem value="Wholesaler">Wholesaler</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-address">Address</Label>
            <Textarea id="customer-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter full address" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={closeDialog}>Cancel</Button>
          <Button onClick={handleSubmit}>{customer ? 'Save Changes' : 'Save Customer'}</Button>
        </DialogFooter>
      </>
    )
  };


  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex-1">
          <h1 className="font-headline text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground hidden sm:block">
            Enterprise scale customer management with real-time stats.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
          <DateRangePicker date={dateRange} onDateChange={setDateRange} className="w-full sm:w-auto" />
          <Button size="sm" className="w-full sm:w-auto shadow-md" onClick={() => handleOpenDialog()}>
            <PlusCircle className="h-4 w-4 sm:mr-2" />
            <span>Add Customer</span>
          </Button>
        </div>
      </div>
      <div className="grid gap-4 grid-cols-2">
        <Card className="overflow-hidden border-l-4 border-l-primary">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {dateRange?.from ? 'New Customers' : 'Total Customers'}
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats?.totalCustomers ?? 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {dateRange?.from ? 'Customers who joined in this period' : 'All customers in the system'}
            </p>
          </CardContent>
        </Card>
        <Card className="overflow-hidden border-l-4 border-l-orange-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Repeat Customers</CardTitle>
            <Repeat className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats?.repeatCustomers ?? 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {dateRange?.from ? 'Customers with 2+ orders in this period' : 'Customers with 2+ orders lifetime'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Customer List</CardTitle>
              <CardDescription>Filtering and pagination handled on server.</CardDescription>
            </div>
            {isValidating && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="pt-4 flex items-center gap-4">
            <Input
              placeholder="Search by name or phone..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="max-w-sm"
            />
            <Select value={customerType} onValueChange={(v: any) => setCustomerType(v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Customer Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Types</SelectItem>
                <SelectItem value="Retail">Retail</SelectItem>
                <SelectItem value="Wholesaler">Wholesaler</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-48 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p>Loading customers...</p>
            </div>
          ) : (
            <>
              <div className="hidden sm:block">{renderTable()}</div>
              <div className="sm:hidden">{renderCardList()}</div>
            </>
          )}
        </CardContent>
        <CardFooter className="flex justify-center border-t bg-muted/50 p-4">
          {hasMore ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSize(size + 1)}
              disabled={isValidating}
              className="bg-background shadow-sm"
            >
              {isValidating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : 'Load More Customers'}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {allCustomers.length > 0 ? "You've reached the end of the list." : ""}
            </p>
          )}
        </CardFooter>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCustomer ? 'Edit Customer' : 'Add New Customer'}</DialogTitle>
            <DialogDescription>
              {editingCustomer ? `Update the details for ${editingCustomer.name}.` : 'Fill in the details to create a new customer profile.'}
            </DialogDescription>
          </DialogHeader>
          <CustomerForm customer={editingCustomer} onSave={handleSaveCustomer} />
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteDialog.isOpen} onOpenChange={(open) => { if (!open) closeDeleteDialog(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the customer profile for <strong>{deleteDialog.customer?.name}</strong> and remove their data from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCustomer}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
