import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { FeaturesProvider, useFeatures } from './features-provider'
import { useAuthStore } from '@/stores/auth-store'

const apiGet = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: apiGet },
}))

function Probe() {
  const { features, loading, hasFeature } = useFeatures()
  return (
    <div>
      <span data-testid='loading'>{String(loading)}</span>
      <span data-testid='features'>{features.join(',')}</span>
      <span data-testid='has-storefront'>
        {String(hasFeature('storefront'))}
      </span>
    </div>
  )
}

describe('FeaturesProvider session gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.getState().auth.reset()
    apiGet.mockResolvedValue({
      data: {
        features: ['storefront', 'pos_system'],
        planName: 'Trial',
        accessState: 'active',
      },
    })
  })

  it('does not fetch entitlements when logged out (public auth pages)', async () => {
    const screen: RenderResult = await render(
      <FeaturesProvider>
        <Probe />
      </FeaturesProvider>,
    )

    // No session → no call, no loading spinner stuck on, no features.
    await expect.element(screen.getByTestId('loading')).toHaveTextContent(/^false$/)
    expect(apiGet).not.toHaveBeenCalled()
    await expect.element(screen.getByTestId('features')).toHaveTextContent(/^$/)
    await expect.element(screen.getByTestId('has-storefront')).toHaveTextContent(/^false$/)
  })

  it('fetches entitlements when signed in', async () => {
    useAuthStore.getState().auth.setSignedIn(true)
    const screen: RenderResult = await render(
      <FeaturesProvider>
        <Probe />
      </FeaturesProvider>,
    )

    await vi.waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/entitlements/me'),
    )
    await expect
      .element(screen.getByTestId('features'))
      .toHaveTextContent(/^storefront,pos_system$/)
    await expect.element(screen.getByTestId('has-storefront')).toHaveTextContent(/^true$/)
  })

  it('fetches when sign-in happens after mount (login)', async () => {
    const screen: RenderResult = await render(
      <FeaturesProvider>
        <Probe />
      </FeaturesProvider>,
    )
    await expect.element(screen.getByTestId('loading')).toHaveTextContent(/^false$/)
    expect(apiGet).not.toHaveBeenCalled()

    useAuthStore.getState().auth.setSignedIn(true)

    await vi.waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/entitlements/me'),
    )
    await expect
      .element(screen.getByTestId('features'))
      .toHaveTextContent(/^storefront,pos_system$/)
  })

  it('clears entitlements when signed out (logout)', async () => {
    useAuthStore.getState().auth.setSignedIn(true)
    const screen: RenderResult = await render(
      <FeaturesProvider>
        <Probe />
      </FeaturesProvider>,
    )
    await vi.waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith('/entitlements/me'),
    )
    await expect
      .element(screen.getByTestId('features'))
      .toHaveTextContent(/^storefront,pos_system$/)

    useAuthStore.getState().auth.reset()

    await expect.element(screen.getByTestId('features')).toHaveTextContent(/^$/)
    await expect.element(screen.getByTestId('has-storefront')).toHaveTextContent(/^false$/)
  })
})
