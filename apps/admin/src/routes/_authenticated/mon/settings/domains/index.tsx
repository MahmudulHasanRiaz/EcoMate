import { createFileRoute } from '@tanstack/react-router'
import { DomainsSettings } from '@/features/settings/domains'

export const Route = createFileRoute('/_authenticated/mon/settings/domains/')({
  component: DomainsSettings,
})
