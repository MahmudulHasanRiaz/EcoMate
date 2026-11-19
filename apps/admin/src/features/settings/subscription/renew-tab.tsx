import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  earliestOpenInvoice,
  getBillingMethods,
  getEntitlements,
  getInvoices,
} from './api'
import { formatDate, money } from './lib'
import { ProofForm } from './proof-form'

export const STAFF_ACTION_NOTE =
  'Ask your store admin to renew or change the plan.'

interface RenewTabProps {
  canManage: boolean
}

export function RenewTab({ canManage }: RenewTabProps) {
  const snapshotQuery = useQuery({
    queryKey: ['entitlements', 'me'],
    queryFn: getEntitlements,
    staleTime: 60_000,
  })

  const invoicesQuery = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: getInvoices,
  })

  const methodsQuery = useQuery({
    queryKey: ['billing', 'methods'],
    queryFn: getBillingMethods,
  })

  const invoices = invoicesQuery.data ?? []
  const methods = methodsQuery.data ?? []
  const openInvoice = earliestOpenInvoice(invoices)
  const isLoading =
    snapshotQuery.isLoading || invoicesQuery.isLoading || methodsQuery.isLoading

  if (isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-40 w-full rounded-xl' />
        <Skeleton className='h-64 w-full rounded-xl' />
      </div>
    )
  }

  if (!openInvoice) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-lg'>
            <CalendarClock className='h-5 w-5 text-muted-foreground' />
            Next renewal
          </CardTitle>
          <CardDescription>
            There is no open renewal invoice right now.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-2'>
          <p className='text-sm'>
            Your plan renews on{' '}
            <span className='font-medium'>
              {formatDate(snapshotQuery.data?.validUntil ?? null)}
            </span>
            .
          </p>
          <p className='text-sm text-muted-foreground'>
            The renewal invoice appears here before the renewal date — come
            back then to pay it.
          </p>
        </CardContent>
      </Card>
    )
  }

  const overdue = new Date(openInvoice.dueAt) < new Date()

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle className='text-lg'>Renew now</CardTitle>
          <CardDescription>
            Pay the open renewal invoice to keep your plan active.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-1 text-sm'>
          <div className='flex justify-between gap-4'>
            <span className='text-muted-foreground'>Invoice</span>
            <span className='font-medium'>{openInvoice.number}</span>
          </div>
          <div className='flex justify-between gap-4'>
            <span className='text-muted-foreground'>Amount due</span>
            <span className='font-medium'>
              {money(openInvoice.remaining, openInvoice.currency)}
            </span>
          </div>
          <div className='flex justify-between gap-4'>
            <span className='text-muted-foreground'>Due date</span>
            <span className='font-medium'>{formatDate(openInvoice.dueAt)}</span>
          </div>
          {overdue ? (
            <p className='flex items-center gap-1 pt-2 text-xs font-medium text-red-600'>
              <AlertTriangle className='h-3 w-3' />
              This invoice is overdue — renew as soon as possible to avoid
              losing access.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {methods.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Payment methods</CardTitle>
            <CardDescription>
              Pay with one of these methods, then submit the transaction id
              below.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {methods.map((method) => (
              <div key={method.id} className='rounded-lg border p-3 text-sm'>
                <p className='font-medium'>{method.name}</p>
                {method.accountNumber ? (
                  <p className='text-muted-foreground'>
                    Send to {method.accountNumber}
                    {method.accountName ? ` (${method.accountName})` : ''}
                  </p>
                ) : null}
                {method.instructions ? (
                  <p className='mt-1 text-xs text-muted-foreground'>
                    {method.instructions}
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {canManage ? (
        <ProofForm invoice={openInvoice} methods={methods} />
      ) : (
        <div className='flex items-start gap-3 rounded-lg border p-4 text-sm text-muted-foreground'>
          <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0' />
          <p>{STAFF_ACTION_NOTE}</p>
        </div>
      )}
    </div>
  )
}
