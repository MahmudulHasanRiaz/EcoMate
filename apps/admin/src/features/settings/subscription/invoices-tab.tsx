import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Receipt,
} from 'lucide-react'
import { toast } from 'sonner'
import { EmailBalanceBanner } from '@/features/settings/smtp/email-balance-banner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  downloadInvoicePdf,
  getBillingMethods,
  getInvoices,
  type BillingInvoice,
} from './api'
import { formatDate, money } from './lib'
import { ProofForm } from './proof-form'
import { STAFF_ACTION_NOTE } from './renew-tab'

function statusBadge(status: BillingInvoice['status']) {
  switch (status) {
    case 'PAID':
      return <Badge variant='default'>Paid</Badge>
    case 'OPEN':
      return <Badge variant='secondary'>Open</Badge>
    case 'DRAFT':
      return <Badge variant='outline'>Draft</Badge>
    case 'VOID':
      return <Badge variant='outline'>Void</Badge>
    case 'UNCOLLECTIBLE':
      return <Badge variant='destructive'>Uncollectible</Badge>
  }
}

interface InvoicesTabProps {
  canManage: boolean
}

export function InvoicesTab({ canManage }: InvoicesTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
  const selected = invoices.find((invoice) => invoice.id === selectedId) ?? null

  const isLoading = invoicesQuery.isLoading || methodsQuery.isLoading
  const isError = invoicesQuery.isError || methodsQuery.isError

  const downloadPdf = async (invoice: BillingInvoice) => {
    try {
      await downloadInvoicePdf(invoice)
    } catch {
      toast.error('Could not download the invoice PDF.')
    }
  }

  if (isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-40 w-full rounded-xl' />
        <Skeleton className='h-64 w-full rounded-xl' />
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      <EmailBalanceBanner />

      {isError ? (
        <div className='flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100'>
          <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0' />
          <p className='text-sm'>
            Billing is unavailable right now. Please try again later.
          </p>
        </div>
      ) : null}

      {invoices.length === 0 && !isError ? (
        <Card>
          <CardContent className='py-10 text-center text-sm text-muted-foreground'>
            <Receipt className='mx-auto mb-3 h-8 w-8 opacity-50' />
            No invoices yet. Your first invoice appears when the trial ends
            or the next billing period starts.
          </CardContent>
        </Card>
      ) : null}

      {invoices.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>
              Select an invoice to see its details or submit a payment proof.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            {invoices.map((invoice) => {
              const overdue =
                invoice.status === 'OPEN' && new Date(invoice.dueAt) < new Date()
              return (
                <button
                  key={invoice.id}
                  type='button'
                  onClick={() => setSelectedId(invoice.id)}
                  className={`flex w-full flex-wrap items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${
                    selectedId === invoice.id
                      ? 'border-primary bg-muted/50'
                      : ''
                  }`}
                >
                  <FileText className='h-5 w-5 shrink-0 opacity-60' />
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate font-medium'>
                      {invoice.number}
                    </span>
                    <span className='block text-xs text-muted-foreground'>
                      Due {formatDate(invoice.dueAt)}
                      {invoice.periodStart && invoice.periodEnd
                        ? ` · ${formatDate(invoice.periodStart)} — ${formatDate(invoice.periodEnd)}`
                        : ''}
                    </span>
                  </span>
                  {overdue ? (
                    <Badge variant='destructive'>Overdue</Badge>
                  ) : null}
                  <span className='text-sm font-medium'>
                    {money(invoice.total, invoice.currency)}
                  </span>
                  {statusBadge(invoice.status)}
                </button>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      {selected ? (
        <Card>
          <CardHeader>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div>
                <CardTitle>Invoice {selected.number}</CardTitle>
                <CardDescription>
                  Issued {formatDate(selected.createdAt)} · Due{' '}
                  {formatDate(selected.dueAt)}
                </CardDescription>
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => downloadPdf(selected)}
              >
                <Download className='me-2 h-4 w-4' />
                Download PDF
              </Button>
            </div>
          </CardHeader>
          <CardContent className='space-y-6'>
            <div className='space-y-1 text-sm'>
              {selected.lines.map((line) => (
                <div key={line.id} className='flex justify-between gap-4'>
                  <span className='text-muted-foreground'>
                    {line.description}
                    {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                  </span>
                  <span>{money(line.amount, selected.currency)}</span>
                </div>
              ))}
              <div className='flex justify-between gap-4 border-t pt-2 font-medium'>
                <span>Total</span>
                <span>{money(selected.total, selected.currency)}</span>
              </div>
              <div className='flex justify-between gap-4'>
                <span className='text-muted-foreground'>Paid</span>
                <span>{money(selected.paidAmount, selected.currency)}</span>
              </div>
              {selected.creditAmount > 0 ? (
                <div className='flex justify-between gap-4'>
                  <span className='text-muted-foreground'>Credit applied</span>
                  <span>
                    −{money(selected.creditAmount, selected.currency)}
                  </span>
                </div>
              ) : null}
              <div className='flex justify-between gap-4 font-medium'>
                <span>Remaining</span>
                <span>{money(selected.remaining, selected.currency)}</span>
              </div>
            </div>

            {selected.proofs.length > 0 ? (
              <div className='space-y-2'>
                <h3 className='text-sm font-medium'>Payment proofs</h3>
                {selected.proofs.map((proof) => (
                  <div
                    key={proof.id}
                    className='flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm'
                  >
                    <span className='font-mono text-xs'>
                      {proof.transactionId}
                    </span>
                    <span>{money(proof.amount, selected.currency)}</span>
                    <span className='text-xs text-muted-foreground'>
                      {formatDate(proof.createdAt)}
                    </span>
                    <Badge
                      variant={
                        proof.status === 'APPROVED'
                          ? 'default'
                          : proof.status === 'REJECTED'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {proof.status}
                    </Badge>
                    {proof.status === 'REJECTED' && proof.rejectionReason ? (
                      <span className='w-full text-xs text-red-700'>
                        {proof.rejectionReason}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {selected.status === 'OPEN' && selected.remaining > 0 ? (
              canManage ? (
                <ProofForm
                  key={selected.id}
                  invoice={selected}
                  methods={methods}
                />
              ) : (
                <div className='flex items-start gap-3 rounded-lg border p-4 text-sm text-muted-foreground'>
                  <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0' />
                  <p>{STAFF_ACTION_NOTE}</p>
                </div>
              )
            ) : null}

            {selected.status === 'PAID' ? (
              <div className='flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100'>
                <CheckCircle2 className='mt-0.5 h-5 w-5 shrink-0' />
                <p className='text-sm'>
                  Paid
                  {selected.paidAt
                    ? ` on ${formatDate(selected.paidAt)}`
                    : ''}
                  . Thank you.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
