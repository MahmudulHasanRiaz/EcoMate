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
import { classifyLoginResponse, type LoginOutcome } from './lib/mfa';
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
  login: (email: string, password: string) => Promise<LoginOutcome>;
  /** Complete the login second step for an MFA-enrolled account. */
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  /** Start MFA enrollment with a short-lived MFA token (mid-login). */
  startMfaSetup: (mfaToken: string) => Promise<MfaSetup>;
  /** Verify the new secret; on success the login completes and the
   * recovery codes are returned (shown once). */
  verifyMfaSetup: (
    mfaToken: string,
    code: string,
  ) => Promise<{ recoveryCodes: string[] }>;
  logout: () => void;
  api: (path: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;
  // Single-flight refresh: concurrent 401s share ONE refresh call instead
  // of each racing the refresh-token rotation (the API's reuse detection
  // tolerates the race with a grace window, but not starting it is better).
  const refreshPromiseRef = useRef<Promise<Session | null> | null>(null);

  // Keep the ref in sync synchronously with every session write. The ref
  // is only re-assigned during render (`sessionRef.current = session`
  // above); a synchronous api() retry after a refresh would otherwise
  // read the STALE session — the exact cause of the flaky "Invalid
  // platform session" error on Settings saves (F9).
  const storeSession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    writeSession(next);
    setSession(next);
  }, []);

  // Cross-tab sync (R-SESSION): the session is shared in localStorage, so a
  // login, refresh, or logout in one tab must reach every other tab. Without
  // this, tabs diverge on refresh-token rotation and the stale tab replays
  // a rotated token — outside the API's reuse grace window that revokes the
  // whole family and logs the operator out everywhere. `storage` fires only
  // in the tabs that did NOT make the write, so this cannot loop.
  useEffect(() => {
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
  }, [storeSession]);

  const api = useCallback(async function request(
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
    if (init.body && !headers.has('content-type')) {
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
  }, [storeSession]);

  const login = useCallback(
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
      }
      return outcome;
    },
    [storeSession],
  );

  const completeMfa = useCallback(
    async (mfaToken: string, code: string) => {
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
    },
    [storeSession],
  );

  const startMfaSetup = useCallback(async (mfaToken: string) => {
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
  }, []);

  const verifyMfaSetup = useCallback(
    async (mfaToken: string, code: string) => {
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
    [storeSession],
  );

  const logout = useCallback(() => {
    const current = sessionRef.current;
    if (current?.refreshToken) {
      void fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      }).catch(() => undefined);
    }
    storeSession(null);
  }, [storeSession]);

  const value = useMemo(
    () => ({
      session,
      login,
      completeMfa,
      startMfaSetup,
      verifyMfaSetup,
      logout,
      api,
    }),
    [session, login, completeMfa, startMfaSetup, verifyMfaSetup, logout, api],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
