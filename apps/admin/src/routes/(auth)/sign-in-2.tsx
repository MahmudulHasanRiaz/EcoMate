import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Retired in the login redesign (Step 1). The old split-screen alternate
 * login shared the sign-in form but showed no tenant brand and
 * contradicted the Clerk-style centered widget. Any bookmarked
 * `/sign-in-2` link lands on the single canonical sign-in page instead.
 * The old component + dashboard screenshots were deleted with this
 * change; the route file stays only so the redirect exists.
 */
export const Route = createFileRoute('/(auth)/sign-in-2')({
  beforeLoad: () => {
    throw redirect({ to: '/sign-in' })
  },
})
