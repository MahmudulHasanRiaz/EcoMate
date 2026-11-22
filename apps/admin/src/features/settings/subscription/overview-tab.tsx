import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
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
import { getEntitlements, getTrialReview, getUsage } from './api'
import {
  ACCESS_STATE_META,
  daysLeftLabel,
  formatDate,
  prettyFeature,
} from './lib'

interface OverviewTabProps {
  /** Jump to the Plans tab (trial-ended banner action). */
  onSelectPlans?: () => void
}

export function OverviewTab({ onSelectPlans }: OverviewTabProps) {
  const snapshotQuery = useQuery({
    queryKey: ['entitlements', 'me'],
    queryFn: getEntitlements,
    staleTime: 60_000,
  })

  const usageQuery = useQuery({
    queryKey: ['entitlements', 'usage'],
    queryFn: getUsage,
    staleTime: 60_000,
  })

  // Same query key as the Plans tab — one cached fetch serves both.
  const trialReviewQuery = useQuery({
    queryKey: ['subscription', 'trial-review'],
    queryFn: getTrialReview,
    staleTime: 60_000,
  })

  const snapshot = snapshotQuery.data
  const accessState = snapshot?.accessState ?? 'full'
  const stateMeta = ACCESS_STATE_META[accessState]
  const features = snapshot?.features ?? []
  const hasWildcard = features.includes('*')
  const usageRows = usageQuery.data?.limits ?? []
  // Still on the trial plan but no longer in trial: the trial ended
  // (PAST_DUE = grace window, SUSPENDED = grace over or immediate
  // suspension). An active trial has status TRIAL, not these.
  const trialEnded =
    trialReviewQuery.data?.isTrialPlan === true &&
    (snapshot?.subscriptionStatus === 'PAST_DUE' ||
      snapshot?.subscriptionStatus === 'SUSPENDED')

  if (snapshotQuery.isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-40 w-full rounded-xl' />
        <Skeleton className='h-64 w-full rounded-xl' />
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      {trialEnded ? (
        <div
          className={
            accessState === 'grace'
              ? 'flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100'
              : 'flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100'
          }
        >
          {accessState === 'grace' ? (
            <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0' />
          ) : (
            <ShieldAlert className='mt-0.5 h-5 w-5 shrink-0' />
          )}
          <div className='space-y-2'>
            <p className='text-sm font-semibold'>Your trial has ended</p>
            <p className='text-xs'>
              {accessState === 'grace'
                ? `Your shop stays online until ${formatDate(snapshot?.graceEndsAt ?? null)}. Choose a plan before then to keep it running — you can review your trial add-ons and pick which ones to keep.`
                : 'Your workspace is suspended. Choose a plan to restore full access — your products, orders and storefront content are safe.'}
            </p>
            {onSelectPlans ? (
              <Button size='sm' variant='outline' onClick={onSelectPlans}>
                Choose a plan
              </Button>
            ) : null}
          </div>
        </div>
      ) : accessState !== 'full' ? (
        <div
          className={
            accessState === 'grace'
              ? 'flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100'
              : 'flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100'
          }
        >
          {accessState === 'grace' ? (
            <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0' />
          ) : (
            <ShieldAlert className='mt-0.5 h-5 w-5 shrink-0' />
          )}
          <div>
            <p className='text-sm font-semibold'>
              {accessState === 'grace'
                ? 'Your plan is in its grace period'
                : 'Your workspace is read-only'}
            </p>
            <p className='mt-1 text-xs'>
              {accessState === 'grace'
                ? 'Update your payment details before the grace period ends to keep full access.'
                : 'You can keep viewing data, but changes are blocked until the subscription is restored.'}
            </p>
          </div>
        </div>
      ) : null}

      <div className='grid gap-4 md:grid-cols-3'>
        <Card>
          <CardHeader className='pb-2'>
            <CardDescription>Current plan</CardDescription>
            <CardTitle className='flex items-center gap-2 text-xl'>
              <Sparkles className='h-4 w-4 text-primary' />
              {snapshot?.planName || 'No active plan'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-xs text-muted-foreground'>
              {snapshot?.subscriptionStatus || 'No subscription record'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-2'>
            <CardDescription>Access</CardDescription>
            <CardTitle className='text-xl'>
              <Badge variant={stateMeta.variant}>{stateMeta.label}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-xs text-muted-foreground'>
              {accessState === 'full'
                ? 'All plan features are writable.'
                : 'Writes are limited while the subscription is not active.'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-2'>
            <CardDescription>Renews / valid until</CardDescription>
            <CardTitle className='flex items-center gap-2 text-xl'>
              <CalendarClock className='h-4 w-4 text-muted-foreground' />
              {formatDate(snapshot?.validUntil ?? null)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className='text-sm font-medium'>
              {daysLeftLabel(snapshot?.validUntil ?? null)}
            </p>
            <p className='text-xs text-muted-foreground'>
              Plan changes appear here after the next entitlement refresh.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='text-lg'>Usage</CardTitle>
          <CardDescription>
            Limits from your plan. Workspaces at 80% or more are highlighted.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {usageRows.length === 0 ? (
            <p className='text-sm text-muted-foreground'>
              {usageQuery.isLoading ? 'Loading usage…' : 'No usage limits on this plan.'}
            </p>
          ) : (
            usageRows.map((row) => (
              <div key={row.key} className='space-y-1.5'>
                <div className='flex items-baseline justify-between gap-3'>
                  <span className='text-sm font-medium'>{row.label}</span>
                  <span
                    className={
                      row.warning
                        ? 'text-xs font-semibold text-amber-600'
                        : 'text-xs text-muted-foreground'
                    }
                  >
                    {row.limit === null
                      ? `${row.used} used · unlimited`
                      : `${row.used} / ${row.limit}${row.percent !== null ? ` · ${row.percent}%` : ''}`}
                  </span>
                </div>
                <div className='h-2 w-full overflow-hidden rounded-full bg-muted'>
                  <div
                    className={
                      row.warning
                        ? 'h-full rounded-full bg-amber-500 transition-all'
                        : 'h-full rounded-full bg-primary transition-all'
                    }
                    style={{ width: `${Math.min(100, row.percent ?? 0)}%` }}
                  />
                </div>
                {row.warning && (
                  <p className='flex items-center gap-1 text-[11px] font-medium text-amber-600'>
                    <AlertTriangle className='h-3 w-3' />
                    Approaching your plan limit. Upgrade to keep creating.
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-lg'>Unlocked features</CardTitle>
          <CardDescription>
            {hasWildcard
              ? 'This plan includes every feature.'
              : `${features.length} feature${features.length === 1 ? '' : 's'} included in your plan.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {features.length === 0 ? (
            <p className='text-sm text-muted-foreground'>
              No features are enabled for this workspace.
            </p>
          ) : (
            <div className='flex flex-wrap gap-2'>
              {features.map((feature) =>
                feature === '*' ? (
                  <Badge key={feature} className='gap-1'>
                    <CheckCircle2 className='h-3 w-3' />
                    All features
                  </Badge>
                ) : (
                  <Badge key={feature} variant='secondary' className='font-normal'>
                    {prettyFeature(feature)}
                  </Badge>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
