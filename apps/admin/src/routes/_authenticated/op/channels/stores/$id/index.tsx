import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { ChannelStoreDetail } from '@/features/channels'
import { requireFeature } from '@/lib/require-feature'

const searchSchema = z.object({
  /** Set by the connect wizard on Save & Complete — shows the one-time
   * "Import products" offer callout on the Products tab (§1.2). */
  justConnected: z.string().optional(),
})

export const Route = createFileRoute('/_authenticated/op/channels/stores/$id/')({
  beforeLoad: () => requireFeature('admin_stores'),
  validateSearch: searchSchema,
  component: ChannelStoreDetail,
})
