import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { useFeatures } from '@/context/features-provider'
import type { SmtpSettingsResponse } from './lib'

/**
 * Persistent zero-balance banner (§10.3): shows on the SMTP page and
 * the billing page while the tenant is on EcoMate SMTP with an empty
 * balance — outgoing emails stop until a top-up lands. Silent when the
 * balance is unknown (platform unreachable) or the tenant is on BYO.
 * Shares the SMTP settings query key with the SMTP page, so the two
 * pages never double-fetch.
 *
 * SMTP is a separate add-on (Boss point 1): a tenant without the
 * smtp_server feature sees no balance anywhere, so the banner neither
 * fetches nor renders for them.
 */
export function EmailBalanceBanner() {
  const { hasFeature, loading: featuresLoading } = useFeatures()
  const hasSmtp = hasFeature('smtp_server')
  const { data } = useQuery({
    queryKey: ['smtp-settings-v2'],
    queryFn: () =>
      apiClient.get<SmtpSettingsResponse>('/settings/smtp').then((r) => r.data),
    staleTime: 30_000,
    enabled: !featuresLoading && hasSmtp,
  })

  if (!hasSmtp || !data || data.mode !== 'SAAS') return null
  const balance = data.balance?.balance
  if (typeof balance !== 'number' || balance > 0) return null

  return (
    <div className='flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100'>
      <AlertTriangle className='mt-0.5 h-5 w-5 shrink-0' />
      <div className='text-sm'>
        <p className='font-medium'>Your email balance is empty.</p>
        <p>
          Outgoing order emails and customer notifications are paused
          until you top up.{' '}
          <Link
            to='/mon/settings/smtp'
            className='font-medium underline underline-offset-2'
          >
            Top up from the SMTP page
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
