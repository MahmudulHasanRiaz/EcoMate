import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Receipt,
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

export interface BillingInvoiceLine {
  id: string
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export interface BillingInvoiceProof {
  id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  amount: number
  transactionId: string
  createdAt: string
  rejectionReason: string | null
}

export interface BillingInvoice {
  id: string
  number: string
  status: 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE'
  subtotal: number
  discount: number
  tax: number
  total: number
  currency: string
  dueAt: string
  paidAt: string | null
  periodStart: string | null
  periodEnd: string | null
  notes: string | null
  createdAt: string
  lines: BillingInvoiceLine[]
  proofs: BillingInvoiceProof[]
  paidAmount: number
  creditAmount: number
  remaining: number
}

export interface BillingMethod {
  id: string
  type: string
  name: string
  accountNumber: string | null
  accountName: string | null
  instructions: string | null
}

function money(amount: number, currency: string) {
  return `${currency} ${Number(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

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

export function BillingSettings() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [methodId, setMethodId] = useState('')
  const [amount, setAmount] = useState('')
  const [transactionId, setTransactionId] = useState('')
  const [senderNumber, setSenderNumber] = useState('')
  const [note, setNote] = useState('')

  const invoicesQuery = useQuery<BillingInvoice[]>({
    queryKey: ['billing', 'invoices'],
    queryFn: async () => {
      const { data } = await apiClient.get('/billing/invoices')
      return data as BillingInvoice[]
    },
  })

  const methodsQuery = useQuery<BillingMethod[]>({
    queryKey: ['billing', 'methods'],
    queryFn: async () => {
      const { data } = await apiClient.get('/billing/methods')
      return data as BillingMethod[]
    },
  })

  const invoices = invoicesQuery.data ?? []
  const methods = methodsQuery.data ?? []
  const selected = invoices.find((invoice) => invoice.id === selectedId) ?? null
  const selectedMethod = methods.find((method) => method.id === methodId) ?? null

  const proofMutation = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post(
        `/billing/invoices/${selectedId}/proofs`,
        {
          methodId,
          amount: Number(amount),
          transactionId: transactionId.trim(),
          senderNumber: senderNumber.trim() || undefined,
          note: note.trim() || undefined,
        },
      )
      return data
    },
    onSuccess: () => {
      toast.success('Payment proof submitted. We will verify it shortly.')
      setAmount('')
      setTransactionId('')
      setSenderNumber('')
      setNote('')
      queryClient.invalidateQueries({ queryKey: ['billing', 'invoices'] })
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? 'Could not submit the payment proof.'
      toast.error(Array.isArray(message) ? message.join(', ') : message)
    },
  })

  const downloadPdf = async (invoice: BillingInvoice) => {
    try {
      const { data } = await apiClient.get(
        `/billing/invoices/${invoice.id}/pdf`,
        { responseType: 'blob' },
      )
      const url = URL.createObjectURL(data as Blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `invoice-${invoice.number}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not download the invoice PDF.')
    }
  }

  const selectInvoice = (invoice: BillingInvoice) => {
    setSelectedId(invoice.id)
    setAmount(String(invoice.remaining))
    setMethodId(methods[0]?.id ?? '')
  }

  const isLoading = invoicesQuery.isLoading || methodsQuery.isLoading
  const isError = invoicesQuery.isError || methodsQuery.isError

  if (isLoading) {
    return (
      <div className='space-y-4 w-full max-w-5xl'>
        <Skeleton className='h-8 w-48' />
        <Skeleton className='h-40 w-full rounded-xl' />
        <Skeleton className='h-64 w-full rounded-xl' />
      </div>
    )
  }

  return (
    <div className='space-y-6 w-full max-w-5xl'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>Billing</h2>
        <p className='text-sm text-muted-foreground'>
          Your invoices, payments and payment proofs. To change your plan,
          contact support.
        </p>
      </div>

      <Separator />

      <EmailBalanceBanner />

      {isError ? (
        <div className='flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900'>
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
                  onClick={() => selectInvoice(invoice)}
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
              <div className='space-y-4 rounded-lg border p-4'>
                <h3 className='text-sm font-medium'>Submit a payment proof</h3>
                <p className='text-xs text-muted-foreground'>
                  Pay with one of the methods below, then submit the
                  transaction id. We verify the payment and activate your
                  subscription.
                </p>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <div className='space-y-2'>
                    <Label htmlFor='proof-method'>Payment method</Label>
                    <Select value={methodId} onValueChange={setMethodId}>
                      <SelectTrigger id='proof-method'>
                        <SelectValue placeholder='Select a method' />
                      </SelectTrigger>
                      <SelectContent>
                        {methods.map((method) => (
                          <SelectItem key={method.id} value={method.id}>
                            {method.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedMethod?.accountNumber ? (
                      <p className='text-xs text-muted-foreground'>
                        Send to {selectedMethod.accountNumber}
                        {selectedMethod.accountName
                          ? ` (${selectedMethod.accountName})`
                          : ''}
                      </p>
                    ) : null}
                    {selectedMethod?.instructions ? (
                      <p className='text-xs text-muted-foreground'>
                        {selectedMethod.instructions}
                      </p>
                    ) : null}
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='proof-amount'>Amount</Label>
                    <Input
                      id='proof-amount'
                      type='number'
                      min='0.01'
                      step='0.01'
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='proof-txn'>Transaction id</Label>
                    <Input
                      id='proof-txn'
                      value={transactionId}
                      onChange={(event) => setTransactionId(event.target.value)}
                      placeholder='e.g. 9HX7K2LM1A'
                    />
                  </div>
                  <div className='space-y-2'>
                    <Label htmlFor='proof-sender'>Sender number (optional)</Label>
                    <Input
                      id='proof-sender'
                      value={senderNumber}
                      onChange={(event) => setSenderNumber(event.target.value)}
                      placeholder='01XXXXXXXXX'
                    />
                  </div>
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='proof-note'>Note (optional)</Label>
                  <Input
                    id='proof-note'
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
                <Button
                  onClick={() => proofMutation.mutate()}
                  disabled={
                    proofMutation.isPending ||
                    !methodId ||
                    !amount ||
                    Number(amount) <= 0 ||
                    transactionId.trim().length < 3
                  }
                >
                  {proofMutation.isPending ? 'Submitting…' : 'Submit proof'}
                </Button>
              </div>
            ) : null}

            {selected.status === 'PAID' ? (
              <div className='flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-green-900'>
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
