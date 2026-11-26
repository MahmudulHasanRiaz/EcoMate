"use client";

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { authClient } from '@/lib/better-auth-client';
import {
  SOCIAL_PROVIDERS,
  socialCallbackUrls,
  type SocialProviderId,
} from '@/lib/ba-auth-errors';
import { Sidebar } from './Sidebar';
import { ProfileSection } from './sections/ProfileSection';
import { OrdersSection } from './sections/OrdersSection';
import { AddressesSection } from './sections/AddressesSection';
import { SettingsSection } from './sections/SettingsSection';
import { HrSection } from './sections/HrSection';
import { useRouter } from 'next/navigation';

type Section = 'profile' | 'orders' | 'addresses' | 'settings' | 'hr';

export default function AccountPage() {
  const {
    user,
    loading,
    login,
    requestLoginOtp,
    loginWithOtp,
    register,
    twoFactorRequired,
    verifyTwoFactor,
    verifyBackupCode,
    clearTwoFactor,
  } = useAuth();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<Section>('profile');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [challengeCode, setChallengeCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<SocialProviderId | null>(null);
  // OTP login (D7 flip, 2026-11-26): email → 6-digit code → signed in.
  const [otpStage, setOtpStage] = useState<'password' | 'otp-email' | 'otp-code'>('password');
  const [otpCode, setOtpCode] = useState('');

  // Social sign-in returns here with `?error=` when the provider (or the
  // user) refuses — surface it instead of a silent landing on the form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (!err) return;
    setError(
      err === 'access_denied'
        ? 'Social sign-in was cancelled. Please try again or sign in with email.'
        : 'Social sign-in failed. Please try again or sign in with email.',
    );
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function handleSocial(provider: SocialProviderId) {
    setPendingProvider(provider);
    setError('');
    try {
      const { callbackURL, errorCallbackURL } = socialCallbackUrls();
      const { error: socialError } = await authClient.signIn.social({
        provider,
        callbackURL,
        errorCallbackURL,
      });
      if (socialError) {
        setError(`Could not start ${provider} sign-in. Please try email sign-in instead.`);
        setPendingProvider(null);
      }
      // On success the browser leaves for the provider — no further UI here.
    } catch {
      setError(`Could not start ${provider} sign-in. Please try email sign-in instead.`);
      setPendingProvider(null);
    }
  }

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-blue" size={32} />
      </div>
    );
  }

  // Phase 3 (Q11): a TOTP-enabled customer signs in with password first,
  // then verifies a code here. `login()` sets `twoFactorRequired` instead
  // of throwing, so this screen replaces the form until the challenge
  // succeeds (or the user goes back to the password form).
  if (!user && twoFactorRequired) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 md:py-24">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Two-factor authentication</h2>
            <p className="text-sm text-gray-500">
              Two-factor authentication is on for this account. Enter the 6-digit
              code from your authenticator app to continue.
            </p>
          </div>
          <form onSubmit={async (e) => {
            e.preventDefault(); setError(''); setSubmitting(true);
            try {
              if (useBackupCode) await verifyBackupCode(backupCode.trim());
              else await verifyTwoFactor(challengeCode.trim());
            } catch (err: any) {
              setError(err?.message || 'Invalid code. Please try again.');
            } finally { setSubmitting(false); }
          }} className="space-y-4">
            {!useBackupCode ? (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-600 ml-1">Authentication code</label>
                <input type="text" inputMode="numeric" autoComplete="one-time-code" value={challengeCode} onChange={e => setChallengeCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm tracking-[0.3em]" required autoFocus />
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-600 ml-1">Recovery code</label>
                <input type="text" autoComplete="one-time-code" value={backupCode} onChange={e => setBackupCode(e.target.value)} placeholder="XXXXX-XXXXX" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" required autoFocus />
              </div>
            )}
            {error && <div className="text-red-500 text-xs font-medium bg-red-50 p-3 rounded-xl">{error}</div>}
            <button type="submit" disabled={submitting || (!useBackupCode && challengeCode.length < 6) || (useBackupCode && !backupCode.trim())} className="w-full h-12 bg-brand-blue hover:bg-brand-blue/90 text-white font-bold rounded-xl transition-all shadow-lg shadow-brand-blue/20 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center">
              {submitting ? <Loader2 className="animate-spin" size={20} /> : 'Verify and sign in'}
            </button>
          </form>
          <div className="mt-6 flex items-center justify-between text-sm">
            <button type="button" onClick={() => setUseBackupCode(!useBackupCode)} className="font-medium text-gray-500 underline underline-offset-4 hover:text-brand-blue">
              {useBackupCode ? 'Use authenticator code instead' : 'Use a recovery code instead'}
            </button>
            <button type="button" onClick={() => { clearTwoFactor(); setChallengeCode(''); setBackupCode(''); setUseBackupCode(false); }} className="font-medium text-gray-500 underline underline-offset-4 hover:text-brand-blue">
              Back to sign-in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!user && isLoginMode && otpStage !== 'password') {
    return (
      <div className="max-w-md mx-auto px-4 py-12 md:py-24">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {otpStage === 'otp-email' ? 'OTP diye login' : 'Enter the code'}
            </h2>
            <p className="text-sm text-gray-500">
              {otpStage === 'otp-email'
                ? 'Apnar email-e ekta 6-digit code pathano hobe. Code diye sign in korun — password lagbe na.'
                : `${email} — ei email-e 6-digit code pathano hoyeche. Code-ti 15 minute porjonto valid.`}
            </p>
          </div>
          {otpStage === 'otp-email' ? (
            <form onSubmit={async (e) => {
              e.preventDefault(); setError(''); setSubmitting(true);
              try {
                await requestLoginOtp(email);
                setOtpCode('');
                setOtpStage('otp-code');
              } catch (err: any) {
                setError(err?.message || 'Could not send the code. Please try again.');
              } finally { setSubmitting(false); }
            }} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-600 ml-1">Email</label>
                <input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" required autoFocus />
              </div>
              {error && <div className="text-red-500 text-xs font-medium bg-red-50 p-3 rounded-xl">{error}</div>}
              <button type="submit" disabled={submitting} className="w-full h-12 bg-brand-blue hover:bg-brand-blue/90 text-white font-bold rounded-xl transition-all shadow-lg shadow-brand-blue/20 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center">
                {submitting ? <Loader2 className="animate-spin" size={20} /> : 'Send OTP'}
              </button>
            </form>
          ) : (
            <form onSubmit={async (e) => {
              e.preventDefault(); setError(''); setSubmitting(true);
              try {
                await loginWithOtp(email, otpCode.trim());
              } catch (err: any) {
                setError(err?.message || 'Invalid code. Please try again.');
              } finally { setSubmitting(false); }
            }} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-600 ml-1">Login code</label>
                <input type="text" inputMode="numeric" autoComplete="one-time-code" value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm tracking-[0.3em]" required autoFocus />
              </div>
              {error && <div className="text-red-500 text-xs font-medium bg-red-50 p-3 rounded-xl">{error}</div>}
              <button type="submit" disabled={submitting || otpCode.length < 6} className="w-full h-12 bg-brand-blue hover:bg-brand-blue/90 text-white font-bold rounded-xl transition-all shadow-lg shadow-brand-blue/20 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center">
                {submitting ? <Loader2 className="animate-spin" size={20} /> : 'Verify and sign in'}
              </button>
            </form>
          )}
          <div className="mt-6 flex items-center justify-between text-sm">
            {otpStage === 'otp-code' ? (
              <button type="button" onClick={async () => { setError(''); setSubmitting(true); try { await requestLoginOtp(email); setOtpCode(''); } catch (err: any) { setError(err?.message || 'Could not resend the code.'); } finally { setSubmitting(false); } }} disabled={submitting} className="font-medium text-gray-500 underline underline-offset-4 hover:text-brand-blue disabled:opacity-60">
                Resend code
              </button>
            ) : <span />}
            <button type="button" onClick={() => { setOtpStage(otpStage === 'otp-code' ? 'otp-email' : 'password'); setOtpCode(''); setError(''); }} className="font-medium text-gray-500 underline underline-offset-4 hover:text-brand-blue">
              {otpStage === 'otp-code' ? 'Use a different email' : 'Back to password sign-in'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 md:py-24">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {isLoginMode ? 'Welcome Back' : 'Create Account'}
            </h2>
            <p className="text-sm text-gray-500">
              {isLoginMode
                ? 'Sign in to access your orders, wishlist, and settings'
                : 'Sign up to get started'}
            </p>
          </div>

          <form onSubmit={async (e) => {
            e.preventDefault(); setError(''); setSubmitting(true);
            try {
              if (isLoginMode) await login(email, password);
              else await register({ firstName, lastName, username, email, phoneNumber, password });
            } catch (err: any) {
              setError(err?.response?.data?.message || err?.message || 'Authentication failed');
            } finally { setSubmitting(false); }
          }} className="space-y-4">
            {!isLoginMode && (
              <>
                {/* R-BITWARDEN: explicit autocomplete tokens so password
                    managers can identify the auth form (see the tenant
                    admin sign-in form). The password token switches with
                    the login/signup mode below. */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-600 ml-1">First Name</label>
                    <input type="text" autoComplete="given-name" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="John" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-600 ml-1">Last Name</label>
                    <input type="text" autoComplete="family-name" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Doe" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600 ml-1">Username</label>
                  <input type="text" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="johndoe" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600 ml-1">Phone Number</label>
                  <input type="tel" autoComplete="tel" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="+8801700000000" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
                </div>
              </>
            )}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600 ml-1">Email</label>
              <input type="email" autoComplete={isLoginMode ? 'username' : 'email'} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600 ml-1">Password</label>
              <input type="password" autoComplete={isLoginMode ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" required />
            </div>
            {error && <div className="text-red-500 text-xs font-medium bg-red-50 p-3 rounded-xl">{error}</div>}
            <button type="submit" disabled={submitting} className="w-full h-12 bg-brand-blue hover:bg-brand-blue/90 text-white font-bold rounded-xl transition-all shadow-lg shadow-brand-blue/20 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center">
              {submitting ? <Loader2 className="animate-spin" size={20} /> : (isLoginMode ? 'Sign In' : 'Create Account')}
            </button>
          </form>

          {isLoginMode && (
            <button type="button" disabled={submitting} onClick={() => { setError(''); setOtpStage('otp-email'); }} className="mt-3 w-full h-12 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-700 transition hover:border-brand-blue hover:text-brand-blue disabled:opacity-60">
              OTP diye login
            </button>
          )}

          {isLoginMode && (
            <div className="mt-6">
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span className="h-px flex-1 bg-gray-100" aria-hidden />
                <span>or continue with</span>
                <span className="h-px flex-1 bg-gray-100" aria-hidden />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {SOCIAL_PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={pendingProvider !== null || submitting}
                    onClick={() => handleSocial(p.id)}
                    className="h-11 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 transition hover:border-brand-blue hover:text-brand-blue disabled:opacity-60"
                  >
                    {pendingProvider === p.id ? 'Redirecting…' : p.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-center text-xs text-gray-400">
                Social sign-in works on your store&apos;s main address. On a
                custom domain, use email sign-in instead.
              </p>
            </div>
          )}

          <div className="mt-8 text-center border-t border-gray-100 pt-6">
            <span className="text-sm text-gray-500 mr-2">
              {isLoginMode ? "Don't have an account?" : "Already have an account?"}
            </span>
            <button type="button" onClick={() => setIsLoginMode(!isLoginMode)} className="text-sm font-bold text-brand-blue hover:underline">
              {isLoginMode ? 'Sign Up' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderSection = () => {
    const canViewHr = user?.isEmployee || user?.role === 'employee';
    switch (activeSection) {
      case 'profile': return <ProfileSection />;
      case 'orders': return <OrdersSection />;
      case 'addresses': return <AddressesSection />;
      case 'settings': return <SettingsSection />;
      case 'hr': return canViewHr ? <HrSection /> : <ProfileSection />;
      default: return <ProfileSection />;
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      <div className="flex flex-col md:flex-row gap-8">
        <div className="w-full md:w-80 flex-shrink-0">
          <Sidebar activeSection={activeSection} onNavigate={setActiveSection} />
        </div>
        <div className="flex-1 space-y-6">
          {renderSection()}
        </div>
      </div>
    </div>
  );
}
