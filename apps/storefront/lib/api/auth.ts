import apiClient from "../api-client";
import { authClient } from "../better-auth-client";
import {
  baErrorMessage,
  isTwoFactorRequiredError,
} from "../ba-auth-errors";
import type { User } from "../types";

/**
 * Customer auth — Phase 3 central Better Auth cutover.
 *
 * Sign-in / sign-up go through the BA client (same-origin
 * `/api/better-auth/*` proxy → central service); the BA session cookie
 * is the credential, so there is no access token anymore. The tenant
 * profile (name, phone, role) is read from the backend `GET /auth/me`
 * — the central session user carries no tenant role/permissions.
 *
 * Register note: the central service accepts only `email` / `password` /
 * `name` on sign-up (no `firstName` / `lastName` / `username` /
 * `phoneNumber` additional fields), so the tenant profile fields are
 * written right after sign-up with `PUT /auth/me` (which accepts
 * firstName/lastName/email/phoneNumber). `username` has no home on that
 * endpoint — the backend auto-creates it from the email local-part — so
 * a typed username is not preserved (backend-owned gap, flagged in the
 * Phase 3 frontend report).
 *
 * `login` throws an `Error` with `name === 'TwoFactorRequired'` (and
 * message 'TWO_FACTOR_REQUIRED') when the service answers FORBIDDEN
 * { code: "TWO_FACTOR_REQUIRED" } — the account page shows the challenge
 * screen instead of an error in that case.
 */

export interface AuthResponse {
  user: User;
}

export class TwoFactorRequiredError extends Error {
  constructor() {
    super("TWO_FACTOR_REQUIRED");
    this.name = "TwoFactorRequiredError";
  }
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const { error } = await authClient.signIn.email({ email, password });
  if (error) {
    if (isTwoFactorRequiredError(error)) throw new TwoFactorRequiredError();
    throw new Error(baErrorMessage(error, "Invalid email or password"));
  }
  return { user: await getMe() };
}

export async function verifyTotp(code: string): Promise<AuthResponse> {
  const { error } = await authClient.twoFactor.verifyTotp({
    code,
    trustDevice: true,
  });
  if (error) {
    throw new Error(baErrorMessage(error, "Invalid code. Please try again."));
  }
  return { user: await getMe() };
}

export async function verifyBackupCode(code: string): Promise<AuthResponse> {
  const { error } = await authClient.twoFactor.verifyBackupCode({ code });
  if (error) {
    throw new Error(
      baErrorMessage(error, "Invalid recovery code. Please try again."),
    );
  }
  return { user: await getMe() };
}

export async function register(data: {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phoneNumber: string;
  password: string;
}): Promise<AuthResponse> {
  const { error } = await authClient.signUp.email({
    email: data.email,
    password: data.password,
    name: `${data.firstName} ${data.lastName}`.trim(),
  });
  if (error) {
    throw new Error(baErrorMessage(error, "Could not create your account"));
  }
  // Tenant profile fields live on the backend UserProfile, not the
  // central user — write them now (best-effort: sign-up already
  // succeeded, so a failure here must not look like a failed signup).
  try {
    await updateProfile({
      firstName: data.firstName,
      lastName: data.lastName,
      phoneNumber: data.phoneNumber,
    });
  } catch {
    // The profile write is retried from the account page — the user is
    // signed in either way.
  }
  return { user: await getMe() };
}

export async function getMe(): Promise<User> {
  const { data } = await apiClient.get("/auth/me");
  return (data?.user || data) as User;
}

export async function logout(): Promise<void> {
  await authClient.signOut().catch(() => {});
}

export async function updateProfile(data: {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
}): Promise<User> {
  const { data: res } = await apiClient.put("/auth/me", data);
  return (res?.user || res) as User;
}
