import { describe, expect, it } from "vitest";

import { resolveSafeLoginRedirect } from "../lib/safeRedirect";

describe("safe login redirects", () => {
  it.each(["/account", "/delete-account"])("allows %s", (path) => {
    expect(resolveSafeLoginRedirect(path)).toBe(path);
  });

  it.each([
    null,
    "",
    "/admin",
    "/delete-account/extra",
    "https://example.com/delete-account",
    "//example.com/delete-account",
    "javascript:alert(1)",
    "%2F%2Fevil.example",
    "https%3A%2F%2Fevil.example"
  ])("falls back for unsafe redirect %s", (path) => {
    expect(resolveSafeLoginRedirect(path)).toBe("/account");
  });
});
