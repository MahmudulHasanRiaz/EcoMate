import { describe, it, expect, vi, beforeEach } from "vitest";

const { signInEmail, signUpEmail, verifyTotp, verifyBackupCode, signOut, apiGet, apiPut } =
  vi.hoisted(() => ({
    signInEmail: vi.fn(),
    signUpEmail: vi.fn(),
    verifyTotp: vi.fn(),
    verifyBackupCode: vi.fn(),
    signOut: vi.fn(() => Promise.resolve({ data: null, error: null })),
    apiGet: vi.fn(),
    apiPut: vi.fn(),
  }));

vi.mock("../../better-auth-client", () => ({
  authClient: {
    signIn: { email: signInEmail },
    signUp: { email: signUpEmail },
    twoFactor: { verifyTotp, verifyBackupCode },
    signOut,
  },
}));

vi.mock("../../api-client", () => ({
  default: { get: apiGet, put: apiPut },
}));

import {
  login,
  register,
  verifyTotp as verifyTotpFn,
  verifyBackupCode as verifyBackupCodeFn,
  logout,
  getMe,
  TwoFactorRequiredError,
} from "../../api/auth";

/**
 * Storefront auth API tests (Phase 3 central Better Auth cutover).
 *
 * Sign-in / sign-up go through the BA client; the tenant profile comes
 * from `GET /auth/me`; there is no access token and no refresh call.
 * A TOTP-enabled user gets a typed `TwoFactorRequiredError` so the
 * account page can show the challenge screen instead of an error.
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

describe("storefront lib/api/auth (Phase 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signInEmail.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    signUpEmail.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    verifyTotp.mockResolvedValue({ data: { token: "t" }, error: null });
    verifyBackupCode.mockResolvedValue({ data: { token: "t" }, error: null });
    apiGet.mockResolvedValue({ data: customer });
    apiPut.mockResolvedValue({ data: customer });
  });

  it("logs in via signIn.email and returns the tenant profile", async () => {
    const res = await login("aya@shop.test", "Secret123!");
    expect(signInEmail).toHaveBeenCalledWith({
      email: "aya@shop.test",
      password: "Secret123!",
    });
    expect(apiGet).toHaveBeenCalledWith("/auth/me");
    expect(res.user).toEqual(customer);
    // No access token anywhere in the response shape.
    expect(res).not.toHaveProperty("accessToken");
  });

  it("throws TwoFactorRequiredError on TWO_FACTOR_REQUIRED", async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 403, code: "TWO_FACTOR_REQUIRED" },
    });
    await expect(login("aya@shop.test", "Secret123!")).rejects.toBeInstanceOf(
      TwoFactorRequiredError,
    );
    expect(apiGet).not.toHaveBeenCalled();
  });

  it("throws a readable error on bad credentials", async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { status: 401, message: "Invalid email or password" },
    });
    await expect(login("aya@shop.test", "wrong")).rejects.toThrow(
      "Invalid email or password",
    );
  });

  it("verifies a TOTP code and returns the profile", async () => {
    const res = await verifyTotpFn("123456");
    expect(verifyTotp).toHaveBeenCalledWith({ code: "123456", trustDevice: true });
    expect(res.user).toEqual(customer);
  });

  it("verifies a recovery code and returns the profile", async () => {
    const res = await verifyBackupCodeFn("ABCDE-FGHIJ");
    expect(verifyBackupCode).toHaveBeenCalledWith({ code: "ABCDE-FGHIJ" });
    expect(res.user).toEqual(customer);
  });

  it("registers via signUp.email, then writes the tenant profile fields", async () => {
    const res = await register({
      firstName: "Aya",
      lastName: "Khan",
      username: "aya",
      email: "aya@shop.test",
      phoneNumber: "+8801700000000",
      password: "Secret123!",
    });
    expect(signUpEmail).toHaveBeenCalledWith({
      email: "aya@shop.test",
      password: "Secret123!",
      name: "Aya Khan",
    });
    expect(apiPut).toHaveBeenCalledWith("/auth/me", {
      firstName: "Aya",
      lastName: "Khan",
      phoneNumber: "+8801700000000",
    });
    expect(res.user).toEqual(customer);
  });

  it("logs out via the BA client", async () => {
    await logout();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("getMe unwraps a { user } envelope or a flat profile", async () => {
    apiGet.mockResolvedValueOnce({ data: { user: customer } });
    await expect(getMe()).resolves.toEqual(customer);
    apiGet.mockResolvedValueOnce({ data: customer });
    await expect(getMe()).resolves.toEqual(customer);
  });
});
