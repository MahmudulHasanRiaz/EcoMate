import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { AuthBrandHeader } from './auth-brand-header'
import { DEFAULT_BRAND_COLORS, type PublicBranding } from './branding'

/**
 * Login polish: the brand header lives INSIDE the auth card and
 * renders exactly what the storefront header renders for the same
 * tenant — the storefront's own display mode (`display`) is the only
 * source of truth. The branding hook is mocked — the fetch itself is
 * covered by the endpoint's own tests and the live staging check.
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
    display: 'name',
    ...overrides,
  }
}

describe('AuthBrandHeader (in-card, storefront display mode)', () => {
  beforeEach(() => {
    brandingState.value = null
  })

  it("shows the store name alone in 'name' mode, with no tile and no tagline", async () => {
    brandingState.value = makeBranding({ storeName: 'Features Test Store' })
    const screen = await render(<AuthBrandHeader />)

    await expect
      .element(screen.getByRole('heading', { name: 'Features Test Store' }))
      .toBeInTheDocument()
    // Login round 2 (Boss): the "Admin Dashboard" tagline line under
    // the name is gone — the name alone is the header, in every mode.
    expect(screen.container.textContent).not.toContain('Admin Dashboard')
    expect(screen.container.textContent).not.toContain('FT')
  })

  it("shows only the logo in 'logo' mode — no name, no tile", async () => {
    brandingState.value = makeBranding({
      storeName: 'Features Test Store',
      storeLogo: '/images/favicon.png',
      display: 'logo',
    })
    const screen = await render(<AuthBrandHeader />)

    const img = screen.getByAltText('Features Test Store logo')
    await expect.element(img).toBeInTheDocument()
    await expect.element(img).toHaveAttribute('src', '/images/favicon.png')
    const headings = await screen.getByRole('heading').all()
    expect(headings.length).toBe(0)
    expect(screen.container.textContent).not.toContain('Features Test Store')
  })

  it("shows the favicon beside the name in 'name+logo' mode", async () => {
    brandingState.value = makeBranding({
      storeName: 'Features Test Store',
      storefrontFavicon: '/images/favicon.png',
      display: 'name+logo',
    })
    const screen = await render(<AuthBrandHeader />)

    const img = screen.container.querySelector('img')
    expect(img).not.toBeNull()
    await expect.element(img as HTMLImageElement).toBeInTheDocument()
    await expect
      .element(screen.getByRole('heading', { name: 'Features Test Store' }))
      .toBeInTheDocument()
    expect(screen.container.textContent).not.toContain('FT')
  })

  it('falls back to the generic mark + "Admin" when there is no branding', async () => {
    const screen = await render(<AuthBrandHeader />)

    await expect
      .element(screen.getByRole('heading', { name: 'Admin' }))
      .toBeInTheDocument()
  })
})
