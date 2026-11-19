import { createFileRoute, redirect } from '@tanstack/react-router'

// Plan & Usage merged into the Subscription hub — keep the old URL working.
export const Route = createFileRoute('/_authenticated/mon/settings/plan/')({
  beforeLoad: () => {
    throw redirect({ to: '/mon/settings/subscription' })
  },
})
