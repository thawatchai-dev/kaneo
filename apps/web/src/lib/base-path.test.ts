import { describe, expect, it } from "vitest";
import { BASE_PATH, stripBasePath, withBasePath } from "./base-path";

// The vitest environment doesn't apply vite.config.ts's `base: "/kaneo/"`
// build setting, so BASE_PATH is "/" here — these tests work generically
// off whatever BASE_PATH actually is rather than hardcoding "/kaneo/".
describe("withBasePath", () => {
  it("prefixes an app-relative path", () => {
    expect(withBasePath("dashboard")).toBe(`${BASE_PATH}dashboard`);
    expect(withBasePath("/dashboard")).toBe(`${BASE_PATH}dashboard`);
  });

  it("is a no-op on a path that already carries the base path", () => {
    const already = `${BASE_PATH}dashboard`;
    expect(withBasePath(already)).toBe(already);
  });
});

describe("stripBasePath", () => {
  it("removes the base path, leaving a leading slash", () => {
    expect(stripBasePath(`${BASE_PATH}auth/sign-in?redirect=x`)).toBe(
      "/auth/sign-in?redirect=x",
    );
  });

  it("is a no-op on a path that doesn't carry the base path", () => {
    // Guaranteed not to be base-path-prefixed regardless of what
    // BASE_PATH is configured as.
    const unprefixed = "/unprefixed-marker/auth/sign-in";
    expect(stripBasePath(unprefixed)).toBe(unprefixed);
  });

  it("round-trips with withBasePath, so navigate({ to }) never double-prefixes", () => {
    const appRelative = "/dashboard";
    expect(stripBasePath(withBasePath(appRelative))).toBe(appRelative);
    // Idempotent: stripping an already-unprefixed path is a no-op too.
    expect(stripBasePath(stripBasePath(withBasePath(appRelative)))).toBe(
      appRelative,
    );
  });
});
