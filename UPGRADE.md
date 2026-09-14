# Upgrade runbook — `custom/subpath` fork

Step-by-step checklist for pulling in a new upstream kaneo release.
For *why* each step exists (the patches, the better-auth gotcha, the
nginx config this depends on), see [SUBPATH.md](./SUBPATH.md) — this
file is just the "do this" version.

Budget ~15 minutes if nothing conflicts, more if `apps/web/src/main.tsx`
or `apps/web/src/lib/auth-client.ts` do.

## 0. Before you start

- [ ] Know the target version tag (e.g. `v2.25.0`) — check
      https://github.com/usekaneo/kaneo/releases
- [ ] Confirm you can push to `ghcr.io/thawatchai-dev/kaneo`
      (`docker login ghcr.io`)
- [ ] Confirm SSH access to the server running `docker-compose.yml`
- [ ] Note the currently-running image tag as your rollback target:
      ```bash
      # on the server
      docker compose images kaneo
      ```

## 1. Merge upstream

```bash
git fetch upstream --tags
git checkout custom/subpath
git merge vX.Y.Z
```

**If it merges clean**: skip to step 2.

**If it conflicts**, it'll be in one of these (the only files this fork
touches — full list with reasons in SUBPATH.md):
```
apps/web/vite.config.ts
apps/web/src/main.tsx
apps/web/src/lib/auth-client.ts
apps/web/src/lib/http-error.ts
apps/web/src/lib/invitation-link.ts
apps/web/src/components/common/logo.tsx
apps/web/src/components/nav-projects.tsx
apps/web/src/components/task/task-properties-sidebar.tsx
apps/web/src/hooks/mutations/use-sign-out.ts
apps/web/src/routes/_layout/_authenticated/dashboard/settings/projects/$projectId/visibility.tsx
apps/web/index.html
apps/web/public/site.webmanifest
```
Resolve in favor of **keeping this fork's line intact**, merged
around whatever upstream changed nearby — these are all single-line
or few-line changes, so read the conflict marker context rather than
blindly taking "ours" or "theirs" wholesale.

## 2. Run the safety checks

```bash
./scripts/check-subpath-safety.sh
```
Must print `✅ No unsafe hardcoded-path patterns found.` If it flags
something, upstream added a new `window.location.href/assign/replace`
call with a hardcoded path — fix it the same way the flagged line's
neighbors were fixed (wrap in `withBasePath(...)` from
`apps/web/src/lib/base-path.ts`).

**If `better-auth` version changed** (check `git diff` on
`pnpm-lock.yaml`, `apps/api/package.json`, `apps/web/package.json` for
that package):
- [ ] Fetch `packages/better-auth/src/utils/url.ts` from the new
      version's tag on GitHub, re-read `withPath()`
- [ ] Confirm it still only appends `basePath` when `baseURL` has no
      path — if that logic changed, `apps/web/src/lib/auth-client.ts`'s
      `getBaseURL()` needs revisiting (see SUBPATH.md's better-auth
      section for the full explanation)

## 3. Build and push

```bash
docker buildx build -f Dockerfile.kaneo --platform linux/amd64 \
  -t ghcr.io/thawatchai-dev/kaneo:X.Y.Z-subpath \
  --push .
```
Use the **new upstream version number** in the tag, not an incrementing
suffix (`-subpath-7` etc.) — makes "what upstream version is this"
readable at a glance later, and makes step 0's rollback tag
unambiguous.

## 4. Deploy

On the server:
```bash
cd /root/hst/kaneo   # or wherever docker-compose.yml lives
vi docker-compose.yml   # bump the image tag to X.Y.Z-subpath
docker compose pull
docker compose up -d
docker compose images kaneo   # confirm the tag actually changed
```

## 5. Regression test

Don't skip this — a stale or half-updated image has been the actual
cause of every confusing bug hit while building this fork so far.

- [ ] `https://yourdomain.com/kaneo` loads, no blank page
- [ ] DevTools Network: assets 200 from `/kaneo/assets/...`, no
      `text/html` MIME-type errors
- [ ] Refresh a deep route (`/kaneo/dashboard/...`) — no 404
- [ ] Sign in (email/password, OTP, guest — whichever are enabled) —
      lands on dashboard, does **not** bounce back to sign-in
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' https://yourdomain.com/kaneo/api/auth/get-session`
      → `200`, not `404`
- [ ] Copy a project link and a task link — both include `/kaneo`
- [ ] Send/open a workspace invitation link — includes `/kaneo`
- [ ] Two browser tabs on the same board, drag a card in one — the
      other updates live (WebSocket over the proxy survived)
- [ ] Upload a file attachment on a task
- [ ] Sign out — lands back on `/kaneo/auth/sign-in`, not root

If anything here fails, don't debug forward — roll back first (step 6),
then investigate calmly against the previous known-good image.

## 6. Rollback

If step 5 turns up something broken and it's not a quick fix:
```bash
# server
vi docker-compose.yml   # put back the tag noted in step 0
docker compose pull
docker compose up -d
```
Then fix forward on `custom/subpath` locally and redo from step 2 once
ready — don't debug against production.

To undo the git merge itself (if you haven't pushed the branch yet):
```bash
git merge --abort            # mid-conflict, merge not finished
# or, if it already completed:
git reset --hard HEAD@{1}    # back to pre-merge commit
```
