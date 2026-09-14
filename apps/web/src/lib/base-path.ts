/**
 * The app's deployment base path (e.g. "/kaneo/" for a path-based reverse
 * proxy deployment, "/" otherwise). Set at build time via Vite's `base`
 * config in vite.config.ts, and always ends in "/".
 */
export const BASE_PATH = import.meta.env.BASE_URL;

/**
 * Prefixes an app-relative path with the deployment base path.
 *
 * TanStack Router's `basepath` option (see main.tsx) only applies when a
 * URL is resolved through the router itself — `navigate({ to })`, `<Link>`,
 * route loaders. It does NOT apply to raw `window.location.*` calls, which
 * write straight to the browser's address bar. Any such call built from a
 * literal path (not one already read back from `window.location`) needs
 * this applied by hand, or it will 404 under a subpath deployment.
 *
 * (`router.history.push/replace()` does NOT need this — see
 * `patchHistoryForBasePath` in this file, wired up once in main.tsx.)
 *
 * Idempotent: calling it on a path that already carries the base path
 * (e.g. one read back from `window.location.pathname`) returns it
 * unchanged, so it's always safe to apply even when unsure whether the
 * value is already prefixed.
 *
 * @param path - app-relative path, with or without a leading slash
 *   (e.g. "dashboard", "/dashboard", "auth/sign-in?redirect=...")
 */
export function withBasePath(path: string): string {
  if (path.startsWith(BASE_PATH)) return path;
  return `${BASE_PATH}${path.replace(/^\/+/, "")}`;
}

/**
 * The inverse of `withBasePath`: strips the deployment base path from a
 * path that might already carry it (e.g. one built from
 * `window.location.pathname`).
 *
 * Needed before handing such a path to `navigate({ to })` (or stashing it
 * in a `redirect` search param destined for one) — unlike
 * `history.push`/`.replace` (patched below to apply `withBasePath`
 * idempotently), TanStack Router's own `navigate({ to })` always treats
 * `to` as app-relative and unconditionally prepends `basepath`, so an
 * already-prefixed value gets prefixed twice (e.g.
 * "/kaneo/kaneo/auth/sign-in").
 *
 * Idempotent in the other direction: a no-op on a path that doesn't carry
 * the base path.
 */
export function stripBasePath(path: string): string {
  if (!path.startsWith(BASE_PATH)) return path;
  return `/${path.slice(BASE_PATH.length)}`;
}

/**
 * Makes `router.history.push`/`.replace` base-path-aware, so every future
 * call site (including ones added later, ours or upstream's) is fixed for
 * free without importing `withBasePath` at all.
 *
 * Safe to do because TanStack Router's own internal navigation
 * (`navigate({ to })`, `<Link>`) is the *other* caller of these same two
 * methods, and always passes an href that already has `basepath` applied
 * — `withBasePath`'s idempotency means those calls pass through unchanged
 * here, so this cannot double-prefix them.
 *
 * Call this exactly once, immediately after `createRouter(...)` in
 * main.tsx — patching an already-patched history is harmless but pointless.
 */
export function patchHistoryForBasePath(history: {
  push: (path: string, ...rest: unknown[]) => void;
  replace: (path: string, ...rest: unknown[]) => void;
}): void {
  const originalPush = history.push.bind(history);
  const originalReplace = history.replace.bind(history);
  history.push = (path, ...rest) => originalPush(withBasePath(path), ...rest);
  history.replace = (path, ...rest) =>
    originalReplace(withBasePath(path), ...rest);
}
