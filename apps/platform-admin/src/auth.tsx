import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PlatformUser, Session } from './types';
import { ApiError, readJson } from './lib/api';
import { classifyLoginResponse, type LoginOutcome } from './lib/mfa';

const API_BASE = (import.meta.env.VITE_PLATFORM_API_URL || '/api').replace(
  /\/+$/,
  '',
);
const STORAGE_KEY = 'ecomate.platform.session';

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

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Session;
    if (!value?.accessToken || !value?.refreshToken || !value?.user) return null;
    return value;
  } catch {
    return null;
  }
}

function writeSession(session: Session | null): void {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); the in-memory session still works.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;

  const api = useCallback(async function request(
    path: string,
    init: RequestInit = {},
    retry = true,
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

    const refresh = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    }).catch(() => null);

    if (!refresh?.ok) {
      writeSession(null);
      setSession(null);
      return response;
    }

    const tokens = await readJson<{
      accessToken: string;
      refreshToken?: string;
    }>(refresh);
    const next: Session = {
      ...current,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? current.refreshToken,
    };
    writeSession(next);
    setSession(next);
    return request(path, init, false);
  }, []);

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
        writeSession(next);
        setSession(next);
      }
      return outcome;
    },
    [],
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
      writeSession(next);
      setSession(next);
    },
    [],
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
        writeSession(next);
        setSession(next);
      }
      return { recoveryCodes: data.recoveryCodes };
    },
    [],
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
    writeSession(null);
    setSession(null);
  }, []);

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
