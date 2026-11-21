import { redirect } from '@tanstack/react-router'
import { useEntitlementsStore } from '@/stores/entitlements-store'

export function requireFeature(featureKey: string) {
  const store = useEntitlementsStore.getState()
  // The entitlements store hydrates `features` from localStorage
  // synchronously at creation, so hasFeature() is trustworthy here
  // even before the layout's /entitlements/me fetch sets `loaded` —
  // beforeLoad runs before the layout mounts, so gating on `loaded`
  // bounced entitled tenants on refresh / direct navigation (the
  // courier route's requireAnyCourier never had the `loaded` clause).
  // The backend enforces the same feature via 403s, so trusting the
  // cache in this UI guard is safe.
  if (!store.hasFeature(featureKey)) {
    throw redirect({
      to: '/feature-unavailable',
      search: { feature: featureKey },
    })
  }
}
