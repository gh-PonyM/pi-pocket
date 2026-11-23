#!/usr/bin/env bash
# Sync this fork of Pi Pocket with the newest stable upstream release.
#
#   scripts/sync-upstream.sh                 merge the newest release tag, install, run the checks
#   scripts/sync-upstream.sh --report-only   print what is behind, change nothing
#
# It never pushes and never opens a pull request.
set -euo pipefail

UPSTREAM_REPO="TannerMidd/pi-pocket"
UPSTREAM_REMOTE="upstream"
MANIFESTS=(package.json package-lock.json npm-shrinkwrap.json)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

die() {
    echo "sync-upstream: $*" >&2
    exit 1
}

need() {
    command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

local_version() {
    awk -F'"' '/"version"/{print $4; exit}' package.json
}

# Newest stable release tag. gh stays unauthenticated on some machines, so fall back to the API.
newest_tag() {
    if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
        gh release view --repo "$UPSTREAM_REPO" --json tagName --jq .tagName
        return
    fi
    need curl
    local json
    json="$(curl -fsSL "https://api.github.com/repos/$UPSTREAM_REPO/releases/latest")"
    printf '%s\n' "$json" | awk -F'"' '/"tag_name"/{print $4; exit}'
}

fetch_upstream() {
    if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
        git remote add "$UPSTREAM_REMOTE" "https://github.com/$UPSTREAM_REPO.git"
    fi
    git fetch --quiet "$UPSTREAM_REMOTE" --tags
}

# "clean", "report" or "merge"
mode="merge"
if [[ "${1:-}" == "--report-only" ]]; then
    mode="report"
elif [[ $# -gt 0 ]]; then
    die "unknown argument: $1 (use --report-only)"
fi

need git
[[ -f package.json ]] || die "run this from the Pi Pocket checkout (no package.json here)"

if [[ "$mode" == "merge" && -n "$(git status --porcelain)" ]]; then
    die "the tree is dirty; commit or stash first"
fi

fetch_upstream
tag="$(newest_tag)"
[[ -n "$tag" ]] || die "cannot read the newest release tag of $UPSTREAM_REPO"
git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null || die "tag $tag is not fetched"

local_sha="$(git rev-parse --short HEAD)"
behind="$(git rev-list --count "HEAD..$tag")"
ahead="$(git rev-list --count "$tag..HEAD")"

echo "fork version: $(local_version)"
echo "newest stable upstream release: $tag"
echo "at $local_sha: $behind commits behind, $ahead ahead"

if [[ "$behind" -eq 0 ]]; then
    echo "nothing to merge"
    exit 0
fi

echo "changed files: $(git diff --name-only "HEAD..$tag" | wc -l)"
git diff --stat "HEAD..$tag" | tail -1

if [[ "$mode" == "report" ]]; then
    echo
    git log --oneline -10 "HEAD..$tag"
    exit 0
fi

echo
echo "merging $tag"
before="$(git rev-parse HEAD)"
if ! git merge --no-ff --quiet "$tag" -m "Merge tag $tag from $UPSTREAM_REPO"; then
    git merge --abort || true
    die "merge of $tag conflicts; the merge was aborted. Merge it by hand, then run the checks"
fi
echo "merged $tag into $(git branch --show-current)"

if [[ -n "$(git diff --name-only "$before" HEAD -- "${MANIFESTS[@]}")" ]]; then
    echo
    echo "manifests changed; installing"
    npm install || die "npm install failed"
fi

echo
echo "checking"
for step in check lint test; do
    echo "-- npm run $step"
    npm run --silent "$step" || die "npm run $step failed"
done

echo
echo "merged $tag. Not pushed: push the branch and open a pull request by hand"
