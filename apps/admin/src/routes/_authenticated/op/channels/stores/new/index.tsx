import { createFileRoute } from '@tanstack/react-router'
import { StoreConnectPage } from '@/features/channels'
import { requireFeature } from '@/lib/require-feature'

export const Route = createFileRoute('/_authenticated/op/channels/stores/new/')({
  beforeLoad: () => requireFeature('admin_stores'),
  component: StoreConnectPage,
})
