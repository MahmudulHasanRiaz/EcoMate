import { createFileRoute } from '@tanstack/react-router'
import { ChannelStoreDetail } from '@/features/channels'
import { requireFeature } from '@/lib/require-feature'

export const Route = createFileRoute('/_authenticated/op/channels/stores/$id')({
  beforeLoad: () => requireFeature('admin_stores'),
  component: ChannelStoreDetail,
})
