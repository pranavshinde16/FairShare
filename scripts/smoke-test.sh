#!/usr/bin/env sh
# Checks that a running FairShare deployment works: the API and its database, sign-in wiring, the
# web app, the SPA fallback, and the security headers. Used by CI against the Docker image and after
# each deploy. It never signs in or sends email.
#
#   scripts/smoke-test.sh http://localhost:3000
#   scripts/smoke-test.sh https://staging.example.com
#
# Waits up to SMOKE_WAIT_SECONDS (default 60) for /api/health to answer 200, since a fresh
# deployment can take a moment to come up.
set -eu

BASE_URL="${1:?usage: scripts/smoke-test.sh <base-url>}"
BASE_URL="${BASE_URL%/}"
WAIT="${SMOKE_WAIT_SECONDS:-60}"
failures=0

pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# check <description> <expected> <actual>
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected '$2', got '$3')"; fi; }
# contains <description> <needle> <haystack>
contains() { case "$3" in *"$2"*) pass "$1" ;; *) fail "$1 (missing '$2')" ;; esac; }

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
page() { curl -s -H 'Accept: text/html' "$@"; }

printf 'Smoke test: %s\n' "$BASE_URL"

waited=0
until [ "$(status "$BASE_URL/api/health")" = 200 ]; do
  if [ "$waited" -ge "$WAIT" ]; then break; fi
  sleep 2
  waited=$((waited + 2))
done

health=$(curl -s "$BASE_URL/api/health")
check 'GET /api/health answers 200' 200 "$(status "$BASE_URL/api/health")"
check 'the database is up' '{"ok":true,"db":"up"}' "$health"

headers=$(curl -s -D - -o /dev/null "$BASE_URL/api/health" | tr -d '\r' | tr 'A-Z' 'a-z')
contains 'responses carry a request id' 'x-request-id:' "$headers"
contains 'responses carry the content security policy' "content-security-policy: default-src 'self'" "$headers"
contains 'responses carry HSTS' 'strict-transport-security: max-age=' "$headers"

contains 'GET / serves the web app' '<title>FairShare</title>' "$(page "$BASE_URL/")"
contains 'an app route falls back to the web app' '<title>FairShare</title>' "$(page "$BASE_URL/groups/smoke-test")"
check 'an unknown API path answers 404' 404 "$(status -H 'Accept: text/html' "$BASE_URL/api/smoke-test")"

check 'the sign-in options answer' 200 "$(status "$BASE_URL/api/v1/sign-in-options")"
check 'Better Auth answers (no session)' null "$(curl -s "$BASE_URL/api/auth/get-session")"
check 'the API needs a session' 401 "$(status "$BASE_URL/api/v1/me")"
check 'an unknown invite link answers 404' 404 \
  "$(status "$BASE_URL/api/v1/invites/smoke-test-not-a-real-token-0000000000000")"
check 'a write from another site is refused' 403 "$(status -X PATCH -H 'Origin: https://smoke-test.invalid' \
  -H 'Content-Type: application/json' -d '{}' "$BASE_URL/api/v1/me")"

if [ "$failures" -gt 0 ]; then
  printf '%s check(s) failed.\n' "$failures"
  exit 1
fi
printf 'All checks passed.\n'
