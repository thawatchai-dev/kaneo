import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kaneo/libs", () => ({
  windowId: "test-window-id",
}));

import { getUserWsUrl } from "./use-user-websocket";

describe("getUserWsUrl", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds a ws:// URL from an http API base", () => {
    expect(getUserWsUrl()).toBe(
      "ws://localhost:1337/api/ws/user?windowId=test-window-id",
    );
  });

  it("builds a wss:// URL from an https API base", () => {
    vi.stubEnv("VITE_API_URL", "https://example.com");
    expect(getUserWsUrl()).toBe(
      "wss://example.com/api/ws/user?windowId=test-window-id",
    );
  });

  it("uses VITE_WS_URL verbatim with a query-based marker when set", () => {
    vi.stubEnv("VITE_WS_URL", "https://hstd.example.com/ws");
    expect(getUserWsUrl()).toBe(
      "wss://hstd.example.com/ws?kaneo=user&windowId=test-window-id",
    );
  });

  it("trims trailing slashes from a VITE_WS_URL override", () => {
    vi.stubEnv("VITE_WS_URL", "https://hstd.example.com/ws///");
    expect(getUserWsUrl()).toBe(
      "wss://hstd.example.com/ws?kaneo=user&windowId=test-window-id",
    );
  });
});
