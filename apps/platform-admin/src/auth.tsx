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

const API_BASE = (import.meta.env.VITE_PLATFORM_API_URL || '/api').replace(
  /\/+$/,
  '',
);
const STORAGE_KEY = 'ecomate.platform.session';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: PlatformUser;
}

interface AuthValue {
  session: Session | null;
  login: (email: string, password: string) => Promise<void>;
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
    async (email: string, password: string) => {
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
      const data = await readJson<LoginResponse>(response);
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
    () => ({ session, login, logout, api }),
    [session, login, logout, api],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
