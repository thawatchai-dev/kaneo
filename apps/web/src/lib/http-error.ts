import { stripBasePath, withBasePath } from "@/lib/base-path";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 401;
}

// Shared unauthorized redirect for both the React Query error cache and direct
// fetcher calls (e.g. route loaders) that bypass the QueryCache. Stashes the
// current pathname/search/hash so the sign-in page can return the user to
// where they were instead of dropping them on /dashboard.
export function handleUnauthorized(): void {
  // window.location.pathname carries the base path (unlike TanStack
  // Router's own parsed location); strip it so `redirect` is always
  // app-relative, matching what the sign-in page hands to `navigate({ to })`.
  const currentPath = stripBasePath(
    window.location.pathname + window.location.search + window.location.hash,
  );
  const signInPath = withBasePath("auth/sign-in");
  const target = currentPath
    ? `${signInPath}?redirect=${encodeURIComponent(currentPath)}`
    : signInPath;
  window.location.replace(target);
}
