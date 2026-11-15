import { redirect } from '@tanstack/react-router'
import { useEntitlementsStore } from '@/stores/entitlements-store'

export function requireFeature(featureKey: string) {
  const store = useEntitlementsStore.getState()
  if (!store.loaded || !store.hasFeature(featureKey)) {
    throw redirect({
      to: '/feature-unavailable',
      search: { feature: featureKey },
    })
  }
}
