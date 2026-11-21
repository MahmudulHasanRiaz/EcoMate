import { createFileRoute } from '@tanstack/react-router'
import { SmtpSettings } from '@/features/settings/smtp'
import { requireFeature } from '@/lib/require-feature'

export const Route = createFileRoute('/_authenticated/mon/settings/smtp/')({
  // SMTP is a separate add-on (Boss point 1): a tenant without the
  // smtp_server feature never reaches this page — same pattern as the
  // courier settings route.
  beforeLoad: () => requireFeature('smtp_server'),
  component: SmtpSettings,
})
