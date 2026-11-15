import { createFileRoute } from '@tanstack/react-router'
import { CareersApplicationsPage } from '@/features/hr/careers'
import { useEntitlementsStore } from '@/stores/entitlements-store'

const FEATURE = 'admin_hr_careers'

function CareersApplicationsRoute() {
  const loaded = useEntitlementsStore((s) => s.loaded)
  const hasFeature = useEntitlementsStore((s) => s.hasFeature)

  if (!loaded) return null
  if (!hasFeature(FEATURE)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium">Careers</p>
        <p className="text-sm">This feature is not available in your current plan.</p>
      </div>
    )
  }
  return <CareersApplicationsPage />
}

export const Route = createFileRoute('/_authenticated/hr/careers/applications')({
  component: CareersApplicationsRoute,
})
