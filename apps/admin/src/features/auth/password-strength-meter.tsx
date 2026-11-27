import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Password strength meter (login redesign Step 1).
 *
 * The rules mirror the backend `StrongPasswordConstraint`
 * (apps/backend/src/auth/validators/password.validator.ts) and the zod
 * schemas in the forgot/reset forms exactly — min 8 chars, one
 * uppercase, one lowercase, one number, one special character — so the
 * meter can never disagree with the server. The same component is used
 * by forgot-password (step 3) and reset-password (link fallback).
 * Shared with the storefront in Step 2 via the same rule list.
 */

export interface PasswordRule {
  id: string
  label: string
  test: (password: string) => boolean
}

export const PASSWORD_STRENGTH_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: 'At least 8 characters',
    test: (password) => password.length >= 8,
  },
  {
    id: 'uppercase',
    label: 'An uppercase letter',
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: 'lowercase',
    label: 'A lowercase letter',
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: 'number',
    label: 'A number',
    test: (password) => /[0-9]/.test(password),
  },
  {
    id: 'special',
    label: 'A special character',
    test: (password) => /[!@#$%^&*()_+\-=[\]{}|;':",./<>?]/.test(password),
  },
]

export function passwordStrength(password: string): {
  score: number
  passed: string[]
} {
  const passed = PASSWORD_STRENGTH_RULES.filter((rule) =>
    rule.test(password),
  ).map((rule) => rule.id)
  return { score: passed.length, passed }
}

function strengthLabel(score: number): string {
  if (score <= 1) return 'Weak'
  if (score <= 3) return 'Fair'
  if (score === 4) return 'Good'
  return 'Strong'
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  const { score } = passwordStrength(password)
  if (password.length === 0) return null

  const barColor =
    score <= 2
      ? 'bg-destructive'
      : score <= 4
        ? 'bg-warning'
        : 'bg-success'

  return (
    <div className='grid gap-1.5' aria-live='polite'>
      <div className='flex items-center gap-2'>
        <div
          className='h-1 flex-1 overflow-hidden rounded-full bg-muted'
          role='progressbar'
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={5}
          aria-label={`Password strength: ${strengthLabel(score)}`}
        >
          <div
            className={cn('h-full rounded-full transition-all duration-150', barColor)}
            style={{ width: `${(score / PASSWORD_STRENGTH_RULES.length) * 100}%` }}
          />
        </div>
        <span className='text-xs font-medium text-muted-foreground'>
          {strengthLabel(score)}
        </span>
      </div>
      <ul className='grid grid-cols-2 gap-x-3 gap-y-0.5'>
        {PASSWORD_STRENGTH_RULES.map((rule) => {
          const ok = rule.test(password)
          return (
            <li
              key={rule.id}
              className={cn(
                'flex items-center gap-1 text-xs',
                ok ? 'text-success-ink' : 'text-muted-foreground',
              )}
            >
              {ok ? (
                <Check className='size-3 shrink-0' aria-hidden />
              ) : (
                <X className='size-3 shrink-0' aria-hidden />
              )}
              {rule.label}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
