import { createFileRoute, redirect } from '@tanstack/react-router'
import { CourierSettings } from '@/features/settings/courier'
import { useEntitlementsStore } from '@/stores/entitlements-store'

const COURIER_FEATURES = ['courier_steadfast', 'courier_pathao', 'courier_redx', 'courier_carrybee']

function requireAnyCourier() {
  const store = useEntitlementsStore.getState()
  const hasAny = COURIER_FEATURES.some((f) => store.hasFeature(f))
  if (!hasAny) {
    throw redirect({ to: '/feature-unavailable', search: { feature: 'courier' } })
  }
}

export const Route = createFileRoute('/_authenticated/mon/settings/courier/')({
  beforeLoad: () => requireAnyCourier(),
  component: CourierSettings,
})
