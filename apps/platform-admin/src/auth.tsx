import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PlatformUser, Session } from './types';
import { ApiError, readJson } from './lib/api';
import { getAuthMode, type AuthMode } from './lib/auth-mode';
import {
  authClient,
  type BaSessionUser,
} from './lib/better-auth-client';
import {
  baErrorMessage,
} from './lib/ba-auth-errors';
import {
  hasLocalBackupCodesPresented,
  markLocalBackupCodesPresented,
} from './lib/backup-codes';
import {
  classifyLoginResponse,
  deriveMfaSetupRequired,
  extractTotpSecret,
  isBaTwoFactorChallenge,
  isTotpCode,
  type LoginOutcome,
} from './lib/mfa';
import {
  readSession,
  writeSession,
  SESSION_STORAGE_KEY,
} from './lib/session-store';

const API_BASE = (import.meta.env.VITE_PLATFORM_API_URL || '/api').replace(
  /\/+$/,
  '',
);

export interface MfaSetup {
  secret: string;
  otpauthUrl: string;
}

interface AuthValue {
  session: Session | null;
  /** Resolved runtime auth mode; null while the mode fetch is in flight. */
  authMode: AuthMode | null;
  /** True once the mode resolved to `central-ba`. Pages branch on this. */
  isCentralBa: boolean;
  login: (email: string, password: string) => Promise<LoginOutcome>;
  /**
   * Complete the login second step for an MFA-enrolled account.
   * Central-ba mode: `password` is the password the operator just
   * signed in with — BA's `generate-backup-codes` needs password proof
   * for the first-login fresh-codes screen. Returns fresh recovery
   * codes when that screen is due (the login page shows them once).
   */
  completeMfa: (
    code: string,
    password?: string,
  ) => Promise<{ recoveryCodes?: string[] }>;
  /**
   * Start MFA enrollment. Central-ba mode: BA's `twoFactor.enable`
   * needs the password (the login page passes the one just typed).
   * Legacy mode: the password is ignored; the stashed MFA token is used.
   */
  startMfaSetup: (password: string) => Promise<MfaSetup>;
  /** Verify the new secret; on success the login completes and the
   * recovery codes are returned (shown once). */
  verifyMfaSetup: (code: string) => Promise<{ recoveryCodes: string[] }>;
  /**
   * Central-ba mode only: release the sign-in hold after the operator
   * has seen the fresh recovery codes, publishing the session so the
   * console can be entered. No-op in custom-jwt mode.
   */
  acknowledgeBackupCodes: () => void;
  logout: () => void;
  api: (path: string, init?: RequestInit) => Promise<Response>;
  /** Re-fetch /auth/me and merge the user into the stored session
   * (e.g. after an avatar change, so the account menu updates at once). */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Canonical operator via the platform-api `/auth/me` shim (cookie auth in central-ba mode). */
async function fetchMe(): Promise<PlatformUser> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/auth/me`, {
      credentials: 'include',
    });
  } catch {
    throw new ApiError('Cannot reach the platform API.', 0);
  }
  return readJson<PlatformUser>(response);
}

/**
 * A SUPERADMIN without MFA must never hold a published console session
 * in central-ba mode: enrolment is forced at login, and a stale BA
 * session (e.g. after a page reload mid-enrolment, or after another
 * superadmin reset their MFA) must not slip past the gate. The login
 * flow enforces this with `deriveMfaSetupRequired`; the bridge enforces
 * it again here so a returning session cannot bypass enrolment.
 */
function isSessionPublishable(me: PlatformUser): boolean {
  return !(me.role === 'SUPERADMIN' && me.mfaEnabled !== true);
}

/**
 * Central-ba session bridge (rendered only in central-ba mode).
 *
 * `useSession` is a hook, so it lives in this child component — the
 * provider itself cannot call it conditionally. The bridge reports BA
 * user transitions (null on first paint is skipped: `useSession` is
 * briefly null while it fetches, which must not clear a session).
 */
function CentralSessionBridge({
  onBaUser,
}: {
  onBaUser: (user: BaSessionUser | null) => void;
}) {
  const { data } = authClient.useSession();
  const userId = (data?.user as BaSessionUser | undefined)?.id ?? null;
  const onBaUserRef = useRef(onBaUser);
  onBaUserRef.current = onBaUser;
  const prevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevUserIdRef.current === userId) return;
    prevUserIdRef.current = userId;
    onBaUserRef.current(
      userId ? (data?.user as BaSessionUser) : null,
    );
  }, [userId, data?.user]);
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;
  const [mode, setMode] = useState<AuthMode | null>(null);
  const modeRef = useRef<AuthMode | null>(null);
  // Single-flight refresh (custom-jwt mode only): concurrent 401s share
  // ONE refresh call instead of each racing the refresh-token rotation
  // (the API's reuse detection tolerates the race with a grace window,
  // but not starting it is better).
  const refreshPromiseRef = useRef<Promise<Session | null> | null>(null);
  /** Legacy mid-login MFA token (custom-jwt mode only — BA has none). */
  const pendingMfaTokenRef = useRef<string | null>(null);
  /**
   * Central-ba sign-in hold: while true, the bridge must not publish a
   * BA session — the operator is mid-login (MFA challenge, forced
   * enrolment, or the fresh-recovery-codes screen) and the login page
   * owns the next step. `pendingSessionRef` holds the session to
   * publish when the hold is released.
   */
  const holdRef = useRef(false);
  const pendingSessionRef = useRef<Session | null>(null);
  /** Backup codes issued by `twoFactor.enable`, shown after verify. */
  const pendingBackupCodesRef = useRef<string[]>([]);
  /** Last BA user id the bridge resolved (guards /me refetch storms). */
  const lastBaUserIdRef = useRef<string | null>(null);
  /** True once the bridge has ever seen a BA user this boot. */
  const seenBaUserRef = useRef(false);

  // Resolve the runtime mode once, syncing ref + state. The stale
  // custom-jwt session is cleared ONLY on the transition into
  // central-ba (first resolution) — every api()/login() call re-runs
  // this, and clearing here unconditionally would wipe the published
  // central session on every request.
  const resolveMode = useCallback(async (): Promise<AuthMode> => {
    const next = await getAuthMode();
    const prev = modeRef.current;
    modeRef.current = next;
    setMode(next);
    if (next === 'central-ba' && prev !== 'central-ba') {
      writeSession(null);
      sessionRef.current = null;
      setSession(null);
    }
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void resolveMode().catch(() => {
      if (!cancelled) {
        // getAuthMode() already defaults to custom-jwt on failure; this
        // only guards a rejection in the state sync itself.
        modeRef.current = 'custom-jwt';
        setMode('custom-jwt');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [resolveMode]);

  // Keep the ref in sync synchronously with every session write. The ref
  // is only re-assigned during render (`sessionRef.current = session`
  // above); a synchronous api() retry after a refresh would otherwise
  // read the STALE session — the exact cause of the flaky "Invalid
  // platform session" error on Settings saves (F9).
  //
  // Central-ba mode stores nothing: there are no tokens (cookie
  // session), and a token-less `{ user }` object would fail
  // `parseSession` on the next boot anyway.
  const storeSession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    if (modeRef.current !== 'central-ba') writeSession(next);
    setSession(next);
  }, []);

  /**
   * Publish a central-ba session, honouring the sign-in hold and the
   * SUPERADMIN enrolment gate. `null` always publishes (sign-out).
   */
  const publishCentralSession = useCallback(
    (next: Session | null) => {
      if (next && !isSessionPublishable(next.user)) return;
      if (holdRef.current) {
        pendingSessionRef.current = next;
        return;
      }
      pendingSessionRef.current = null;
      storeSession(next);
    },
    [storeSession],
  );

  /** Bridge callback: a BA user appeared, changed, or went away. */
  const handleBaUser = useCallback(
    async (baUser: BaSessionUser | null) => {
      if (!baUser) {
        // Skip the initial null (useSession still fetching); a real
        // user → null transition (sign-out elsewhere) clears.
        if (!seenBaUserRef.current) return;
        lastBaUserIdRef.current = null;
        publishCentralSession(null);
        return;
      }
      seenBaUserRef.current = true;
      if (
        baUser.id === lastBaUserIdRef.current &&
        sessionRef.current
      ) {
        return;
      }
      lastBaUserIdRef.current = baUser.id;
      try {
        const me = await fetchMe();
        publishCentralSession({ user: me });
      } catch (err) {
        // 401 = the BA session is not accepted by platform-api: drop it.
        // Anything else (platform-api down): leave the session alone.
        if (err instanceof ApiError && err.status === 401) {
          lastBaUserIdRef.current = null;
          publishCentralSession(null);
        }
      }
    },
    [publishCentralSession],
  );

  const acknowledgeBackupCodes = useCallback(() => {
    if (modeRef.current !== 'central-ba') return;
    holdRef.current = false;
    const pending = pendingSessionRef.current;
    pendingSessionRef.current = null;
    if (pending) storeSession(pending);
  }, [storeSession]);

  // Cross-tab sync (R-SESSION, custom-jwt mode only): the session is
  // shared in localStorage, so a login, refresh, or logout in one tab
  // must reach every other tab. Without this, tabs diverge on
  // refresh-token rotation and the stale tab replays a rotated token —
  // outside the API's reuse grace window that revokes the whole family
  // and logs the operator out everywhere. `storage` fires only in the
  // tabs that did NOT make the write, so this cannot loop. Central-ba
  // mode has no stored session; cross-tab sync is BA `useSession`.
  useEffect(() => {
    if (modeRef.current === 'central-ba') return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_STORAGE_KEY) return;
      const next = readSession();
      const current = sessionRef.current;
      if (
        next?.accessToken === current?.accessToken &&
        next?.refreshToken === current?.refreshToken
      ) {
        return;
      }
      storeSession(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storeSession, mode]);

  const legacyApi = useCallback(
    async function request(
      path: string,
      init: RequestInit = {},
      retry = true,
      adopted = false,
    ): Promise<Response> {
      const current = sessionRef.current ?? readSession();
      const headers = new Headers(init.headers);
      if (current?.accessToken) {
        headers.set('authorization', `Bearer ${current.accessToken}`);
      }
      // FormData bodies set their own multipart content-type (with the
      // boundary) — forcing application/json here would break uploads
      // (StackMate Decision 7: same fix in their shared client).
      const isFormData =
        typeof FormData !== 'undefined' && init.body instanceof FormData;
      if (init.body && !isFormData && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }

      const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
      if (response.status !== 401 || !retry || !current?.refreshToken) {
        return response;
      }

      if (!refreshPromiseRef.current) {
        refreshPromiseRef.current = (async () => {
          const refresh = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken: current.refreshToken }),
          }).catch(() => null);

          if (!refresh?.ok) return null;

          const tokens = await readJson<{
            accessToken: string;
            refreshToken?: string;
          }>(refresh);
          return {
            ...current,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken ?? current.refreshToken,
          };
        })();
      }

      const next = await refreshPromiseRef.current;
      refreshPromiseRef.current = null;

      if (!next) {
        // Refresh failed — but another tab may have rotated the tokens while
        // our refresh was in flight (its storage event may not have landed
        // yet). Adopt the fresher stored session and retry once instead of
        // logging the operator out for a race they did not cause. The
        // `adopted` flag bounds this to one adoption per call chain.
        if (!adopted) {
          const latest = readSession();
          if (latest && latest.refreshToken !== current.refreshToken) {
            storeSession(latest);
            return request(path, init, true, true);
          }
        }
        storeSession(null);
        return response;
      }

      storeSession(next);
      return request(path, init, false);
    },
    [storeSession],
  );

  const centralApi = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      const isFormData =
        typeof FormData !== 'undefined' && init.body instanceof FormData;
      if (init.body && !isFormData && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      // No Authorization header: the BA session cookies are the
      // credential (same-origin, so they ride along). No refresh dance:
      // BA owns the session lifetime.
      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers,
        credentials: 'include',
      });
      if (response.status === 401) {
        // The BA session is dead — drop the context session so AppShell
        // sends the operator back to sign-in. The cookies themselves are
        // owned by signOut, not by this call.
        storeSession(null);
      }
      return response;
    },
    [storeSession],
  );

  const api = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const nextMode = await resolveMode();
      if (nextMode === 'central-ba') return centralApi(path, init);
      return legacyApi(path, init);
    },
    [centralApi, legacyApi, resolveMode],
  );

  const refreshProfile = useCallback(async () => {
    const nextMode = await resolveMode();
    if (nextMode === 'central-ba') {
      if (!sessionRef.current) return;
      const me = await fetchMe();
      storeSession({ user: me });
      return;
    }
    const current = sessionRef.current ?? readSession();
    if (!current) return;
    const next = await api('/auth/me').then((r) => readJson<PlatformUser>(r));
    storeSession({ ...current, user: next });
  }, [api, resolveMode, storeSession]);

  /**
   * Fresh-backup-codes presentation (central-ba mode, survey §7.4).
   *
   * Migrated MFA operators arrive with an encrypted EMPTY backup-code
   * set, so at first central-ba login the console issues a fresh set
   * and shows it once. `generate-backup-codes` invalidates the previous
   * set on every call, so this runs ONCE per operator:
   *  1. platform marker `GET /auth/mfa/backup-codes-status`
   *     (platform-api; 404 until that half lands → step 2 decides);
   *  2. device-local marker (this browser);
   *  3. issue via BA (needs the password just typed), then record the
   *     presentation on the platform (best-effort) and locally.
   * A failure to issue never blocks sign-in — the operator signs in
   * normally and can issue codes from the account page.
   */
  const maybeIssueFreshBackupCodes = useCallback(
    async (
      me: PlatformUser,
      password: string,
    ): Promise<string[] | null> => {
      if (!password) return null;
      try {
        const check = await fetch(
          `${API_BASE}/auth/mfa/backup-codes-status`,
          { credentials: 'include' },
        ).catch(() => null);
        if (check?.ok) {
          const body: unknown = await check.json().catch(() => null);
          if (
            body &&
            typeof body === 'object' &&
            (body as { presented?: unknown }).presented === true
          ) {
            return null;
          }
        }
      } catch {
        // Endpoint absent/unreachable — the local marker decides.
      }
      if (hasLocalBackupCodesPresented(me.id)) return null;
      const { data, error } =
        await authClient.twoFactor.generateBackupCodes({ password });
      if (error || !data?.backupCodes?.length) return null;
      const codes = data.backupCodes;
      try {
        await fetch(`${API_BASE}/auth/mfa/backup-codes-presented`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ presentedAt: new Date().toISOString() }),
        }).catch(() => undefined);
      } catch {
        // Ignore — the local marker below still gates this browser.
      }
      markLocalBackupCodesPresented(me.id);
      return codes;
    },
    [],
  );

  const loginLegacy = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      let response: Response;
      try {
        response = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
      } catch {
        throw new ApiError('Cannot reach the platform API.', 0);
      }
      const outcome = classifyLoginResponse(await readJson(response));
      if (outcome.kind === 'session') {
        const next: Session = {
          accessToken: outcome.accessToken,
          refreshToken: outcome.refreshToken,
          user: outcome.user,
        };
        storeSession(next);
        return { kind: 'session', user: outcome.user };
      }
      pendingMfaTokenRef.current = outcome.mfaToken;
      return {
        kind: 'mfa',
        mfaSetupRequired: outcome.mfaSetupRequired,
      };
    },
    [storeSession],
  );

  const loginCentral = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      // Hold the bridge until this login resolves: the BA session must
      // not publish (and bounce the login page to `/`) while the MFA
      // challenge, forced enrolment, or fresh-codes screen is pending.
      holdRef.current = true;
      try {
        const { data, error } = await authClient.signIn.email({
          email,
          password,
        });
        if (isBaTwoFactorChallenge(data, error)) {
          return { kind: 'mfa', mfaSetupRequired: false };
        }
        if (error || !data?.user) {
          throw new ApiError(
            baErrorMessage(error, 'Sign-in failed. Please try again.'),
            error?.status ?? 0,
          );
        }
        // Signed in. The canonical operator comes from /auth/me (the
        // platform-api central shim), never from the BA session user.
        const me = await fetchMe();
        if (deriveMfaSetupRequired(me)) {
          // Hold stays on: no context session until enrolment completes.
          return { kind: 'mfa', mfaSetupRequired: true };
        }
        if (me.mfaEnabled === true) {
          const codes = await maybeIssueFreshBackupCodes(me, password);
          if (codes) {
            pendingSessionRef.current = { user: me };
            return { kind: 'session', user: me, recoveryCodes: codes };
          }
        }
        holdRef.current = false;
        storeSession({ user: me });
        return { kind: 'session', user: me };
      } catch (err) {
        holdRef.current = false;
        throw err;
      }
    },
    [maybeIssueFreshBackupCodes, storeSession],
  );

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const nextMode = await resolveMode();
      if (nextMode === 'central-ba') return loginCentral(email, password);
      return loginLegacy(email, password);
    },
    [loginCentral, loginLegacy, resolveMode],
  );

  const completeMfaCentral = useCallback(
    async (
      code: string,
      password?: string,
    ): Promise<{ recoveryCodes?: string[] }> => {
      holdRef.current = true;
      try {
        const trimmed = code.trim();
        if (isTotpCode(trimmed)) {
          const { error } = await authClient.twoFactor.verifyTotp({
            code: trimmed,
          });
          if (error) {
            throw new ApiError(
              baErrorMessage(error, 'Invalid code. Please try again.'),
              error.status ?? 0,
            );
          }
        } else {
          const { error } = await authClient.twoFactor.verifyBackupCode({
            code: trimmed,
          });
          if (error) {
            throw new ApiError(
              baErrorMessage(
                error,
                'Invalid recovery code. Please try again.',
              ),
              error.status ?? 0,
            );
          }
        }
        const me = await fetchMe();
        const codes = password
          ? await maybeIssueFreshBackupCodes(me, password)
          : null;
        if (codes) {
          pendingSessionRef.current = { user: me };
          return { recoveryCodes: codes };
        }
        holdRef.current = false;
        storeSession({ user: me });
        return {};
      } catch (err) {
        holdRef.current = false;
        throw err;
      }
    },
    [maybeIssueFreshBackupCodes, storeSession],
  );

  const completeMfaLegacy = useCallback(
    async (code: string): Promise<{ recoveryCodes?: string[] }> => {
      const mfaToken = pendingMfaTokenRef.current;
      if (!mfaToken) {
        throw new ApiError(
          'Your sign-in expired. Please sign in again.',
          0,
        );
      }
      let response: Response;
      try {
        response = await fetch(`${API_BASE}/auth/mfa/challenge`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mfaToken, code }),
        });
      } catch {
        throw new ApiError('Cannot reach the platform API.', 0);
      }
      const data = await readJson<{
        accessToken: string;
        refreshToken: string;
        user: PlatformUser;
      }>(response);
      const next: Session = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      };
      storeSession(next);
      return {};
    },
    [storeSession],
  );

  const completeMfa = useCallback(
    async (
      code: string,
      password?: string,
    ): Promise<{ recoveryCodes?: string[] }> => {
      const nextMode = await resolveMode();
      if (nextMode === 'central-ba') {
        return completeMfaCentral(code, password);
      }
      return completeMfaLegacy(code);
    },
    [completeMfaCentral, completeMfaLegacy, resolveMode],
  );

  const startMfaSetup = useCallback(async (password: string) => {
    const nextMode = await resolveMode();
    if (nextMode === 'central-ba') {
      // BA `twoFactor.enable` needs the password and returns the TOTP
      // URI + the one-time backup codes in one call (no separate
      // `getTotpUri` call — the URI is already in the response).
      const { data, error } = await authClient.twoFactor.enable({
        password,
      });
      if (error || !data || data.method !== 'totp') {
        throw new ApiError(
          baErrorMessage(error, 'Could not start two-factor setup.'),
          error?.status ?? 0,
        );
      }
      pendingBackupCodesRef.current = data.backupCodes ?? [];
      return {
        secret: extractTotpSecret(data.totpURI),
        otpauthUrl: data.totpURI,
      };
    }
    const mfaToken = pendingMfaTokenRef.current;
    if (!mfaToken) {
      throw new ApiError('Your sign-in expired. Please sign in again.', 0);
    }
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/auth/mfa/setup`, {
        method: 'POST',
        headers: { authorization: `Bearer ${mfaToken}` },
      });
    } catch {
      throw new ApiError('Cannot reach the platform API.', 0);
    }
    return readJson<MfaSetup>(response);
  }, [resolveMode]);

  const verifyMfaSetup = useCallback(
    async (code: string) => {
      const nextMode = await resolveMode();
      if (nextMode === 'central-ba') {
        const { error } = await authClient.twoFactor.verifyTotp({
          code: code.trim(),
        });
        if (error) {
          throw new ApiError(
            baErrorMessage(error, 'Invalid code. Please try again.'),
            error.status ?? 0,
          );
        }
        let me: PlatformUser;
        try {
          me = await fetchMe();
        } catch (err) {
          // Enrolment already succeeded and the BA session is live;
          // release the hold so the bridge can publish it, and surface
          // the profile-read failure instead of stranding the operator
          // on the setup step with a held session.
          holdRef.current = false;
          throw err;
        }
        const codes = pendingBackupCodesRef.current;
        pendingBackupCodesRef.current = [];
        // Enrolment just completed, so the published user is MFA-on
        // even if the /me read raced the flag flip.
        const sessionUser: PlatformUser = { ...me, mfaEnabled: true };
        if (codes.length > 0) {
          pendingSessionRef.current = { user: sessionUser };
          return { recoveryCodes: codes };
        }
        holdRef.current = false;
        storeSession({ user: sessionUser });
        return { recoveryCodes: [] as string[] };
      }
      const mfaToken = pendingMfaTokenRef.current;
      if (!mfaToken) {
        throw new ApiError(
          'Your sign-in expired. Please sign in again.',
          0,
        );
      }
      let response: Response;
      try {
        response = await fetch(`${API_BASE}/auth/mfa/verify`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${mfaToken}`,
          },
          body: JSON.stringify({ code }),
        });
      } catch {
        throw new ApiError('Cannot reach the platform API.', 0);
      }
      const data = await readJson<{
        enabled: boolean;
        recoveryCodes: string[];
        accessToken?: string;
        refreshToken?: string;
        user?: PlatformUser;
      }>(response);
      // Mid-login enrollment completes the login with session tokens.
      if (data.accessToken && data.refreshToken && data.user) {
        const next: Session = {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          user: data.user,
        };
        storeSession(next);
      }
      return { recoveryCodes: data.recoveryCodes };
    },
    [resolveMode, storeSession],
  );

  const logout = useCallback(async () => {
    const nextMode = await resolveMode().catch(
      () => 'custom-jwt' as AuthMode,
    );
    holdRef.current = false;
    pendingSessionRef.current = null;
    pendingBackupCodesRef.current = [];
    pendingMfaTokenRef.current = null;
    lastBaUserIdRef.current = null;
    seenBaUserRef.current = false;
    if (nextMode === 'central-ba') {
      // BA `signOut` is the session revocation (survey §10 Q8); the
      // platform-api logout shim stays for scripts / the legacy branch.
      storeSession(null);
      void authClient.signOut().catch(() => undefined);
      return;
    }
    const current = sessionRef.current;
    if (current?.refreshToken) {
      void fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      }).catch(() => undefined);
    }
    storeSession(null);
  }, [resolveMode, storeSession]);

  const value = useMemo(
    () => ({
      session,
      authMode: mode,
      isCentralBa: mode === 'central-ba',
      login,
      completeMfa,
      startMfaSetup,
      verifyMfaSetup,
      acknowledgeBackupCodes,
      logout,
      api,
      refreshProfile,
    }),
    [
      session,
      mode,
      login,
      completeMfa,
      startMfaSetup,
      verifyMfaSetup,
      acknowledgeBackupCodes,
      logout,
      api,
      refreshProfile,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {mode === 'central-ba' ? (
        <CentralSessionBridge onBaUser={handleBaUser} />
      ) : null}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
