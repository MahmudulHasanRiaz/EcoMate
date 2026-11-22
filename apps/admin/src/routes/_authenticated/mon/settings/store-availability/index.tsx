import { createFileRoute } from '@tanstack/react-router'
import { AvailabilityRules } from '@/features/channels/availability-rules'
import { requireFeature } from '@/lib/require-feature'

export const Route = createFileRoute('/_authenticated/mon/settings/store-availability/')({
  beforeLoad: () => requireFeature('admin_stores'),
  component: AvailabilityRules,
})
