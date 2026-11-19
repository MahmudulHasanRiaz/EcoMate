'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CalendarClock, Gauge } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WidgetShell } from '../components/WidgetShell'
import type { WidgetProps } from '../types'
import {
  ACCESS_STATE_META,
  daysLeftLabel,
  formatDate,
  needsSubscriptionWarning,
  type AccessState,
} from '@/features/settings/subscription/lib'

interface EntitlementSnapshot {
  planName: string | null
  subscriptionStatus: string | null
  accessState: AccessState
  validUntil: string | null
}

/**
 * Subscription status card for the Management dashboard. View-only for
 * every role — staff see the same plan and renewal state as admins.
 */
export function SubscriptionStatus(_props: WidgetProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['entitlements', 'me'],
    queryFn: () =>
      apiClient.get('/entitlements/me').then((r) => r.data as EntitlementSnapshot),
    staleTime: 60_000,
  })

  const accessState = data?.accessState ?? 'full'
  const stateMeta = ACCESS_STATE_META[accessState]
  const warning = needsSubscriptionWarning(data?.validUntil, accessState)

  return (
    <WidgetShell
      title='Subscription'
      description='Your plan and renewal'
      isLoading={isLoading}
      error={error ?? undefined}
      onRetry={() => refetch()}
      icon={<Gauge className='h-4 w-4' />}
      action={
        <Button asChild variant='outline' size='sm'>
          <Link to='/mon/settings/subscription' search={{ tab: 'renew' }}>
            Renew
          </Link>
        </Button>
      }
    >
      <div className='space-y-3'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-sm font-medium'>
            {data?.planName || 'No active plan'}
          </span>
          <Badge variant={stateMeta.variant}>{stateMeta.label}</Badge>
        </div>
        <div className='flex items-center gap-2 text-sm text-muted-foreground'>
          <CalendarClock className='h-4 w-4 shrink-0' />
          <span>
            Renews {formatDate(data?.validUntil ?? null)} ·{' '}
            <span
              className={
                warning ? 'font-semibold text-amber-600' : 'font-medium'
              }
            >
              {daysLeftLabel(data?.validUntil ?? null)}
            </span>
          </span>
        </div>
        {warning ? (
          <p className='text-xs text-amber-600'>
            {accessState !== 'full'
              ? 'Your subscription needs attention — renew to restore full access.'
              : 'Your plan renews soon — renew now to avoid losing access.'}
          </p>
        ) : null}
        <Button asChild variant='link' size='sm' className='h-auto p-0'>
          <Link to='/mon/settings/subscription'>View subscription</Link>
        </Button>
      </div>
    </WidgetShell>
  )
}
