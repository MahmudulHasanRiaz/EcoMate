import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowUpCircle,
  CalendarClock,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

export interface EntitlementSnapshot {
  tenantId: string | null
  planName: string | null
  subscriptionStatus: string | null
  accessState: 'full' | 'grace' | 'read_only' | 'suspended'
  features: string[]
  limits: Record<string, unknown>
  validUntil: string | null
}

export interface LimitUsageRow {
  key: string
  label: string
  limit: number | null
  used: number
  percent: number | null
  warning: boolean
}

export interface UsageResponse {
  planName: string | null
  accessState: EntitlementSnapshot['accessState']
  limits: LimitUsageRow[]
}

const ACCESS_STATE_META: Record<
  EntitlementSnapshot['accessState'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  full: { label: 'Active', variant: 'default' },
  grace: { label: 'Grace period', variant: 'secondary' },
  read_only: { label: 'Read only', variant: 'destructive' },
  suspended: { label: 'Suspended', variant: 'destructive' },
}

function prettyFeature(feature: string): string {
  return feature
    .replace(/^admin_/, '')
    .replace(/^storefront_/, 'storefront · ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatDate(value: string | null): string {
  if (!value) return 'No renewal date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No renewal date'
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function PlanUsageSettings() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const billingUrl = import.meta.env.VITE_BILLING_URL as string | undefined

  const snapshotQuery = useQuery<EntitlementSnapshot>({
    queryKey: ['entitlements', 'me'],
    queryFn: () => apiClient.get('/entitlements/me').then((r) => r.data),
    staleTime: 60_000,
  })

  const usageQuery = useQuery<UsageResponse>({
    queryKey: ['entitlements', 'usage'],
    queryFn: () => apiClient.get('/entitlements/usage').then((r) => r.data),
    staleTime: 60_000,
  })

  const snapshot = snapshotQuery.data
  const isLoading = snapshotQuery.isLoading
  const accessState = snapshot?.accessState ?? 'full'
  const stateMeta = ACCESS_STATE_META[accessState]
  const features = snapshot?.features ?? []
  const hasWildcard = features.includes('*')
  const usageRows = usageQuery.data?.limits ?? []

  const refresh = () => {
    snapshotQuery.refetch()
    usageQuery.refetch()
    queryClient.invalidateQueries({ queryKey: ['entitlements'] })
  }

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
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Plan &amp; Usage</h2>
          <p className='text-sm text-muted-foreground'>
            Your subscription, unlocked features and current usage.
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='outline' size='sm' onClick={refresh}>
            <RefreshCw className='me-2 h-4 w-4' />
            Refresh
          </Button>
          {billingUrl ? (
            <Button size='sm' onClick={() => window.open(billingUrl, '_blank', 'noopener')}>
              <ArrowUpCircle className='me-2 h-4 w-4' />
              Upgrade plan
            </Button>
          ) : (
            <Button size='sm' onClick={() => navigate({ to: '/mon/settings/billing' })}>
              <ArrowUpCircle className='me-2 h-4 w-4' />
              Upgrade plan
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {accessState !== 'full' && (
        <div
          className={
            accessState === 'grace'
              ? 'flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900'
              : 'flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900'
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
      )}

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
