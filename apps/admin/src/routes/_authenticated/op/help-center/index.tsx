import { createFileRoute } from '@tanstack/react-router'
import { HelpCenterPage } from '@/features/help-center'

export const Route = createFileRoute('/_authenticated/op/help-center/')({
  component: HelpCenterPage,
})
