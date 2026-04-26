'use server';

import { format } from 'date-fns';
import { CheckStatus } from '@prisma/client';
import Link from 'next/link';
import { getPendingPurchaseChecksCore, updateCheckStatusCore } from '@server/modules/purchases';
import { revalidatePath } from 'next/cache';
import { getStaffAuthDetails } from '@/server/modules/staff-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { Separator } from '@/components/ui/separator';
import { CheckDetailsDialog } from './_components/check-details-dialog';

const fmtMoney = (val: number) =>
  `Tk ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function markStatus(formData: FormData) {
  'use server';
  const auth = await getStaffAuthDetails();
  if (auth.status === 'blocked') return;
  const perm = auth.staff?.permissions?.accounting;
  if (perm && !perm.update) return;
  const paymentId = formData.get('paymentId') as string;
  const status = formData.get('status') as CheckStatus;
  if (!paymentId || !status) return;
  await updateCheckStatusCore({ paymentId, status });
  revalidatePath('/dashboard/accounting/checks');
}

export default async function CheckQueuePage() {
  const auth = await getStaffAuthDetails();
  if (auth.status === 'blocked') {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Access restricted.
      </div>
    );
  }
  const perm = auth.staff?.permissions?.accounting;
  if (perm && !perm.read) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Access restricted.
      </div>
    );
  }
  const pendingChecks = await getPendingPurchaseChecksCore();

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-headline text-2xl font-bold">Pending Checks</h1>
        <p className="text-muted-foreground">Manage check payments awaiting clearance.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Check Queue</CardTitle>
            <CardDescription>All purchase payments with pending checks.</CardDescription>
          </div>
          <Badge variant="secondary">{pendingChecks.length} pending</Badge>
        </CardHeader>
        <CardContent>
          {pendingChecks.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No pending checks.</div>
          ) : (
            <>
              {/* Mobile-friendly cards */}
              <div className="space-y-3 md:hidden">
                {pendingChecks.map((payment) => {
                  const amount = (payment.cash || 0) + (payment.check || 0);
                  const stepLabel = payment.ProductionStep?.stepType || payment.paymentFor || 'General';
                  return (
                    <Card key={payment.id}>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              href={`/dashboard/purchases/${payment.poId}`}
                              className="font-semibold underline-offset-2 hover:underline"
                            >
                              {payment.poId}
                            </Link>
                            <div className="text-sm text-muted-foreground">{stepLabel}</div>
                          </div>
                          <div className="text-right text-sm font-mono">{fmtMoney(amount)}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="text-muted-foreground">Vendor</div>
                          <div className="text-right">{payment.Vendor?.name || '-'}</div>
                          <div className="text-muted-foreground">Check Date</div>
                          <div className="text-right">
                            {payment.checkDate ? format(new Date(payment.checkDate), 'PP') : 'Not set'}
                          </div>
                          <div className="text-muted-foreground">Check No</div>
                          <div className="text-right font-mono">{(payment as any).checkNo || '-'}</div>
                        </div>


                        <Separator />
                        <div className="flex justify-end">
                          <CheckDetailsDialog payment={payment as any} />
                        </div>
                        <Separator />
                        <div className="grid grid-cols-1 gap-2">
                          <form action={markStatus}>
                            <input type="hidden" name="paymentId" value={payment.id} />
                            <input type="hidden" name="status" value="Passed" />
                            <Button size="sm" variant="secondary" className="w-full">Mark Passed</Button>
                          </form>
                          <form action={markStatus}>
                            <input type="hidden" name="paymentId" value={payment.id} />
                            <input type="hidden" name="status" value="Bounced" />
                            <Button size="sm" variant="destructive" className="w-full text-white">Bounce</Button>
                          </form>
                          <form action={markStatus}>
                            <input type="hidden" name="paymentId" value={payment.id} />
                            <input type="hidden" name="status" value="Cancelled" />
                            <Button size="sm" variant="ghost" className="w-full">Cancel</Button>
                          </form>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Table for larger screens */}
              <div className="hidden w-full overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO</TableHead>
                      <TableHead>Step</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Check No</TableHead>
                      <TableHead>Check Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingChecks.map((payment) => {
                      const amount = (payment.cash || 0) + (payment.check || 0);
                      return (
                        <TableRow key={payment.id}>
                          <TableCell className="font-medium">
                            <Link href={`/dashboard/purchases/${payment.poId}`} className="underline-offset-2 hover:underline">
                              {payment.poId}
                            </Link>
                          </TableCell>
                          <TableCell>
                            {payment.ProductionStep?.stepType || payment.paymentFor || 'General'}
                          </TableCell>
                          <TableCell>
                            {payment.Vendor?.name || '-'}
                          </TableCell>
                          <TableCell className="font-mono">
                            {(payment as any).checkNo || '-'}
                          </TableCell>
                          <TableCell>
                            {payment.checkDate ? format(new Date(payment.checkDate), 'PP') : 'Not set'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {fmtMoney(amount)}
                          </TableCell>
                          <TableCell className="text-right space-y-1">
                            <div className="inline-flex gap-2 items-center">
                              <CheckDetailsDialog payment={payment as any} />
                              <form action={markStatus}>
                                <input type="hidden" name="paymentId" value={payment.id} />
                                <input type="hidden" name="status" value="Passed" />
                                <Button size="sm" variant="secondary">Mark Passed</Button>
                              </form>
                              <form action={markStatus}>
                                <input type="hidden" name="paymentId" value={payment.id} />
                                <input type="hidden" name="status" value="Bounced" />
                                <Button size="sm" variant="destructive" className="text-white">Bounce</Button>
                              </form>
                            </div>
                            <Separator className="my-1" />
                            <form action={markStatus}>
                              <input type="hidden" name="paymentId" value={payment.id} />
                              <input type="hidden" name="status" value="Cancelled" />
                              <Button size="sm" variant="ghost">Cancel</Button>
                            </form>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div >
  );
}
