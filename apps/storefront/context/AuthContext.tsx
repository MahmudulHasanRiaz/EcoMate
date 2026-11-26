"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { User } from "@/lib/types";
import * as authApi from "@/lib/api/auth";
import { authClient } from "@/lib/better-auth-client";

/**
 * Customer auth context — Phase 3 central Better Auth cutover.
 *
 * The BA session (`authClient.useSession()`) is the source of truth for
 * "signed in"; the tenant profile (name, phone, role) is read from the
 * backend `GET /auth/me` once per session. There is no access token in
 * localStorage anymore, no `auth:token-refreshed` event (no client-side
 * refresh — the BA session refreshes server-side via `updateAge`), and
 * no `refreshToken()` call. The `auth:logout` window event is kept: the
 * api client dispatches it on a 401, and this context clears the user.
 *
 * Guest checkout is untouched: `user === null` still checks out as a
 * guest (see `app/(main)/checkout/page.tsx`) — no session required.
 */

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    firstName: string;
    lastName: string;
    username: string;
    email: string;
    phoneNumber: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** True while the sign-in is waiting on a TOTP / recovery code. */
  twoFactorRequired: boolean;
  verifyTwoFactor: (code: string) => Promise<void>;
  verifyBackupCode: (code: string) => Promise<void>;
  clearTwoFactor: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const refreshUser = useCallback(async () => {
    try {
      const u = await authApi.getMe();
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // A live BA session loads the tenant profile; no session clears it.
  useEffect(() => {
    if (sessionPending) return;
    if (!session) {
      setUser(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    authApi
      .getMe()
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, sessionPending]);

  useEffect(() => {
    const handleLogout = () => {
      setUser(null);
    };
    window.addEventListener("auth:logout", handleLogout);
    return () => window.removeEventListener("auth:logout", handleLogout);
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const res = await authApi.login(email, password);
      setTwoFactorRequired(false);
      setUser(res.user);
    } catch (err) {
      if (err instanceof authApi.TwoFactorRequiredError) {
        setTwoFactorRequired(true);
        return;
      }
      throw err;
    }
  };

  const verifyTwoFactor = async (code: string) => {
    const res = await authApi.verifyTotp(code);
    setTwoFactorRequired(false);
    setUser(res.user);
  };

  const verifyBackupCode = async (code: string) => {
    const res = await authApi.verifyBackupCode(code);
    setTwoFactorRequired(false);
    setUser(res.user);
  };

  const clearTwoFactor = () => setTwoFactorRequired(false);

  const register = async (data: {
    firstName: string;
    lastName: string;
    username: string;
    email: string;
    phoneNumber: string;
    password: string;
  }) => {
    const res = await authApi.register(data);
    setUser(res.user);
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        refreshUser,
        twoFactorRequired,
        verifyTwoFactor,
        verifyBackupCode,
        clearTwoFactor,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
