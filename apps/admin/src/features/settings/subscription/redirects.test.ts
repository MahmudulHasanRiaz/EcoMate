import { describe, it, expect } from 'vitest'
import { isRedirect } from '@tanstack/react-router'
import { Route as PlanRoute } from '@/routes/_authenticated/mon/settings/plan'
import { Route as BillingRoute } from '@/routes/_authenticated/mon/settings/billing'

function thrownRedirect(route: {
  options: { beforeLoad?: (opts: never) => unknown }
}): unknown {
  try {
    route.options.beforeLoad?.({} as never)
  } catch (thrown) {
    return thrown
  }
  return null
}

describe('old subscription URLs redirect to the hub', () => {
  it('/mon/settings/plan redirects to /mon/settings/subscription', () => {
    const thrown = thrownRedirect(PlanRoute)
    expect(thrown).not.toBeNull()
    expect(isRedirect(thrown)).toBe(true)
    expect(
      (thrown as { options: { to: string } }).options.to,
    ).toBe('/mon/settings/subscription')
  })

  it('/mon/settings/billing redirects to /mon/settings/subscription', () => {
    const thrown = thrownRedirect(BillingRoute)
    expect(thrown).not.toBeNull()
    expect(isRedirect(thrown)).toBe(true)
    expect(
      (thrown as { options: { to: string } }).options.to,
    ).toBe('/mon/settings/subscription')
  })
})
