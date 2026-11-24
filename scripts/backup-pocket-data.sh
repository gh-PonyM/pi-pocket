#!/usr/bin/env bash
# Back up the Pi Pocket data folder before an update, above all the one-way 0.30.0 data change.
#
#   scripts/backup-pocket-data.sh                 ~/.pi-pocket into ~/.pi-pocket-backups, keep 5
#   scripts/backup-pocket-data.sh --all           also the browser profile and the worktrees
#   scripts/backup-pocket-data.sh --dest DIR --keep 10
#
# The database is copied through SQLite itself (VACUUM INTO), so the archive holds a consistent
# copy, not a half-written WAL. Only reads the source.
set -euo pipefail

source_dir="$HOME/.pi-pocket"
dest_dir="$HOME/.pi-pocket-backups"
keep=5
include_all=0
staging=""

die() {
    echo "backup-pocket-data: $*" >&2
    exit 1
}

usage() {
    sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

cleanup() {
    [[ -n "$staging" && -d "$staging" ]] && rm -rf "$staging"
    return 0
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --source) source_dir="${2:?--source needs a folder}"; shift 2 ;;
        --dest) dest_dir="${2:?--dest needs a folder}"; shift 2 ;;
        --keep) keep="${2:?--keep needs a number}"; shift 2 ;;
        --all) include_all=1; shift ;;
        -h | --help) usage; exit 0 ;;
        *) die "unknown argument: $1 (try --help)" ;;
    esac
done

[[ "$keep" =~ ^[0-9]+$ ]] || die "--keep needs a number, not '$keep'"
[[ "$keep" -ge 1 ]] || die "--keep must be at least 1, or the new archive is pruned too"
[[ -d "$source_dir" ]] || die "no data folder: $source_dir"
source_dir="$(cd "$source_dir" && pwd)"
dest_dir="${dest_dir/#\~/$HOME}"

case "$dest_dir" in
    "$source_dir" | "$source_dir"/*) die "put the backups outside $source_dir" ;;
esac

mkdir -p "$dest_dir"
dest_dir="$(cd "$dest_dir" && pwd)"

# A consistent copy of the database, WAL included. Falls back to copying the three files as they are.
snapshot_database() {
    local db="$source_dir/pocket.sqlite" out="$1/pocket.sqlite"

    [[ -f "$db" ]] || return 0
    if command -v node >/dev/null 2>&1 && node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.prepare("VACUUM INTO ?").run(process.argv[2]);
db.close();
' "$db" "$out" 2>/dev/null; then
        echo "database: consistent snapshot"
        return 0
    fi
    echo "database: plain copy (SQLite snapshot unavailable)" >&2
    cp "$db" "$out"
    local suffix
    for suffix in -wal -shm -journal; do
        [[ -f "$db$suffix" ]] && cp "$db$suffix" "$out$suffix"
    done
    return 0
}

trap cleanup EXIT

staging="$(mktemp -d "$dest_dir/.staging-XXXXXX")"
excludes=(--exclude=/pocket.sqlite --exclude=/pocket.sqlite-wal --exclude=/pocket.sqlite-shm)
excludes+=(--exclude=/pocket.sqlite-journal --exclude='/.staging-*')
if [[ "$include_all" -eq 0 ]]; then
    # Regenerable: the browser is a Chromium profile, the worktrees are git checkouts.
    excludes+=(--exclude=/browser/ --exclude=/worktrees/)
fi

echo "source: $source_dir"
rsync -a "${excludes[@]}" "$source_dir/" "$staging/"
snapshot_database "$staging"

stamp="$(date +%Y%m%d-%H%M%S)"
archive="$dest_dir/pi-pocket-data-$stamp.tar.gz"
count=2
while [[ -e "$archive" ]]; do
    archive="$dest_dir/pi-pocket-data-$stamp-$count.tar.gz"
    count=$((count + 1))
done
tar -czf "$archive" -C "$staging" .

tar -tzf "$archive" >/dev/null || die "the archive does not read back: $archive"
tar -tzf "$archive" | grep -x './pocket.sqlite' >/dev/null || echo "warning: no database in the archive" >&2

echo "wrote: $archive ($(du -h "$archive" | cut -f1), $(tar -tzf "$archive" | wc -l) entries)"

# Keep the newest $keep archives. ls -t sorts by time; a name sort would break on 20261124-060000-2.
newest_first() {
    ls -1t "$dest_dir"/pi-pocket-data-*.tar.gz 2>/dev/null || true
}

newest_first | tail -n +$((keep + 1)) | while read -r file; do
    rm -f "$file"
    echo "pruned: $file"
done

if [[ "$include_all" -eq 0 ]]; then
    echo "skipped: browser/ and worktrees/ (use --all to include them)"
fi
echo "restore: stop the server, move $source_dir aside, then tar -xzf $archive -C <new $source_dir>"
