import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { canManageSubscription } from './lib'
import { OverviewTab } from './overview-tab'
import { RenewTab } from './renew-tab'
import { PlansTab } from './plans-tab'
import { InvoicesTab } from './invoices-tab'

export const SUBSCRIPTION_TABS = ['overview', 'renew', 'plans', 'invoices'] as const
export type SubscriptionTab = (typeof SUBSCRIPTION_TABS)[number]

export function isSubscriptionTab(value: unknown): value is SubscriptionTab {
  return (
    typeof value === 'string' &&
    (SUBSCRIPTION_TABS as readonly string[]).includes(value)
  )
}

interface SubscriptionSettingsProps {
  /** Deep-link target from the route's `?tab=` search param. */
  initialTab?: SubscriptionTab
}

/**
 * The single Subscription hub: Overview | Renew | Plans | Invoices.
 * Merges the old Plan & Usage and Billing pages. Everyone can view; only
 * superadmin/admin see the action forms (proof submit, upgrade request) —
 * staff get a plain note instead of a form that would 403 on submit.
 */
export function SubscriptionSettings({
  initialTab = 'overview',
}: SubscriptionSettingsProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/mon/settings/subscription/' })
  const [tab, setTab] = useState<SubscriptionTab>(initialTab)
  const role = useAuthStore((s) => s.auth.user?.role)
  const canManage = canManageSubscription(role)

  const changeTab = (value: string) => {
    if (!isSubscriptionTab(value)) return
    setTab(value)
    navigate({ search: (prev) => ({ ...prev, tab: value }) })
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['entitlements'] })
    queryClient.invalidateQueries({ queryKey: ['billing'] })
    queryClient.invalidateQueries({ queryKey: ['subscription'] })
  }

  return (
    <div className='space-y-6 w-full max-w-5xl'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-2xl font-bold tracking-tight'>Subscription</h2>
          <p className='text-sm text-muted-foreground'>
            Your plan, renewal, available plans and invoices — all in one
            place.
          </p>
        </div>
        <Button variant='outline' size='sm' onClick={refresh}>
          <RefreshCw className='me-2 h-4 w-4' />
          Refresh
        </Button>
      </div>

      <Separator />

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value='overview'>Overview</TabsTrigger>
          <TabsTrigger value='renew'>Renew</TabsTrigger>
          <TabsTrigger value='plans'>Plans</TabsTrigger>
          <TabsTrigger value='invoices'>Invoices</TabsTrigger>
        </TabsList>
        <TabsContent value='overview' className='mt-6'>
          <OverviewTab onSelectPlans={() => changeTab('plans')} />
        </TabsContent>
        <TabsContent value='renew' className='mt-6'>
          <RenewTab canManage={canManage} />
        </TabsContent>
        <TabsContent value='plans' className='mt-6'>
          <PlansTab canManage={canManage} />
        </TabsContent>
        <TabsContent value='invoices' className='mt-6'>
          <InvoicesTab canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
