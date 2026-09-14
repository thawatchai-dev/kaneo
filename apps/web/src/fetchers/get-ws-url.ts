import { windowId } from "@kaneo/libs";
import { getApiUrl } from "@/fetchers/get-api-url";

/**
 * WebSocket URL builders.
 *
 * By default these derive from the API base URL (VITE_API_URL), same as
 * every other endpoint: `.../api/ws/user` and `.../api/ws/:projectId`.
 *
 * Override with VITE_WS_URL (KANEO_WS_URL at runtime) when WebSocket
 * upgrade traffic has to reach the server through a single, exact,
 * pre-approved URL shared with another app — e.g. a reverse proxy/CDN in
 * front that only forwards the `Upgrade` header for one specific path
 * (and matches it exactly, not as a prefix, so a subpath like `/ws/kaneo`
 * still gets rejected upstream of the app). In that mode the override is
 * used verbatim, with no path appended, and the connection is
 * disambiguated with a `kaneo=user|project` query parameter instead —
 * that kind of restriction matches on the URI path only, so the query
 * string is free to carry routing info the shared path can't.
 */
function wsOverrideBase() {
  const override = import.meta.env.VITE_WS_URL;
  if (!override) return null;
  return override.replace(/\/+$/, "").replace(/^http/, "ws");
}

export function getUserWsUrl() {
  const override = wsOverrideBase();
  if (override) {
    return `${override}?kaneo=user&windowId=${encodeURIComponent(windowId)}`;
  }
  const base = getApiUrl("ws").replace(/^http/, "ws");
  return `${base}/user?windowId=${encodeURIComponent(windowId)}`;
}

export function getWsUrl(projectId: string) {
  const override = wsOverrideBase();
  if (override) {
    return `${override}?kaneo=project&projectId=${encodeURIComponent(projectId)}&windowId=${encodeURIComponent(windowId)}`;
  }
  const base = getApiUrl("ws").replace(/^http/, "ws");
  return `${base}/${encodeURIComponent(projectId)}?windowId=${encodeURIComponent(windowId)}`;
}
