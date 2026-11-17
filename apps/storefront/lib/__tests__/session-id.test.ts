import { describe, expect, it, vi, afterEach } from "vitest";
import { newSessionId } from "../session-id";

describe("newSessionId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when available", () => {
    const id = newSessionId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("falls back to a pv- id when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {});
    const id = newSessionId();
    expect(id.startsWith("pv-")).toBe(true);
    expect(id.length).toBeGreaterThan(10);
  });

  it("falls back when crypto itself is undefined (non-secure context)", () => {
    vi.stubGlobal("crypto", undefined);
    const a = newSessionId();
    const b = newSessionId();
    expect(a.startsWith("pv-")).toBe(true);
    expect(a).not.toBe(b);
  });
});
