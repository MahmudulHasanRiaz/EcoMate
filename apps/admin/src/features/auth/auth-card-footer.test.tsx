import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { AuthCardFooter } from './auth-card-footer'

/**
 * Login round 2 (Boss): the two bottom strips of the auth card must
 * be truly centre-centred, responsive, and VISUALLY DIFFERENT from
 * each other — Clerk's sign-up line is a plain text row and its
 * "Secured by" line is a distinct muted footer strip. The old card
 * rendered both as identical `border-t px-5 py-3` divs with identical
 * `text-xs` centred text, which read as twin stray boxes.
 */

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: { children?: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
}))

describe('AuthCardFooter', () => {
  it('renders the sign-up row and the secured strip as two different, flex-centred rows', async () => {
    const screen = await render(<AuthCardFooter showSignUp />)

    const signUp = screen.getByText(/Don't have an account?/)
    await expect.element(signUp).toBeInTheDocument()
    const secured = screen.getByText('Secured by EcoMate')
    await expect.element(secured).toBeInTheDocument()

    // The two texts live in DIFFERENT rows (not one shared strip).
    const signUpRow = signUp.element().closest('div[class*="border-t"]')
    const securedRow = secured.element().closest('div[class*="border-t"]')
    expect(signUpRow).not.toBeNull()
    expect(securedRow).not.toBeNull()
    expect(signUpRow).not.toBe(securedRow)

    // Both rows are flex-centred (true centre-centring at every width).
    for (const row of [signUpRow, securedRow]) {
      const cls = (row as HTMLElement).className
      expect(cls).toContain('flex')
      expect(cls).toContain('items-center')
      expect(cls).toContain('justify-center')
    }

    // And they are VISUALLY DIFFERENT: the sign-up row is a plain
    // text row (text-sm, no background), the secured strip is a
    // tinted muted strip (bg-muted/50) with a shield icon.
    expect((signUpRow as HTMLElement).className).not.toContain('bg-muted')
    expect(signUp.element().className).toContain('text-sm')
    expect((securedRow as HTMLElement).className).toContain('bg-muted/50')
    expect(secured.element().className).toContain('text-xs')
    const shield = (securedRow as HTMLElement).querySelector('svg')
    expect(shield).not.toBeNull()

    // The sign-up link points at the sign-up page.
    const link = screen.getByText('Sign up')
    await expect.element(link).toBeInTheDocument()
    expect(link.element().getAttribute('href')).toBe('/sign-up')
  })

  it('renders only the secured strip when showSignUp is false', async () => {
    const screen = await render(<AuthCardFooter />)

    await expect.element(screen.getByText('Secured by EcoMate')).toBeInTheDocument()
    const signUps = await screen.getByText(/Don't have an account?/).all()
    expect(signUps.length).toBe(0)
  })
})
