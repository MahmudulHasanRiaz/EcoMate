import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { apiClient } from '@/lib/api-client'

interface EntitlementsResponse {
  planName: string | null
  subscriptionStatus: string | null
  accessState: string
  features: string[]
  limits: Record<string, unknown>
  validUntil: string | null
}

interface FeaturesContextType {
  features: string[]
  planName: string | null
  accessState: string | null
  hasFeature: (key: string) => boolean
  loading: boolean
  error: string | null
}

const FeaturesContext = createContext<FeaturesContextType>({
  features: [],
  planName: null,
  accessState: null,
  hasFeature: () => false,
  loading: true,
  error: null,
})

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const [features, setFeatures] = useState<string[]>([])
  const [planName, setPlanName] = useState<string | null>(null)
  const [accessState, setAccessState] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiClient
      .get<EntitlementsResponse>('/entitlements/me')
      .then((res) => {
        if (cancelled) return
        const next = res.data.features || []
        setFeatures(next)
        setPlanName(res.data.planName ?? null)
        setAccessState(res.data.accessState ?? null)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || 'Failed to load plan entitlements')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const hasFeature = useCallback(
    (key: string) => features.includes('*') || features.includes(key),
    [features],
  )

  return (
    <FeaturesContext value={{ features, planName, accessState, hasFeature, loading, error }}>
      {children}
    </FeaturesContext>
  )
}

export const useFeatures = () => useContext(FeaturesContext)
