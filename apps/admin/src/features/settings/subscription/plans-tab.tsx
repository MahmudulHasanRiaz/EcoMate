import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpCircle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

  const requestMutation = useMutation({
    mutationFn: (plan: PublicPlan) =>
      createPlanChangeRequest({
        targetPlanId: plan.id,
        note: note.trim() || undefined,
      }),
    onSuccess: (created: PlanChangeRequestView) => {
      toast.success(
        `Upgrade requested — ${created.targetPlanName}. We will review it shortly.`,
      )
      setRequestTarget(null)
      setNote('')
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
          if (!open) {
            setRequestTarget(null)
            setNote('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Request {requestTarget?.name ?? 'plan change'}
            </DialogTitle>
            <DialogDescription>
              We will review your request and apply the new plan once it is
              approved. You can add an optional note for the review team.
            </DialogDescription>
          </DialogHeader>
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
            <Button
              variant='outline'
              onClick={() => {
                setRequestTarget(null)
                setNote('')
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                requestTarget && requestMutation.mutate(requestTarget)
              }
              disabled={requestMutation.isPending || requestTarget === null}
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
