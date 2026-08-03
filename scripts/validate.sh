#!/bin/sh
# Repository validation gate — run before every commit/deploy.
#
# Replaces the retired cron-era grep-test suite with checks that validate
# the code that actually ships:
#   1. POSIX syntax check on every Kindle shell script (they run under busybox ash)
#   2. bash syntax check on dev/deploy scripts (root + pi/)
#   3. node --check on every server JS file
#   4. Secret-pattern scan over tracked files
#   5. Exec-bit check on Kindle scripts as stored in git
#   6. Server unit tests (npm test)
#
# Usage: ./scripts/validate.sh [--no-npm]

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FAILURES=0
RUN_NPM=1
[ "$1" = "--no-npm" ] && RUN_NPM=0

# Prefer dash for the POSIX check when available (stricter than bash's sh mode)
if command -v dash >/dev/null 2>&1; then
    POSIX_SH="dash"
else
    POSIX_SH="sh"
fi

fail() {
    echo "  ✗ $1"
    FAILURES=$((FAILURES + 1))
}

pass() {
    echo "  ✓ $1"
}

echo "=== 1. Kindle scripts: POSIX syntax (${POSIX_SH} -n) ==="
for script in kindle/*.sh; do
    [ -f "$script" ] || continue
    if "$POSIX_SH" -n "$script" 2>/dev/null; then
        pass "$script"
    else
        fail "$script has POSIX syntax errors:"
        "$POSIX_SH" -n "$script" 2>&1 | sed 's/^/      /' || true
    fi
done

echo "=== 2. Dev/deploy scripts: bash syntax (bash -n) ==="
for script in *.sh pi/*.sh scripts/*.sh; do
    [ -f "$script" ] || continue
    if bash -n "$script" 2>/dev/null; then
        pass "$script"
    else
        fail "$script has bash syntax errors:"
        bash -n "$script" 2>&1 | sed 's/^/      /' || true
    fi
done

echo "=== 3. Server JS: node --check ==="
if command -v node >/dev/null 2>&1; then
    for js in server/*.js; do
        [ -f "$js" ] || continue
        if node --check "$js" 2>/dev/null; then
            pass "$js"
        else
            fail "$js has syntax errors:"
            node --check "$js" 2>&1 | sed 's/^/      /' || true
        fi
    done
else
    echo "  - node not found, skipping"
fi

echo "=== 4. Secret scan (tracked files) ==="
# Known-leaked strings must never reappear; broaden patterns as needed.
# SECURITY_ROTATION.md documents the (rotated) historical leak, and this
# script contains the patterns themselves — both are exempt.
SECRET_PATTERN='eragon|icloud\.com/published'
SECRET_EXEMPT=':!SECURITY_ROTATION.md :!scripts/validate.sh'
if git grep -iIlE "$SECRET_PATTERN" -- $SECRET_EXEMPT >/dev/null 2>&1; then
    fail "secret pattern found in tracked files:"
    git grep -iIlE "$SECRET_PATTERN" -- $SECRET_EXEMPT | sed 's/^/      /'
else
    pass "no known secret patterns in tracked files"
fi
if git ls-files | grep -E '(^|/)\.env$' >/dev/null 2>&1; then
    fail ".env file is tracked by git"
else
    pass "no .env files tracked"
fi

echo "=== 5. Kindle scripts: exec bit in git ==="
# /mnt/us is vfat so runtime relies on `sh script`, but git modes should
# still be correct so a checkout on any filesystem behaves.
NON_EXEC="$(git ls-files -s kindle/ | grep '\.sh$' | grep '^100644' || true)"
if [ -n "$NON_EXEC" ]; then
    fail "kindle scripts stored without exec bit:"
    echo "$NON_EXEC" | sed 's/^/      /'
else
    pass "all kindle/*.sh stored as executable"
fi

if [ "$RUN_NPM" = "1" ]; then
    echo "=== 6. Server unit tests (npm test) ==="
    if command -v npm >/dev/null 2>&1 && [ -d server/node_modules ]; then
        if (cd server && npm test >/dev/null 2>&1); then
            pass "npm test"
        else
            fail "npm test failed — run: cd server && npm test"
        fi
    else
        echo "  - npm or server/node_modules missing, skipping (cd server && npm install)"
    fi
fi

echo ""
if [ "$FAILURES" -gt 0 ]; then
    echo "✗ VALIDATION FAILED: $FAILURES problem(s)"
    exit 1
fi
echo "✓ ALL VALIDATIONS PASSED"
