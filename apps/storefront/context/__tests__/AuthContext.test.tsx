import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/context/AuthContext";

const { sessionState, getMe, login, register, logout, verifyTotp, verifyBackupCode } =
  vi.hoisted(() => ({
    sessionState: {
      data: null as {
        user: { id: string };
        session: { id: string };
      } | null,
      isPending: false,
    },
    getMe: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    verifyTotp: vi.fn(),
    verifyBackupCode: vi.fn(),
  }));

vi.mock("@/lib/better-auth-client", () => ({
  authClient: {
    useSession: () => sessionState,
  },
}));

vi.mock("@/lib/api/auth", () => ({
  getMe,
  login,
  register,
  logout,
  verifyTotp,
  verifyBackupCode,
  TwoFactorRequiredError: class TwoFactorRequiredError extends Error {
    constructor() {
      super("TWO_FACTOR_REQUIRED");
      this.name = "TwoFactorRequiredError";
    }
  },
}));

/**
 * Storefront AuthContext tests (Phase 3 central Better Auth cutover).
 *
 * The BA session is the source of truth: no session → no user (and no
 * localStorage token is ever consulted); a live session loads the tenant
 * profile from `GET /auth/me`. A TOTP challenge surfaces as
 * `twoFactorRequired` instead of an error; `auth:logout` clears the user.
 */

const customer = {
  id: "c1",
  firstName: "Aya",
  lastName: "Khan",
  username: "aya",
  email: "aya@shop.test",
  phoneNumber: "+8801700000000",
  status: "active",
  role: "customer",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

function Probe() {
  const { user, loading, twoFactorRequired, login, logout, verifyTwoFactor } =
    useAuth();
  return (
    <div>
      <div data-testid="loading">{loading ? "loading" : "ready"}</div>
      <div data-testid="user">{user ? user.email : "none"}</div>
      <div data-testid="twofa">{twoFactorRequired ? "required" : "off"}</div>
      <button onClick={() => void login("aya@shop.test", "Secret123!")}>
        sign-in
      </button>
      <button onClick={() => void logout()}>sign-out</button>
      <button onClick={() => void verifyTwoFactor("123456")}>verify</button>
    </div>
  );
}

describe("storefront AuthContext (Phase 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionState.data = null;
    sessionState.isPending = false;
    getMe.mockResolvedValue(customer);
    login.mockResolvedValue({ user: customer });
    register.mockResolvedValue({ user: customer });
    logout.mockResolvedValue(undefined);
    verifyTotp.mockResolvedValue({ user: customer });
    verifyBackupCode.mockResolvedValue({ user: customer });
    localStorage.removeItem("token");
  });

  it("has no user when there is no BA session, even with a stale token stored", async () => {
    localStorage.setItem("token", "stale-token");
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(getMe).not.toHaveBeenCalled();
  });

  it("loads the tenant profile when a BA session exists", async () => {
    sessionState.data = { user: { id: "u1" }, session: { id: "s1" } };
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("aya@shop.test"));
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it("clears the user when the session goes away", async () => {
    sessionState.data = { user: { id: "u1" }, session: { id: "s1" } };
    const { rerender } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("aya@shop.test"));
    act(() => {
      sessionState.data = null;
    });
    rerender(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
  });

  it("login sets the user; logout clears it", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
    screen.getByText("sign-in").click();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("aya@shop.test"));
    screen.getByText("sign-out").click();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("a TwoFactorRequiredError sets twoFactorRequired instead of throwing", async () => {
    const { TwoFactorRequiredError } = await import("@/lib/api/auth");
    login.mockRejectedValue(new TwoFactorRequiredError());
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
    screen.getByText("sign-in").click();
    await waitFor(() => expect(screen.getByTestId("twofa")).toHaveTextContent("required"));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    screen.getByText("verify").click();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("aya@shop.test"));
    await waitFor(() => expect(screen.getByTestId("twofa")).toHaveTextContent("off"));
  });

  it("an auth:logout event clears the user (401 path)", async () => {
    sessionState.data = { user: { id: "u1" }, session: { id: "s1" } };
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("aya@shop.test"));
    act(() => {
      window.dispatchEvent(new Event("auth:logout"));
    });
    expect(screen.getByTestId("user")).toHaveTextContent("none");
  });
});
