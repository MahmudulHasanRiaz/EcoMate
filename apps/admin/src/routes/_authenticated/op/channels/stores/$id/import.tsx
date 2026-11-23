import { createFileRoute } from '@tanstack/react-router'
import { ChannelStoreImport } from '@/features/channels'
import { requireFeature } from '@/lib/require-feature'

export const Route = createFileRoute('/_authenticated/op/channels/stores/$id/import')({
  beforeLoad: () => requireFeature('admin_stores'),
  component: ChannelStoreImport,
})
