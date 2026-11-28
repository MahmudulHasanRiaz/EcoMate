import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { AuthLayout } from './auth-layout'
import { DEFAULT_BRAND_COLORS, type PublicBranding } from './branding'

/**
 * AuthLayout (login polish): renders ONLY the card + the page footer.
 * The brand header lives inside the card now (AuthBrandHeader — its
 * own tests); the layout keeps the scoped brand vars, the tab
 * title/favicon effect, and the page footer ("© <year> <store> ·
 * Terms of Service · Privacy Policy" at the very bottom of the page).
 * The branding hook is mocked — the fetch itself is covered by the
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
    display: 'name',
    ...overrides,
  }
}

describe('AuthLayout', () => {
  beforeEach(() => {
    brandingState.value = null
  })

  it('renders nothing above the card — no brand header outside it', async () => {
    brandingState.value = makeBranding({ storeName: 'Features Test Store' })
    const screen = await render(
      <AuthLayout>
        <div>child</div>
      </AuthLayout>,
    )

    // No brand heading anywhere in the layout itself — the header
    // lives inside the card (AuthBrandHeader). The store name may
    // still appear in the page footer, which is below the card.
    const headings = await screen.getByRole('heading').all()
    expect(headings.length).toBe(0)
    await expect.element(screen.getByText('child')).toBeInTheDocument()
    expect(document.title).toBe('Features Test Store · Admin')
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

  it('renders the page footer with the store name and Terms / Privacy links', async () => {
    brandingState.value = makeBranding({ storeName: 'Features Test Store' })
    const screen = await render(
      <AuthLayout>
        <div>child</div>
      </AuthLayout>,
    )

    const footer = screen.container.querySelector('footer')
    expect(footer).not.toBeNull()
    await expect
      .element(screen.getByText(/Features Test Store/))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: 'Terms of Service' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: 'Privacy Policy' }))
      .toBeInTheDocument()
  })

  it('falls back to EcoMate in the footer when there is no branding', async () => {
    const prevTitle = document.title
    const screen = await render(
      <AuthLayout>
        <div>child</div>
      </AuthLayout>,
    )

    await expect.element(screen.getByText(/EcoMate/)).toBeInTheDocument()
    // No brand → the effect leaves the tab title alone.
    expect(document.title).toBe(prevTitle)
  })
})
