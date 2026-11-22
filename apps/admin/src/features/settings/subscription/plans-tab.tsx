import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpCircle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  createPlanChangeRequest,
  getEntitlements,
  getPlanChangeRequests,
  getPublicPlans,
  getTrialReview,
  type PlanChangeRequestStatus,
  type PlanChangeRequestView,
  type PublicPlan,
} from './api'
import { formatDate, money, prettyFeature } from './lib'
import { STAFF_ACTION_NOTE } from './renew-tab'

function formatLimitValue(value: unknown): string {
  if (value === null || value === undefined) return 'Unlimited'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function formatLimitKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function planPriceLabel(plan: PublicPlan): string {
  if (plan.isFree) return 'Free'
  const price = money(plan.price, plan.currency)
  const cycle = (plan.interval || plan.billingCycle || '').toLowerCase()
  return cycle ? `${price} / ${cycle}` : price
}

function requestStatusBadge(status: PlanChangeRequestStatus) {
  switch (status) {
    case 'PENDING':
      return <Badge variant='secondary'>Pending</Badge>
    case 'APPLIED':
      return <Badge variant='default'>Applied</Badge>
    case 'REJECTED':
      return <Badge variant='destructive'>Rejected</Badge>
  }
}

interface PlansTabProps {
  canManage: boolean
}

export function PlansTab({ canManage }: PlansTabProps) {
  const queryClient = useQueryClient()
  const [requestTarget, setRequestTarget] = useState<PublicPlan | null>(null)
  const [note, setNote] = useState('')
  /** The tenant's add-on choice in the dialog. null = not touched yet,
   * which means keep-all (the default). */
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<string[] | null>(
    null,
  )

  const snapshotQuery = useQuery({
    queryKey: ['entitlements', 'me'],
    queryFn: getEntitlements,
    staleTime: 60_000,
  })

  const plansQuery = useQuery({
    queryKey: ['subscription', 'plans'],
    queryFn: getPublicPlans,
    staleTime: 60_000,
  })

  const requestsQuery = useQuery({
    queryKey: ['subscription', 'plan-change-requests'],
    queryFn: getPlanChangeRequests,
  })

  // Trial add-on review — only loaded while the request dialog is open.
  // Empty when the tenant has no unconfirmed trial add-ons (e.g. already
  // on a paid plan), in which case the dialog shows no review step.
  const trialReviewQuery = useQuery({
    queryKey: ['subscription', 'trial-review'],
    queryFn: getTrialReview,
    enabled: requestTarget !== null,
    staleTime: 60_000,
  })

  const reviewAddOns = trialReviewQuery.data?.trialAddOns ?? []
  const hasReview = reviewAddOns.length > 0
  // Confirmed trial add-ons are already billable — they are always
  // kept (checked + disabled) and always included in the choice.
  const confirmedIds = reviewAddOns
    .filter((addOn) => addOn.confirmed)
    .map((addOn) => addOn.id)
  // Default: keep everything the trial gave. The tenant drops what they
  // do not want to pay for — nothing is billed without this choice.
  const effectiveSelectedIds = Array.from(
    new Set([
      ...confirmedIds,
      ...(selectedAddOnIds ?? reviewAddOns.map((addOn) => addOn.id)),
    ]),
  )
  const reviewCurrency = reviewAddOns[0]?.currency ?? 'BDT'
  const keptTotal = reviewAddOns
    .filter((addOn) => effectiveSelectedIds.includes(addOn.id))
    .reduce((sum, addOn) => sum + Number(addOn.price), 0)
  const storefrontAddOn = reviewAddOns.find(
    (addOn) => addOn.slug === 'storefront',
  )
  const droppingStorefront =
    storefrontAddOn !== undefined &&
    !effectiveSelectedIds.includes(storefrontAddOn.id)

  function toggleAddOn(addOnId: string, checked: boolean) {
    setSelectedAddOnIds((prev) => {
      const base = prev ?? reviewAddOns.map((addOn) => addOn.id)
      return checked
        ? [...base, addOnId]
        : base.filter((id) => id !== addOnId)
    })
  }

  function closeRequestDialog() {
    setRequestTarget(null)
    setNote('')
    setSelectedAddOnIds(null)
  }

  const requestMutation = useMutation({
    mutationFn: (plan: PublicPlan) =>
      createPlanChangeRequest({
        targetPlanId: plan.id,
        note: note.trim() || undefined,
        // Only send the choice when there was something to review;
        // otherwise the request carries no add-on choice (null) and
        // the operator flow leaves add-ons untouched.
        ...(hasReview ? { addOnIds: effectiveSelectedIds } : {}),
      }),
    onSuccess: (created: PlanChangeRequestView) => {
      toast.success(
        `Upgrade requested — ${created.targetPlanName}. We will review it shortly.`,
      )
      closeRequestDialog()
      queryClient.invalidateQueries({
        queryKey: ['subscription', 'plan-change-requests'],
      })
    },
    onError: (error: unknown) => {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? 'Could not send the upgrade request.'
      toast.error(Array.isArray(message) ? message.join(', ') : message)
    },
  })

  const plans = [...(plansQuery.data ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  )
  const requests = requestsQuery.data ?? []
  const currentPlanName = snapshotQuery.data?.planName ?? null
  const isLoading = plansQuery.isLoading || requestsQuery.isLoading

  const pendingPlanIds = new Set(
    requests
      .filter((request) => request.status === 'PENDING')
      .map((request) => request.targetPlanId),
  )

  if (isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-64 w-full rounded-xl' />
        <Skeleton className='h-40 w-full rounded-xl' />
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      {!canManage ? (
        <div className='rounded-lg border p-4 text-sm text-muted-foreground'>
          {STAFF_ACTION_NOTE}
        </div>
      ) : null}

      {plans.length === 0 ? (
        <Card>
          <CardContent className='py-10 text-center text-sm text-muted-foreground'>
            No plans are available right now. Please check back later or
            contact support.
          </CardContent>
        </Card>
      ) : (
        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {plans.map((plan) => {
            const isCurrent =
              currentPlanName !== null &&
              plan.name.toLowerCase() === currentPlanName.toLowerCase()
            const hasPendingRequest = pendingPlanIds.has(plan.id)
            const limits = plan.limits ? Object.entries(plan.limits) : []
            return (
              <Card
                key={plan.id}
                className={isCurrent ? 'border-primary' : undefined}
              >
                <CardHeader>
                  <div className='flex items-start justify-between gap-2'>
                    <CardTitle className='text-lg'>{plan.name}</CardTitle>
                    {plan.badge ? (
                      <Badge variant='secondary'>{plan.badge}</Badge>
                    ) : null}
                  </div>
                  {plan.description ? (
                    <CardDescription>{plan.description}</CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent className='space-y-4'>
                  <p className='text-2xl font-bold tracking-tight'>
                    {planPriceLabel(plan)}
                  </p>
                  {plan.trialDays ? (
                    <p className='text-xs text-muted-foreground'>
                      Includes a {plan.trialDays}-day free trial.
                    </p>
                  ) : null}
                  {plan.perOrderRate !== null &&
                  plan.perOrderRate !== undefined ? (
                    <p className='text-xs text-muted-foreground'>
                      {money(plan.perOrderRate, plan.currency)} per order
                      {plan.minimumMonthly !== null &&
                      plan.minimumMonthly !== undefined
                        ? ` · minimum ${money(plan.minimumMonthly, plan.currency)}/month`
                        : ''}
                      {plan.includedOrders
                        ? ` · ${plan.includedOrders} orders included`
                        : ''}
                    </p>
                  ) : null}
                  {plan.freeMonths ? (
                    <p className='text-xs text-muted-foreground'>
                      {plan.freeMonths} free month
                      {plan.freeMonths === 1 ? '' : 's'} included.
                    </p>
                  ) : null}
                  {limits.length > 0 ? (
                    <div className='space-y-1 text-sm'>
                      {limits.map(([key, value]) => (
                        <div key={key} className='flex justify-between gap-4'>
                          <span className='text-muted-foreground'>
                            {formatLimitKey(key)}
                          </span>
                          <span className='font-medium'>
                            {formatLimitValue(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {plan.features.length > 0 ? (
                    <div className='flex flex-wrap gap-1.5'>
                      {plan.features.map((feature) =>
                        feature === '*' ? (
                          <Badge key={feature} className='gap-1'>
                            <CheckCircle2 className='h-3 w-3' />
                            All features
                          </Badge>
                        ) : (
                          <Badge
                            key={feature}
                            variant='secondary'
                            className='font-normal'
                          >
                            {prettyFeature(feature)}
                          </Badge>
                        ),
                      )}
                    </div>
                  ) : null}
                  {plan.oneTimeFees.length > 0 ? (
                    <div className='space-y-1 text-xs text-muted-foreground'>
                      {plan.oneTimeFees.map((fee) => (
                        <p key={fee.label}>
                          {fee.label}: {money(fee.amount, plan.currency)} one-time
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {isCurrent ? (
                    <Badge className='gap-1'>
                      <CheckCircle2 className='h-3 w-3' />
                      Current plan
                    </Badge>
                  ) : hasPendingRequest ? (
                    <Badge variant='secondary'>Request pending</Badge>
                  ) : canManage ? (
                    <Button
                      size='sm'
                      onClick={() => setRequestTarget(plan)}
                    >
                      <ArrowUpCircle className='me-2 h-4 w-4' />
                      Request upgrade
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {requests.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Plan change requests</CardTitle>
            <CardDescription>
              Your upgrade requests and their status.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            {requests.map((request) => (
              <div
                key={request.id}
                className='flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm'
              >
                <span className='font-medium'>{request.targetPlanName}</span>
                {requestStatusBadge(request.status)}
                <span className='text-xs text-muted-foreground'>
                  Requested {formatDate(request.createdAt)}
                </span>
                {request.requestedAddOnIds !== null &&
                request.requestedAddOnIds !== undefined ? (
                  <span className='text-xs text-muted-foreground'>
                    {request.requestedAddOnIds.length === 0
                      ? 'No add-ons kept'
                      : `Keeping ${request.requestedAddOnIds.length} add-on${request.requestedAddOnIds.length === 1 ? '' : 's'}`}
                  </span>
                ) : null}
                {request.note ? (
                  <span className='w-full text-xs text-muted-foreground'>
                    Note: {request.note}
                  </span>
                ) : null}
                {request.status === 'REJECTED' && request.rejectionReason ? (
                  <span className='w-full text-xs text-red-700'>
                    {request.rejectionReason}
                  </span>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={requestTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeRequestDialog()
        }}
      >
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>
              Request {requestTarget?.name ?? 'plan change'}
            </DialogTitle>
            <DialogDescription>
              We will review your request and apply the new plan once it is
              approved. You can add an optional note for the review team.
            </DialogDescription>
          </DialogHeader>

          {trialReviewQuery.isLoading ? (
            <Skeleton className='h-24 w-full rounded-lg' />
          ) : hasReview ? (
            <div className='space-y-3'>
              <div>
                <h3 className='text-sm font-medium'>
                  Your trial add-ons — choose what to keep
                </h3>
                <p className='text-xs text-muted-foreground'>
                  These were free during your trial. Only the add-ons you
                  keep here will be billed on the new plan — dropped ones
                  stop when the plan changes, and nothing is charged for
                  them.
                </p>
              </div>
              <div className='max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2'>
                {reviewAddOns.map((addOn) => (
                  <label
                    key={addOn.id}
                    htmlFor={`trial-addon-${addOn.id}`}
                    className={`flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm ${addOn.confirmed ? 'opacity-70' : 'cursor-pointer hover:bg-muted'}`}
                  >
                    <span className='flex items-center gap-2'>
                      <Checkbox
                        id={`trial-addon-${addOn.id}`}
                        checked={effectiveSelectedIds.includes(addOn.id)}
                        disabled={addOn.confirmed}
                        onCheckedChange={(checked) =>
                          toggleAddOn(addOn.id, checked === true)
                        }
                      />
                      {addOn.name}
                      {addOn.confirmed ? (
                        <span className='text-xs text-muted-foreground'>
                          (already confirmed)
                        </span>
                      ) : null}
                    </span>
                    <span className='text-muted-foreground'>
                      {money(addOn.price, addOn.currency)} / month
                    </span>
                  </label>
                ))}
              </div>
              <div className='space-y-1 text-sm'>
                <p className='flex justify-between'>
                  <span className='text-muted-foreground'>
                    {requestTarget?.name ?? 'Plan'} plan
                  </span>
                  <span>
                    {requestTarget
                      ? money(Number(requestTarget.price), requestTarget.currency)
                      : '—'}
                  </span>
                </p>
                <p className='flex justify-between'>
                  <span className='text-muted-foreground'>
                    Kept add-ons, monthly
                  </span>
                  <span>{money(keptTotal, reviewCurrency)}</span>
                </p>
                <p className='flex justify-between font-medium'>
                  <span>Monthly total</span>
                  <span>
                    {requestTarget
                      ? money(
                          Number(requestTarget.price) + keptTotal,
                          requestTarget.currency,
                        )
                      : money(keptTotal, reviewCurrency)}
                  </span>
                </p>
              </div>
              {droppingStorefront ? (
                <p className='flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200'>
                  <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
                  Dropping the storefront will take your public shop offline
                  when the plan changes. Your products and orders stay safe
                  in the admin.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className='space-y-2'>
            <Label htmlFor='plan-change-note'>Note (optional)</Label>
            <Textarea
              id='plan-change-note'
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder='Anything we should know?'
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={closeRequestDialog}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                requestTarget && requestMutation.mutate(requestTarget)
              }
              disabled={
                requestMutation.isPending ||
                requestTarget === null ||
                trialReviewQuery.isLoading
              }
            >
              {requestMutation.isPending
                ? 'Sending…'
                : 'Confirm request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
