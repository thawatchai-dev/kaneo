# `/kaneo` subpath deployment — fork notes

This fork (`custom/subpath` branch, on top of `usekaneo/kaneo`) patches
kaneo to run behind a reverse proxy at a **path prefix** (e.g.
`https://yourdomain.com/kaneo/...`) instead of its own subdomain or
domain root. Upstream kaneo doesn't support this out of the box — see
below for what had to change and why.

**If you didn't set this up yourself**: read this file before touching
`vite.config.ts`, `main.tsx`, `auth.ts`, or `auth-client.ts` — the
"obvious" fix for a bug you hit here has very likely already been tried
and reverted once (see the better-auth section below in particular).

This is deliberately a single squashed commit on top of the upstream
tag it's based on (`git log` shows one commit, `git diff <upstream-tag>`
shows the whole patch) — there's no per-change commit history to dig
through, this file is the record instead.

## Required deployment config

```
KANEO_CLIENT_URL=https://yourdomain.com/kaneo
```
(`KANEO_API_URL` is left unset — the entrypoint derives it as
`${KANEO_CLIENT_URL}/api`.)

Outer nginx (in front of the container, not part of this repo):
```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

location /kaneo {
    rewrite ^/kaneo/?(.*)$ /$1 break;
    proxy_pass http://CONTAINER_HOST:PORT;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 100M;
}
```
The container itself is never told about `/kaneo` — nginx strips the
prefix before forwarding, so the container always behaves as if it's
mounted at `/`. Every patch below exists to make the *browser-facing*
side (URLs baked into HTML/JS, and better-auth's own request handling)
agree with that split.

## What's patched, and why

- **`apps/web/vite.config.ts`**: `base: "/kaneo/"`.
  **`apps/web/src/main.tsx`**: `basepath: "/kaneo"` on `createRouter`.
  The two build-time settings that make the SPA's own asset URLs and
  client-side routing agree with the `/kaneo` prefix.

- **`apps/web/index.html`, `public/site.webmanifest`,
  `src/components/common/logo.tsx`**: `public/` assets referenced by a
  literal absolute path (favicon, manifest, logo `<img>`), which Vite's
  `base` config never rewrites — it only affects bundled asset
  references, not literal strings in source or `public/` files.

- **`apps/web/src/lib/base-path.ts`** (new file): the shared fix for
  everywhere a URL is built by hand instead of resolved through the
  router.
  - `withBasePath(path)` — for `window.location.*` calls and any URL
    string you're constructing (share links, redirects) rather than
    navigating with. Used in `lib/http-error.ts`,
    `hooks/mutations/use-sign-out.ts`, `lib/invitation-link.ts`,
    `components/nav-projects.tsx`,
    `components/task/task-properties-sidebar.tsx`, and
    `routes/.../visibility.tsx`.
  - `patchHistoryForBasePath(router.history)` — called once in
    `main.tsx` right after `createRouter()`. Wraps `history.push`/
    `.replace` so **every** call site (ours or a future upstream
    addition) is fixed automatically, no per-callsite import needed.
    Safe because TanStack Router's own `navigate({ to })`/`<Link>`
    machinery calls these same two methods with basepath already
    applied, and `withBasePath()` is idempotent — it no-ops on a path
    that's already prefixed.

- **`scripts/check-subpath-safety.sh`** (new file): grep guard for the
  one class `patchHistoryForBasePath` can't auto-fix — raw
  `window.location.href/assign/replace` calls. Run it after every
  future upstream merge, before rebuilding.

- **`apps/web/src/lib/auth-client.ts`**: the trickiest patch, with a
  genuine gotcha in a third-party library. **Read this if you're
  debugging an auth redirect loop or 404s under `/api/auth/*`.**

  better-auth (`packages/better-auth/src/utils/url.ts`, `withPath()`)
  combines `baseURL` + `basePath` by appending `basePath` **only when
  `baseURL` has no path of its own**. Give `baseURL` any path at all —
  including a `/kaneo` prefix — and `basePath` is silently dropped
  entirely. This applies on both the server context and the client
  SDK (they share the same `getBaseURL` util), for opposite reasons:

  - **Server** (`apps/api/src/auth.ts`) — **intentionally left
    untouched, identical to upstream.** Its `baseURL` must stay
    origin-only (no `/kaneo`) because better-auth uses `baseURL` +
    `basePath` to decide what prefix to strip off every *incoming*
    request's pathname — and this Node process never sees `/kaneo`
    (nginx strips it before forwarding). Giving this `baseURL` a
    `/kaneo` path was tried once; it made every route under
    `/api/auth/*` 404, which cascaded into permanent session-check
    failures and an infinite sign-in redirect loop. **Do not add a
    `/kaneo`-aware `baseURL` computation to this file** — if you're
    tempted to "fix" it because OAuth callback URLs are wrong (see
    trade-off below), this is why it looks unfixed.
  - **Client** (`apps/web/src/lib/auth-client.ts`) — the opposite
    fix: `baseURL` here has `/api/auth` baked directly into
    `getBaseURL()`'s return value instead of relying on the separate
    `basePath` option (which is a no-op here too), because the
    browser needs the complete public path
    (`https://host/kaneo/api/auth`) to reach the outer nginx
    correctly.

  **Known trade-off**: because the server `baseURL` is origin-only,
  any absolute URL better-auth generates itself (OAuth
  `redirect_uri`, magic-link verification links) will be missing
  `/kaneo` and 404 the same way. Not an issue today — no social/OAuth
  providers are configured on this instance (check the "missing
  clientId or clientSecret" warnings at boot to confirm this is still
  true). If you enable one, you'll hit this; the real fix is more
  invasive (stop stripping `/kaneo` for `/api/*` at the outer nginx
  and adjust the container's own routing to match), not another
  `baseURL` tweak on the server side.

  The same trade-off is why `hooks/mutations/use-sign-out.ts`'s
  external-IdP logout redirect is the *only* `withBasePath()` call
  site that's still exercising unused code today — it only runs when
  `idpLogoutUrl` is set, i.e. an OIDC provider is configured. Kept
  patched anyway since it's a 2-line diff, unlike the OAuth callback
  case above which would need the nginx-level fix.

## When the reverse proxy/CDN only allows WebSocket upgrade on one exact path

Some deployments sit behind a CDN or edge proxy (in front of the nginx
above) whose WebSocket support was only ever configured — as an
allow-list — for one specific path already in use by another app on the
same domain, e.g. `/ws`. Critically this is often an **exact** match on
that literal path, not a prefix: `/ws/kaneo` gets the `Upgrade` header
stripped and arrives at this container's nginx downgraded to a plain
HTTP/1.0 request, same as `/kaneo/api/ws/user` would — no matter how
`location /kaneo` (or a new `location /ws/kaneo`) is configured, since
the stripping happens upstream of this nginx entirely. Diagnose this
class of problem by curling the WS route directly on the box running
this nginx (bypassing the CDN) with a manual Upgrade handshake — a
protocol-aware response (`101`, or a `401`/`422` from the app itself)
confirms this nginx and the container are fine and the CDN is the one
stripping the header; compare against curling the *public* URL for both
the already-working path and a candidate new one to see which gets
identical treatment.

The URI path is what such a CDN rule matches on — the query string is
not part of it. So reuse the exact, already-approved path verbatim (no
extra path segments) and disambiguate the connection with a query
parameter instead. Set `KANEO_WS_URL` to that bare path:

```
KANEO_WS_URL=wss://yourdomain.com/ws
```

`getUserWsUrl()`/`getWsUrl()` in `apps/web/src/fetchers/get-ws-url.ts`
detect the override and switch from the default `<base>/user` /
`<base>/<projectId>` path suffixes to `<override>?kaneo=user&...` /
`<override>?kaneo=project&projectId=...&...` — same path, disambiguated
by query. Route those query values to the right backend in the
*existing* `/ws` location, without touching its default (unmatched)
case so the other app's plain `/ws` traffic is untouched:

```nginx
location /ws {
    set $ws_upstream 127.0.0.1:8081;   # existing app, unchanged default
    set $ws_rewrite  "";

    if ($arg_kaneo = "user") {
        set $ws_upstream 127.0.0.1:CONTAINER_PORT;
        set $ws_rewrite  "/api/ws/user";
    }
    if ($arg_kaneo = "project") {
        set $ws_upstream 127.0.0.1:CONTAINER_PORT;
        set $ws_rewrite  "/api/ws/$arg_projectId";
    }
    if ($ws_rewrite) {
        rewrite ^ $ws_rewrite break;
    }

    proxy_pass http://$ws_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

(`rewrite` without an explicit `?` in the replacement auto-appends the
original query string, so the backend still sees `windowId` etc.
alongside `kaneo=`/`projectId=`.) `if` here only ever wraps `set` —
never `proxy_pass` — which is the safe, well-documented use of `if` in
an nginx location.

`KANEO_WS_URL` only affects `apps/web/src/fetchers/get-ws-url.ts`
(`getUserWsUrl()`/`getWsUrl()`) — every other request still goes through
`KANEO_CLIENT_URL`/`KANEO_API_URL` as normal. Leave it unset for the
common case (WebSocket traffic reachable on the same `/kaneo` prefix as
everything else); `apps/web/env.sh` strips the unset placeholder so a
deployment that doesn't set it is unaffected.

## Upgrading to a new upstream kaneo version

See **[UPGRADE.md](./UPGRADE.md)** for the step-by-step runbook (merge,
conflict files, safety-script, build, deploy, regression checklist,
rollback). This file only covers the *why*; keep that reasoning here
and the *how* there so the two don't drift out of sync.
