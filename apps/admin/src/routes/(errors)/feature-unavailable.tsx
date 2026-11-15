import { createFileRoute } from '@tanstack/react-router'
import { FeatureUnavailableError } from '@/features/errors/feature-unavailable'

export const Route = createFileRoute('/(errors)/feature-unavailable')({
  validateSearch: (search: Record<string, string | undefined>) => ({
    feature: search.feature as string | undefined,
  }),
  component: FeatureUnavailableError,
})
