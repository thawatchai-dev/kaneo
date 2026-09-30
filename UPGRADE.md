# Upgrade runbook — `custom/subpath` fork

Step-by-step checklist for pulling in a new upstream kaneo release.
For *why* each step exists (the patches, the better-auth gotcha, the
nginx config this depends on), see [SUBPATH.md](./SUBPATH.md) — this
file is just the "do this" version.

Budget ~15 minutes if nothing conflicts. The v2.24 → v2.29 jump (218 commits)
had 7 conflicting files and 2 silent breakages; smaller jumps are
cheaper, so upgrade often.

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
- [ ] **`pg_dump` the production database.** Migrations run automatically
      on startup and some delete or rewrite data; rolling the image back
      does not undo them.
- [ ] Read the upstream migrations between your version and the target
      (`git diff <old-tag> <new-tag> --stat -- apps/api/drizzle`) and check
      the data they touch. Last upgrade (v2.24 → v2.29) needed:
      - `0047` deletes API keys with no owner — list them first:
        ```sql
        SELECT id FROM apikey a WHERE reference_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = a.user_id);
        ```
      - `0054` promotes the first non-guest user to `admin` if the
        instance has no admin — confirm who that would be.
- [ ] Use **Node 24.11+** locally (`nvm use 24`); upstream's `engines`
      rejects older versions and `pnpm install` needs the matching toolchain.

## 1. Merge upstream

```bash
git fetch upstream --tags
git checkout custom/subpath
git merge vX.Y.Z
```

**If it merges clean**: skip to step 2.

**If it conflicts**, expect it in the files this fork touches (full list
with reasons in SUBPATH.md). Preview before merging, without touching the
working tree:
```bash
git merge-tree --write-tree --name-only HEAD vX.Y.Z | grep CONFLICT
```
Files that conflicted in the v2.24 → v2.29 merge, and how each was resolved:

| File | Resolution |
|---|---|
| `apps/web/env.sh`, `apps/web/env.awk` | Take upstream's; **keep `KANEO_WS_URL` in `env.awk`** (in both the `values[...]` list and the placeholder regex). Upstream only knows 3 variables; without it the WS override silently stops working. |
| `apps/web/src/env.test.ts` | Take upstream's; keep the `KANEO_WS_URL` test. |
| `apps/web/vite.config.ts` | Keep `base: "/kaneo/"`, take upstream's plugin wiring. |
| `apps/web/public/site.webmanifest` | Keep relative icon paths (no leading `/`). |
| `apps/web/src/hooks/use-{project,user}-websocket.ts` | Take upstream's hook body; keep importing `getWsUrl` / `getUserWsUrl` from `@/fetchers/get-ws-url`. |
| `apps/api/src/storage/s3.ts`, `tests/api/storage/s3.test.ts` | Keep both sides (see the S3 check below). |

Other fork-touched files that usually merge cleanly but are worth a look:
```
apps/web/src/main.tsx
apps/web/src/lib/auth-client.ts
apps/web/src/lib/http-error.ts
apps/web/src/lib/invitation-link.ts
apps/web/src/components/common/logo.tsx
apps/web/src/components/nav-projects.tsx
apps/web/src/components/task/task-properties-sidebar.tsx
apps/web/src/hooks/mutations/use-sign-out.ts
apps/web/src/routes/auth/sign-in.tsx
apps/web/src/routes/auth/verify-otp.tsx
apps/web/src/routes/_layout/_authenticated/dashboard/settings/projects/$projectId/visibility.tsx
apps/web/index.html
```
Resolve in favor of **keeping this fork's line intact**, merged around
whatever upstream changed nearby — read the conflict context rather than
blindly taking "ours" or "theirs" wholesale.

**A clean merge is not proof it is correct.** Two upstream additions in the
last upgrade merged without conflict and were still broken for this fork:
- A new upload flow signed a URL with the internal `S3_ENDPOINT` and
  returned it as-is, bypassing `toPublicUploadUrl()`. After every merge:
  ```bash
  grep -n "getSignedUrl" apps/api/src/storage/s3.ts
  ```
  and make sure each result is passed through `toPublicUploadUrl()`.
- A new page built a link with `new URL("/auth/...", window.location.origin)`,
  dropping `/kaneo`. Step 2's script now flags this pattern.

## 2. Run the safety checks

```bash
./scripts/check-subpath-safety.sh
```
Must print `✅ No unsafe hardcoded-path patterns found.` If it flags
something, upstream added a new `window.location.href/assign/replace`
call with a hardcoded path — fix it the same way the flagged line's
neighbors were fixed (wrap in `withBasePath(...)` from
`apps/web/src/lib/base-path.ts`).

Then run the checks that cover the fork's patches (Node 24):
```bash
pnpm install --frozen-lockfile
(cd apps/web && pnpm exec tsc --noEmit -p tsconfig.app.json)
(cd apps/web && pnpm exec vp test run --config vitest.config.ts)
(cd apps/api && pnpm exec vp test run --config vitest.config.ts)
node --test scripts/security/web-runtime-env.test.mjs   # needs Docker + nginx image
pnpm exec vp check                                       # format + lint; the commit hook runs it
```
`web-runtime-env` runs `env.sh` / `env.awk` under BusyBox awk in the real
nginx image; it does not cover `KANEO_WS_URL`, so also confirm by hand:
```bash
docker run --rm -i -e KANEO_WS_URL=wss://app.example.test/ws \
  -v "$PWD/apps/web/env.awk:/env.awk:ro" nginx:1.29.5-alpine \
  sh -c 'LC_ALL=C awk -f /env.awk' <<< 'a="KANEO_WS_URL"'
# → a="wss://app.example.test/ws"   (and a="" when the variable is unset)
```
If a fork test fails on a type or import error, upstream usually changed a
signature or tooling (e.g. `vitest` → `vite-plus/test`, TanStack history
types) — adapt the fork's patch, not upstream's code.

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
- [ ] Upload a project background image (separate upload path from
      attachments)
- [ ] Request a password reset — the emailed link includes `/kaneo`
- [ ] Any API key / MCP client still authenticates
- [ ] Sign out — lands back on `/kaneo/auth/sign-in`, not root

If anything here fails, don't debug forward — roll back first (step 6),
then investigate calmly against the previous known-good image.

## 6. Rollback

Rolling the image back does **not** undo database migrations. If the new
version's migrations already ran and the old image can't cope with the
schema, restore the `pg_dump` from step 0 as well.

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
