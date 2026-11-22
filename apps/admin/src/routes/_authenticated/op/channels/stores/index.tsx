import { createFileRoute } from '@tanstack/react-router'
import { ChannelsStores } from '@/features/channels'
import { requireFeature } from '@/lib/require-feature'

export const Route = createFileRoute('/_authenticated/op/channels/stores/')({
  beforeLoad: () => requireFeature('admin_stores'),
  component: ChannelsStores,
})
