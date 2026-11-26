import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { OrgSwitcher, orgHostUrl } from './org-switcher'
import { sessionRedirect } from '@/lib/api-client'

/**
 * Phase 3: org (store) switching via `useListOrganizations` /
 * `organization.setActive`, then navigation to the store's host.
 * Only renders when the user belongs to more than one org.
 *
 * Navigation goes through the `sessionRedirect` seam (same one the
 * api-client 401 handler uses): `window.location.assign` / `reload` are
 * non-configurable on the Location object in Chromium, so they cannot
 * be spied on directly.
 */

const setActive = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())
const orgsState = vi.hoisted(() => ({
  organizations: [] as Array<{ id: string; slug: string; name: string }>,
  activeOrganization: null as { id: string; slug: string; name: string } | null,
}))

vi.mock('@/lib/better-auth-client', () => ({
  authClient: {
    useListOrganizations: () => ({ data: orgsState.organizations }),
    useActiveOrganization: () => ({ data: orgsState.activeOrganization }),
    organization: { setActive },
  },
}))

vi.mock('sonner', () => ({
  toast: { error: toastError },
}))

const ORGS = [
  { id: 'org-a', slug: 'store-a', name: 'Store A' },
  { id: 'org-b', slug: 'store-b', name: 'Store B' },
]

describe('OrgSwitcher (Phase 3)', () => {
  let assignSpy: ReturnType<typeof vi.spyOn>
  let reloadSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    setActive.mockResolvedValue({ error: null })
    orgsState.organizations = [...ORGS]
    orgsState.activeOrganization = ORGS[0]
    // The test browser runs on `localhost` (no derivable base host), so a
    // switch lands on the reload path — spy the navigation seam.
    assignSpy = vi.spyOn(sessionRedirect, 'assign').mockImplementation(() => {})
    reloadSpy = vi.spyOn(sessionRedirect, 'reload').mockImplementation(() => {})
  })

  it('renders nothing with a single org', async () => {
    orgsState.organizations = [ORGS[0]]
    const screen = await render(<OrgSwitcher />)
    const matches = await screen.getByRole('button', { name: 'Switch store' }).all()
    expect(matches.length).toBe(0)
  })

  it('renders the active store name and lists both stores in the menu', async () => {
    const screen = await render(<OrgSwitcher />)
    await expect.element(screen.getByRole('button', { name: 'Switch store' })).toBeInTheDocument()
    await expect.element(screen.getByText('Store A')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Switch store' }))
    await expect.element(screen.getByRole('menuitem', { name: /Store B/ })).toBeInTheDocument()
    await expect.element(screen.getByRole('menuitem', { name: /Store A/ })).toBeInTheDocument()
  })

  it('switches the active org and navigates on select', async () => {
    const screen = await render(<OrgSwitcher />)
    await userEvent.click(screen.getByRole('button', { name: 'Switch store' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Store B/ }))

    expect(setActive).toHaveBeenCalledWith({ organizationId: 'org-b' })
    // `localhost` has no derivable base host → reload path.
    expect(reloadSpy).toHaveBeenCalled()
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('does nothing when the active org is selected again', async () => {
    const screen = await render(<OrgSwitcher />)
    await userEvent.click(screen.getByRole('button', { name: 'Switch store' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Store A/ }))

    expect(setActive).not.toHaveBeenCalled()
    expect(reloadSpy).not.toHaveBeenCalled()
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('shows an error and does not navigate when setActive fails', async () => {
    setActive.mockResolvedValue({ error: { message: 'forbidden' } })
    const screen = await render(<OrgSwitcher />)
    await userEvent.click(screen.getByRole('button', { name: 'Switch store' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Store B/ }))

    expect(toastError).toHaveBeenCalledWith('Could not switch store. Please try again.')
    expect(reloadSpy).not.toHaveBeenCalled()
    expect(assignSpy).not.toHaveBeenCalled()
  })
})

describe('orgHostUrl (Phase 3)', () => {
  it('builds the target store host from a multi-label host', () => {
    expect(orgHostUrl('store-a.staging.faah.net', 'store-b')).toBe(
      'https://store-b.staging.faah.net/admin/',
    )
  })

  it('returns null for the current store', () => {
    expect(orgHostUrl('store-a.staging.faah.net', 'store-a')).toBeNull()
  })

  it('returns null when the base host cannot be derived (custom domain / localhost)', () => {
    expect(orgHostUrl('mystore.com', 'other-store')).toBeNull()
    expect(orgHostUrl('localhost', 'other-store')).toBeNull()
  })
})
