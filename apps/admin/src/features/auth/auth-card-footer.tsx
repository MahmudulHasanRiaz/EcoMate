import { Link } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'

/**
 * The auth card footer (login round 2) — the bottom strips of the
 * sign-in / forgot-password / reset-password cards, shared so all
 * three stay identical.
 *
 * The two strips used to be twins: two identical `border-t px-5 py-3`
 * divs with identical `text-xs text-muted-foreground` centred text,
 * separated by the card's 16px flex gap — they read as two stray
 * boxes, and neither was truly centred on narrow widths (the text
 * was centred inside its <p>, but the rows themselves were plain
 * block divs). Clerk differentiates them, and so does this:
 *
 * - Sign-up row (sign-in only): a PLAIN row — no background, larger
 *   `text-sm` copy, the link in the brand colour. It reads as a line
 *   of text, not a strip.
 * - "Secured by EcoMate" row: a DISTINCT muted strip — tinted
 *   `bg-muted/50` background, smaller `text-xs font-medium` copy and
 *   a small shield icon. It reads as the card's footer seal.
 *
 * Both rows are `flex items-center justify-center`, so the content
 * is truly centre-centred at every width (the rows are full-width
 * flex children of the card, not text centred inside a block).
 *
 * The wrapper cancels the card's bottom padding (`-mb-5` against the
 * Card's `py-5`) so the secured strip's tinted background runs flush
 * to the card's bottom edge; `overflow-hidden rounded-b-[3px]` keeps
 * the tint inside the card's rounded corners.
 */
export function AuthCardFooter({ showSignUp = false }: { showSignUp?: boolean }) {
  return (
    <div className='-mb-5 overflow-hidden rounded-b-[3px]'>
      {showSignUp ? (
        <div className='flex items-center justify-center border-t px-5 py-3'>
          <p className='text-center text-sm text-muted-foreground'>
            Don&apos;t have an account?{' '}
            <Link
              to='/sign-up'
              className='auth-link font-medium underline underline-offset-4'
            >
              Sign up
            </Link>
          </p>
        </div>
      ) : null}
      <div className='flex items-center justify-center gap-1.5 border-t bg-muted/50 px-5 py-2.5'>
        <ShieldCheck
          className='size-3.5 shrink-0 text-muted-foreground'
          aria-hidden='true'
        />
        <p className='text-center text-xs font-medium text-muted-foreground'>
          Secured by EcoMate
        </p>
      </div>
    </div>
  )
}
