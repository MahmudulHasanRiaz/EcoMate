'use client';

import * as React from 'react';
import { usePermissions } from '@/hooks/use-permissions';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import useSWR from 'swr';
import { getOrders, restoreOrder } from '@/services/orders';
import { format } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { RotateCcw, AlertTriangle } from 'lucide-react';
import { normalizeBdPhoneForStorage } from '@/lib/phone';
import { useUser } from '@clerk/nextjs';

export default function TrashOrdersPage() {
  const { user } = useUser();
  const role = (user?.publicMetadata?.role as string || '').trim();
  const router = useRouter();
  const { toast } = useToast();
  
  React.useEffect(() => {
     if (role && role !== 'Admin') {
         router.replace('/unauthorized');
     }
  }, [role, router]);

  const { data: leadsData, isLoading, mutate: refreshLeads } = useSWR(
    ['trash-orders'],
    async () => getOrders({
      status: 'trash',
      pageSize: 50,
      page: 1,
    }),
    { revalidateOnFocus: false }
  );

  const paginatedOrders = (leadsData as any)?.items || [];
  
  const handleRestore = async (orderId: string) => {
    try {
      await restoreOrder(orderId);
      toast({ title: 'Success', description: 'Order restored successfully' });
      refreshLeads();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message || 'Failed to restore', variant: 'destructive' });
    }
  };

  if (role !== 'Admin') {
     return <div className="p-8"><Skeleton className="h-40 w-full" /></div>;
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex-1">
          <h1 className="font-headline text-2xl sm:text-3xl font-bold tracking-tight text-destructive flex items-center gap-2">
             <AlertTriangle className="h-6 w-6" /> Trash Orders
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            System deleted orders. Information is retained for audit purposes.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deleted Orders List</CardTitle>
          <CardDescription>
            Orders that have been soft-deleted by administrators.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Deleted Date</TableHead>
                <TableHead>Delete Note</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}><Skeleton className="h-10 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : paginatedOrders.length > 0 ? (
                paginatedOrders.map((order: any) => {
                  const phoneMeta = normalizeBdPhoneForStorage(order.customerPhone || '');
                  const phoneDisplay = phoneMeta.isValid ? phoneMeta.last11 : (phoneMeta.value || order.customerPhone || '');
                  
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">
                        {order.orderNumber || order.id?.substring(0, 8)}
                      </TableCell>
                      <TableCell>
                        <p className="font-bold">{order.customerName}</p>
                        <p className="text-xs text-muted-foreground">{phoneDisplay}</p>
                      </TableCell>
                      <TableCell>{order.deletedAt ? format(new Date(order.deletedAt), 'MMM d, yyyy HH:mm') : '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-muted-foreground">
                           {order.deleteNote || 'No reason provided'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => handleRestore(order.id)}>
                          <RotateCcw className="h-3 w-3 mr-1" /> Restore
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center">
                    No deleted orders found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
