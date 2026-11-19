import { createFileRoute, redirect } from '@tanstack/react-router'

// Billing merged into the Subscription hub — keep the old URL working.
export const Route = createFileRoute('/_authenticated/mon/settings/billing/')({
  beforeLoad: () => {
    throw redirect({ to: '/mon/settings/subscription' })
  },
})
