import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { InternalAxiosRequestConfig } from "axios";

import apiClient from "../api-client";

/**
 * Storefront api-client tests (Phase 3 central Better Auth cutover).
 *
 * No Bearer token is ever attached (a stale `token` in localStorage is
 * ignored), there is no `/auth/refresh` replay, and a 401 dispatches
 * `auth:logout` so the AuthContext clears the user.
 *
 * The axios instance is driven through a stub adapter so no HTTP is made.
 */

let captured: InternalAxiosRequestConfig | null = null;
let next: "ok" | 401 | 500 = "ok";
let calls = 0;

function installAdapter() {
  calls = 0;
  captured = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (apiClient.defaults as any).adapter = async (
    config: InternalAxiosRequestConfig,
  ) => {
    calls += 1;
    captured = config;
    if (next === "ok") {
      return {
        data: { ok: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    }
    const error = new Error(
      `Request failed with status code ${next}`,
    ) as Error & {
      response: { status: number; data: unknown };
      config: InternalAxiosRequestConfig;
    };
    error.response = { status: next, data: { message: "boom" } };
    error.config = config;
    throw error;
  };
}

describe("storefront api-client (Phase 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installAdapter();
  });

  afterEach(() => {
    localStorage.removeItem("token");
  });

  it("attaches no Authorization header, even with a stale token stored", async () => {
    localStorage.setItem("token", "stale-token");
    await apiClient.get("/products");
    expect(captured).not.toBeNull();
    expect(captured!.headers["Authorization"]).toBeUndefined();
  });

  it("sends cookies with the request (BA session cookie)", async () => {
    await apiClient.get("/products");
    expect(apiClient.defaults.withCredentials).toBe(true);
  });

  it("on 401: dispatches auth:logout and rejects without replaying", async () => {
    next = 401;
    const handler = vi.fn();
    window.addEventListener("auth:logout", handler);
    try {
      await expect(apiClient.get("/products")).rejects.toThrow();
    } finally {
      window.removeEventListener("auth:logout", handler);
    }
    expect(handler).toHaveBeenCalledTimes(1);
    expect(calls).toBe(1);
  });

  it("on 500: propagates without dispatching auth:logout", async () => {
    next = 500;
    const handler = vi.fn();
    window.addEventListener("auth:logout", handler);
    try {
      await expect(apiClient.get("/products")).rejects.toThrow();
    } finally {
      window.removeEventListener("auth:logout", handler);
    }
    expect(handler).not.toHaveBeenCalled();
    expect(calls).toBe(1);
  });
});
