import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { AuthLayout } from './auth-layout'
import { DEFAULT_BRAND_COLORS, type PublicBranding } from './branding'

/**
 * AuthLayout brand header: the tenant's own brand (logo / favicon /
 * initials from the store name) when the public branding endpoint
 * returns it, the generic EcoMate mark + "Admin" otherwise. The
 * branding hook is mocked — the fetch itself is covered by the
 * endpoint's own tests and the live staging check, not by this file.
 */

const brandingState = vi.hoisted(() => ({
  value: null as PublicBranding | null,
}))

vi.mock('./use-public-branding', () => ({
  usePublicBranding: () => ({
    branding: brandingState.value,
    isLoading: false,
    isError: false,
  }),
}))

function makeBranding(overrides: Partial<PublicBranding>): PublicBranding {
  return {
    storeName: '',
    adminTitle: '',
    adminFavicon: '',
    adminTagline: '',
    storefrontFavicon: '',
    storefrontOgImage: '',
    storeLogo: '',
    seoTitle: '',
    seoDescription: '',
    colors: DEFAULT_BRAND_COLORS,
    ...overrides,
  }
}

describe('AuthLayout tenant brand', () => {
  beforeEach(() => {
    brandingState.value = null
  })

  it('shows the store name, initials tile and tagline when only a name is set', async () => {
    brandingState.value = makeBranding({ storeName: 'Features Test Store' })
    const { getByRole, getByText } = await render(
      <AuthLayout>
        <div>child</div>
      </AuthLayout>,
    )

    await expect
      .element(getByRole('heading', { name: 'Features Test Store' }))
      .toBeInTheDocument()
    await expect.element(getByText('FT')).toBeInTheDocument()
    await expect.element(getByText('Admin Dashboard')).toBeInTheDocument()
    expect(document.title).toBe('Features Test Store · Admin')
  })

  it('shows the store logo when one is set', async () => {
    // /images/favicon.png is a real public asset, so the <img> actually
    // loads in the test browser — a missing URL would (by design) degrade
    // to the initials tile via onError.
    brandingState.value = makeBranding({
      storeName: 'Features Test Store',
      storeLogo: '/images/favicon.png',
    })
    const { getByAltText, getByRole } = await render(
      <AuthLayout>
        <div>child</div>
      </AuthLayout>,
    )

    const img = getByAltText('Features Test Store logo')
    await expect.element(img).toBeInTheDocument()
    await expect
      .element(img)
      .toHaveAttribute('src', '/images/favicon.png')
    await expect
      .element(getByRole('heading', { name: 'Features Test Store' }))
      .toBeInTheDocument()
  })

  it('shows the admin favicon in a tile when there is no logo', async () => {
    brandingState.value = makeBranding({
      storeName: 'Features Test Store',
      adminFavicon: '/images/favicon.png',
    })
    const { getByAltText } = await render(
      <AuthLayout>
        <div>child</div>
      </AuthLayout>,
    )

    const img = getByAltText('Features Test Store icon')
    await expect.element(img).toBeInTheDocument()
    await expect
      .element(img)
      .toHaveAttribute('src', '/images/favicon.png')
  })

  it('applies the tenant brand colour as a scoped CSS var on the wrapper', async () => {
    brandingState.value = makeBranding({
      storeName: 'Features Test Store',
      colors: { ...DEFAULT_BRAND_COLORS, primary: '#123456' },
    })
    const { container } = await render(
      <AuthLayout>
        <div>child</div>
      </AuthLayout>,
    )

    const wrapper = container.querySelector('.auth-widget')
    expect(wrapper).not.toBeNull()
    expect(
      (wrapper as HTMLElement).style.getPropertyValue('--auth-brand').trim(),
    ).toBe('#123456')
  })

  it('falls back to the generic mark and "Admin" when there is no branding', async () => {
    const prevTitle = document.title
    const { getByRole } = await render(
      <AuthLayout>
        <div>child</div>
      </AuthLayout>,
    )

    await expect
      .element(getByRole('heading', { name: 'Admin' }))
      .toBeInTheDocument()
    // No brand → the effect leaves the tab title alone.
    expect(document.title).toBe(prevTitle)
  })
})
