import { useState, useEffect, FormEvent } from 'react'
import { authClient } from '../lib/better-auth-client'
import api from '../api/client'
import {
  SOCIAL_PROVIDERS,
  baErrorMessage,
  isTwoFactorRequiredError,
  socialCallbackUrls,
  type SocialProviderId,
} from '../lib/ba-auth-errors'
import { Store, KeyRound, Mail, Loader2, ShieldCheck } from 'lucide-react'
import { SafeImage } from '../components/safe-image'
import { apiUrl } from '../lib/api-base'

interface Props { onSuccess: () => void }

/** Roles allowed on a POS terminal (client-side gate, kept from the JWT login). */
const POS_ROLES = ['cashier', 'admin', 'superadmin']

/**
 * POS sign-in — Phase 3 central Better Auth cutover.
 *
 * Email sign-in goes through `authClient.signIn.email()` (same-origin
 * `/api/better-auth/*` proxy → central service). There is no access token
 * to store: the BA session cookie is the credential. The tenant profile
 * (role) is read from the backend `GET /auth/me` — the central session
 * user carries no tenant role — and only cashier/admin/superadmin may
 * use POS (`employee`, `packing_assistant` and `customer` are refused
 * exactly as before).
 *
 * A TOTP-enabled user gets FORBIDDEN { code: "TWO_FACTOR_REQUIRED" } with
 * no session (Phase 1 Q11) — the form switches to the challenge screen
 * instead of erroring out. Social sign-in (D9=B) is wired the same way
 * as the admin login; the fixed-host-set constraint applies (see
 * `lib/ba-auth-errors.ts`): on a custom domain the provider refuses and
 * the user signs in with email instead.
 */
export function LoginPage({ onSuccess }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [storeLogo, setStoreLogo] = useState<string | null>(null)
  const [stage, setStage] = useState<'password' | 'challenge'>('password')
  const [useBackupCode, setUseBackupCode] = useState(false)
  const [code, setCode] = useState('')
  const [backupCode, setBackupCode] = useState('')
  const [pendingProvider, setPendingProvider] = useState<SocialProviderId | null>(null)

  useEffect(() => {
    fetch(apiUrl('/system-settings/branding'), { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.storeLogo) setStoreLogo(d.storeLogo) })
      .catch(() => {}) // silently fall back
  }, [])

  // Social sign-in returns here with `?error=` when the provider (or the
  // user) refuses — surface it instead of a silent landing on the form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    if (!err) return
    setError(
      err === 'access_denied'
        ? 'Social sign-in was cancelled. Please try again or sign in with email.'
        : 'Social sign-in failed. Please try again or sign in with email.',
    )
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  /**
   * The session cookie is set — confirm the tenant profile, enforce the
   * POS role gate, and enter the terminal. Runs after password sign-in
   * AND after a successful TOTP challenge.
   */
  async function completeSignIn() {
    let me: { role?: string }
    try {
      const res = await api.get('/auth/me')
      me = res.data?.user || res.data
      if (!me || !me.role) throw new Error('empty profile')
    } catch {
      // Fail closed: a session whose tenant profile cannot be read must
      // never enter the terminal.
      await authClient.signOut().catch(() => {})
      setError('Could not load your account. Please try again.')
      return
    }

    if (!POS_ROLES.includes(me.role!)) {
      await authClient.signOut().catch(() => {})
      setError('Access denied. Cashier or admin role required.')
      setStage('password')
      return
    }
    onSuccess()
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { error: signInError } = await authClient.signIn.email({
        email,
        password,
      })
      if (signInError) {
        if (isTwoFactorRequiredError(signInError)) {
          setStage('challenge')
          return
        }
        throw signInError
      }
      await completeSignIn()
    } catch (err: any) {
      setError(baErrorMessage(err, err?.response?.data?.message || 'Login failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleChallengeSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { error: verifyError } = await authClient.twoFactor.verifyTotp({
        code: code.trim(),
        trustDevice: true,
      })
      if (verifyError) throw verifyError
      await completeSignIn()
    } catch (err: any) {
      setError(baErrorMessage(err, 'Invalid code. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  const handleBackupCodeSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { error: verifyError } = await authClient.twoFactor.verifyBackupCode({
        code: backupCode.trim(),
      })
      if (verifyError) throw verifyError
      await completeSignIn()
    } catch (err: any) {
      setError(baErrorMessage(err, 'Invalid recovery code. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSocial(provider: SocialProviderId) {
    setPendingProvider(provider)
    setError('')
    try {
      const { callbackURL, errorCallbackURL } = socialCallbackUrls()
      const { error: socialError } = await authClient.signIn.social({
        provider,
        callbackURL,
        errorCallbackURL,
      })
      if (socialError) {
        setError(`Could not start ${provider} sign-in. Please try email sign-in instead.`)
        setPendingProvider(null)
      }
      // On success the browser leaves for the provider — no further UI here.
    } catch {
      setError(`Could not start ${provider} sign-in. Please try email sign-in instead.`)
      setPendingProvider(null)
    }
  }

  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-slate-950">
      {/* Dynamic ambient background shapes */}
      <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-emerald-500/10 blur-[100px]" />
      <div className="absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-teal-500/10 blur-[100px]" />

      <form
        onSubmit={stage === 'challenge' ? (useBackupCode ? handleBackupCodeSubmit : handleChallengeSubmit) : handleSubmit}
        className="glass-dark relative z-10 w-full max-w-md rounded-2xl p-8 text-white shadow-2xl transition-all duration-300"
      >
        <div className="mb-8 flex flex-col items-center">
          {storeLogo ? (
            <SafeImage
              src={storeLogo}
              alt="Store"
              className="h-16 w-16 rounded-2xl object-cover ring-1 ring-emerald-500/30"
              resizeWidth={128}
              resizeHeight={128}
              loading="eager"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30">
              <Store size={28} />
            </div>
          )}
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-100">EcoMate POS</h1>
          <p className="mt-1 text-sm text-slate-400">
            {stage === 'challenge' ? 'Two-factor authentication' : 'Sign in to your checkout terminal'}
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400 animate-in fade-in slide-in-from-top-1 duration-200">
            {error}
          </div>
        )}

        {stage === 'challenge' ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Two-factor authentication is on for this account. Enter the
              6-digit code from your authenticator app to continue.
            </p>
            {!useBackupCode ? (
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Authentication code</label>
                <div className="relative">
                  <ShieldCheck className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <input
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/50 py-3 pl-11 pr-4 text-sm text-slate-200 placeholder-slate-600 outline-none transition-all duration-200 focus:border-emerald-500 focus:bg-slate-900 focus:ring-2 focus:ring-emerald-500/20 tracking-[0.3em]"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                    autoFocus
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Recovery code</label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <input
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/50 py-3 pl-11 pr-4 text-sm text-slate-200 placeholder-slate-600 outline-none transition-all duration-200 focus:border-emerald-500 focus:bg-slate-900 focus:ring-2 focus:ring-emerald-500/20"
                    type="text"
                    autoComplete="one-time-code"
                    placeholder="XXXXX-XXXXX"
                    value={backupCode}
                    onChange={(e) => setBackupCode(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              </div>
            )}
            <button
              type="submit"
              disabled={loading || (!useBackupCode && code.length < 6) || (useBackupCode && !backupCode.trim())}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Verify and sign in</span>
              )}
            </button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => setUseBackupCode((v) => !v)}
                className="font-medium text-slate-400 underline underline-offset-4 hover:text-slate-200 cursor-pointer"
              >
                {useBackupCode ? 'Use authenticator code instead' : 'Use a recovery code instead'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStage('password')
                  setUseBackupCode(false)
                  setCode('')
                  setBackupCode('')
                }}
                className="font-medium text-slate-400 underline underline-offset-4 hover:text-slate-200 cursor-pointer"
              >
                Back to sign-in
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {/* R-BITWARDEN: explicit autocomplete tokens so password managers
                  can identify the login form (see the tenant admin sign-in form). */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <input
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/50 py-3 pl-11 pr-4 text-sm text-slate-200 placeholder-slate-600 outline-none transition-all duration-200 focus:border-emerald-500 focus:bg-slate-900 focus:ring-2 focus:ring-emerald-500/20"
                    type="email"
                    autoComplete="username"
                    placeholder="Enter email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Password</label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
                  <input
                    className="w-full rounded-xl border border-slate-800 bg-slate-900/50 py-3 pl-11 pr-4 text-sm text-slate-200 placeholder-slate-600 outline-none transition-all duration-200 focus:border-emerald-500 focus:bg-slate-900 focus:ring-2 focus:ring-emerald-500/20"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Signing you in...</span>
                </>
              ) : (
                <span>Launch POS Terminal</span>
              )}
            </button>

            <div className="mt-6">
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="h-px flex-1 bg-slate-800" aria-hidden />
                <span>or continue with</span>
                <span className="h-px flex-1 bg-slate-800" aria-hidden />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {SOCIAL_PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={pendingProvider !== null || loading}
                    onClick={() => handleSocial(p.id)}
                    className="rounded-xl border border-slate-800 bg-slate-900/50 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-emerald-500/50 hover:text-white disabled:opacity-50 cursor-pointer"
                  >
                    {pendingProvider === p.id ? 'Redirecting…' : p.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-center text-xs text-slate-500">
                Social sign-in works on your store&apos;s main address. On a
                custom domain, use email sign-in instead.
              </p>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
