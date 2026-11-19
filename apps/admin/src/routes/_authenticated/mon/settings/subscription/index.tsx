import { createFileRoute } from '@tanstack/react-router'
import {
  SubscriptionSettings,
  isSubscriptionTab,
  type SubscriptionTab,
} from '@/features/settings/subscription'

export const Route = createFileRoute('/_authenticated/mon/settings/subscription/')({
  component: SubscriptionRoute,
  validateSearch: (search: Record<string, unknown>): { tab?: SubscriptionTab } => ({
    tab: isSubscriptionTab(search.tab) ? search.tab : undefined,
  }),
})

function SubscriptionRoute() {
  const { tab } = Route.useSearch()
  return <SubscriptionSettings initialTab={tab} />
}
