import { createFileRoute } from '@tanstack/react-router'
import { SyncCenter } from '@/features/channels/sync-center'
import { requireFeature } from '@/lib/require-feature'

export const Route = createFileRoute('/_authenticated/op/channels/sync-center')({
  // Sync Center has its own feature key (admin_sync_center), separate
  // from the stores pages.
  beforeLoad: () => requireFeature('admin_sync_center'),
  component: SyncCenter,
})
