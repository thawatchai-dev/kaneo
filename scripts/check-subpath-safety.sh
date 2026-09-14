#!/usr/bin/env bash
# Guards against reintroducing the "hardcoded absolute path" bug class that
# breaks path-based subpath deployments (e.g. serving kaneo under /kaneo/
# behind a reverse proxy — see apps/web/src/lib/base-path.ts).
#
# TanStack Router's `basepath` option (apps/web/src/main.tsx) only applies
# when a URL is resolved *through the router* (navigate({ to }), <Link>,
# route loaders). It does NOT apply to raw `window.location.*` calls, which
# write straight to the browser's address bar — those need `withBasePath()`
# from apps/web/src/lib/base-path.ts applied by hand.
#
# `router.history.push/replace()` does NOT need this: main.tsx calls
# `patchHistoryForBasePath(router.history)` once at startup, which makes
# every push/replace call base-path-aware automatically (ours and any
# upstream adds it later) — a plain `history.push("/dashboard")` is the
# correct, expected form and this script does not flag it.
#
# Run this after every `git merge upstream/main` (or any manual edit) to
# apps/web/src, before rebuilding the custom/subpath image — upstream has
# no reason to know about the window.location constraint and will
# reintroduce that pattern over time as new features are added.
#
# Usage: ./scripts/check-subpath-safety.sh
# Exit code 0 = clean, 1 = suspicious pattern(s) found (printed to stdout).

set -euo pipefail

cd "$(dirname "$0")/.."

SRC_DIR="apps/web/src"
FAIL=0

check() {
  local description="$1"
  local pattern="$2"
  local matches
  matches=$(grep -rnE "$pattern" --include="*.ts" --include="*.tsx" "$SRC_DIR" \
    | grep -v '\.test\.' \
    | grep -v "$SRC_DIR/lib/base-path.ts" || true)
  if [ -n "$matches" ]; then
    echo "❌ $description"
    echo "$matches" | sed 's/^/   /'
    echo
    FAIL=1
  fi
}

check \
  "window.location.{href,assign,replace} assigned a literal absolute path (needs withBasePath()):" \
  'window\.location\.(href\s*=|assign\(|replace\()\s*[`"'"'"']?\$\{[^}]*\}?/?[a-zA-Z]|window\.location\.(assign|replace)\(\s*["'"'"'`]/[a-zA-Z]'

check \
  "raw import.meta.env.BASE_URL usage outside lib/base-path.ts (use withBasePath() instead):" \
  'import\.meta\.env\.BASE_URL'

if [ "$FAIL" -eq 0 ]; then
  echo "✅ No unsafe hardcoded-path patterns found."
fi

exit "$FAIL"
