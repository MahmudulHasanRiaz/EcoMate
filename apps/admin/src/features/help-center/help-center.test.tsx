import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'

// Layout chrome is irrelevant to these assertions and pulls in the shell
// (theme provider, router location, auth store).
vi.mock('@/components/layout/header', () => ({ Header: () => null }))
vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/profile-dropdown', () => ({ ProfileDropdown: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))

import { HelpCenterPage } from './index'

describe('HelpCenterPage (Shopify connect tutorial)', () => {
  it('renders the Shopify tutorial section with its key step headings and labels', async () => {
    const ui = await render(<HelpCenterPage />)
    await expect
      .element(ui.getByText('Shopify store connect korben kivabe', { exact: true }))
      .toBeInTheDocument()
    await expect.element(ui.getByText('Age ja lagbe', { exact: true })).toBeInTheDocument()
    await expect
      .element(ui.getByText('Shopify admin-e custom app banan', { exact: true }))
      .toBeInTheDocument()
    await expect.element(ui.getByText('Scope set koren', { exact: true })).toBeInTheDocument()
    await expect
      .element(ui.getByText('Customer data access on koren', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(ui.getByText('API key ar API secret nen', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(ui.getByText('EcoMate-te connect koren', { exact: true }))
      .toBeInTheDocument()
    await expect.element(ui.getByText('Test Connection chapen', { exact: true })).toBeInTheDocument()
    await expect
      .element(ui.getByText('Connect korar por ki hobe', { exact: true }))
      .toBeInTheDocument()
    await expect.element(ui.getByText('Somossha hole', { exact: true })).toBeInTheDocument()
  })

  it('shows the token-vs-secret warning prominently', async () => {
    const ui = await render(<HelpCenterPage />)
    await expect
      .element(ui.getByText(/Client Secret-er jaygay Admin API access token bosaben NA/))
      .toBeInTheDocument()
  })

  it('collapses and re-opens the tutorial section', async () => {
    const ui = await render(<HelpCenterPage />)
    const toggle = ui.getByRole('button', { name: /Shopify store connect korben kivabe/ })
    await expect.element(ui.getByText('Age ja lagbe', { exact: true })).toBeInTheDocument()
    await userEvent.click(toggle)
    await expect.element(ui.getByText('Age ja lagbe', { exact: true })).not.toBeInTheDocument()
    await userEvent.click(toggle)
    await expect.element(ui.getByText('Age ja lagbe', { exact: true })).toBeInTheDocument()
  })
})
