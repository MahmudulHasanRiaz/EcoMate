import { createFileRoute } from '@tanstack/react-router'
import { ChannelsOverview } from '@/features/channels'
import { requireFeature } from '@/lib/require-feature'

export const Route = createFileRoute('/_authenticated/op/channels/')({
  // Phase 9 central-commerce: tenants without the admin_stores feature
  // never reach the channels pages (redirects to /feature-unavailable).
  beforeLoad: () => requireFeature('admin_stores'),
  component: ChannelsOverview,
})
