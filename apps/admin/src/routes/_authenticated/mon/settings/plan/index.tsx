import { PlanUsageSettings } from '@/features/settings/plan'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/mon/settings/plan/')({
  component: PlanUsageSettings,
})
