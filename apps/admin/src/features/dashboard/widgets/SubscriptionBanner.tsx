'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import {
  daysLeftLabel,
  needsSubscriptionWarning,
  type AccessState,
} from '@/features/settings/subscription/lib'

interface EntitlementSnapshot {
  planName: string | null
  accessState: AccessState
  validUntil: string | null
}

/**
 * Warning banner above the Management dashboard grid. Shows when the plan
 * renews within 7 days or access is degraded (grace / read-only /
 * suspended). Visible to every role — shares the entitlements query key
 * with the Subscription card, so it never double-fetches.
 */
export function SubscriptionBanner() {
  const { data } = useQuery({
    queryKey: ['entitlements', 'me'],
    queryFn: () =>
      apiClient.get('/entitlements/me').then((r) => r.data as EntitlementSnapshot),
    staleTime: 60_000,
  })

  if (!data) return null
  const accessState = data.accessState ?? 'full'
  if (!needsSubscriptionWarning(data.validUntil, accessState)) return null

  const degraded = accessState !== 'full'

  return (
    <div
      className={
        degraded
          ? 'mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100'
          : 'mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100'
      }
    >
      {degraded ? (
        <ShieldAlert className='mt-0.5 h-5 w-5 shrink-0' />
      ) : (
        <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0' />
      )}
      <div className='min-w-0 flex-1'>
        <p className='text-sm font-semibold'>
          {degraded
            ? 'Your subscription needs attention'
            : `Your plan renews soon — ${daysLeftLabel(data.validUntil)}`}
        </p>
        <p className='mt-1 text-xs'>
          {degraded
            ? 'Access is limited while the subscription is not active. Renew to restore full access.'
            : 'Renew now so your store keeps running without interruption.'}{' '}
          <Link
            to='/mon/settings/subscription'
            search={{ tab: 'renew' }}
            className='font-semibold underline underline-offset-2'
          >
            Go to Subscription
          </Link>
        </p>
      </div>
    </div>
  )
}
