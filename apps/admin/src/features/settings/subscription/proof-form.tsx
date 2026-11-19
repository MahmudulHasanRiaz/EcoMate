import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { submitInvoiceProof, type BillingInvoice, type BillingMethod } from './api'

interface ProofFormProps {
  invoice: BillingInvoice
  methods: BillingMethod[]
}

/**
 * Payment-proof submission form, shared by the Renew tab and the invoice
 * detail on the Invoices tab. Callers render it only for roles that may
 * submit (superadmin/admin) — the backend rejects everyone else with 403,
 * so staff never see a form that cannot succeed.
 */
export function ProofForm({ invoice, methods }: ProofFormProps) {
  const queryClient = useQueryClient()
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '')
  const [amount, setAmount] = useState(String(invoice.remaining))
  const [transactionId, setTransactionId] = useState('')
  const [senderNumber, setSenderNumber] = useState('')
  const [note, setNote] = useState('')

  const selectedMethod = methods.find((method) => method.id === methodId) ?? null

  const proofMutation = useMutation({
    mutationFn: () =>
      submitInvoiceProof(invoice.id, {
        methodId,
        amount: Number(amount),
        transactionId: transactionId.trim(),
        senderNumber: senderNumber.trim() || undefined,
        note: note.trim() || undefined,
      }),
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

  return (
    <div className='space-y-4 rounded-lg border p-4'>
      <h3 className='text-sm font-medium'>Submit a payment proof</h3>
      <p className='text-xs text-muted-foreground'>
        Pay with one of the methods below, then submit the transaction id. We
        verify the payment and activate your subscription.
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
  )
}
