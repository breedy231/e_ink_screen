#!/usr/bin/env bash
# Online backup of the BYOS (byos_laravel) sqlite DB — device registration,
# API key, plugins/recipes and playlists. That config exists nowhere else:
# it lives only in the Docker named volume `prod_database` on this Mac, so
# losing the volume means re-registering the device and rebuilding every
# recipe by hand.
#
# Mirrors fitlocal's scripts/backup-db.sh: online snapshot, verify, promote,
# tiered retention. Differences are forced by the container:
#   - the DB is inside a Docker volume, not on the host filesystem, and the
#     larapaper image has no sqlite3 CLI — so the snapshot is taken with
#     PHP's PDO `VACUUM INTO` (SQLite's online-backup path, safe against a
#     live writer) and then copied out with `docker cp`.
#   - integrity is checked host-side, where sqlite3 does exist.
#
# Writes to ~/byos-backups/ as byos-YYYYMMDD-HHMMSS.sqlite.
# Safe to run against the live container; does not stop or pause BYOS.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${BYOS_CONTAINER:-prod-app-1}"
DB_IN_CONTAINER="${BYOS_DB_PATH:-database/storage/database.sqlite}"
DEST_DIR="${BYOS_BACKUP_DIR:-$HOME/byos-backups}"

if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
  echo "[backup-byos] container '$CONTAINER' is not running — nothing to back up" >&2
  exit 0
fi

mkdir -p "$DEST_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
DEST="$DEST_DIR/byos-$TS.sqlite"
TMP="$DEST.partial"
SNAPSHOT_IN_CONTAINER="/tmp/byos-backup-$TS.sqlite"

# VACUUM INTO takes a consistent snapshot of a live DB without blocking
# writers, and (unlike a file copy) can't catch a torn page or miss the WAL.
# Paths go in as env vars rather than interpolated into the PHP so a path with
# a quote in it can't break out of the snippet.
docker exec -e "SRC=$DB_IN_CONTAINER" -e "SNAP=$SNAPSHOT_IN_CONTAINER" "$CONTAINER" php -r '
$db = new PDO("sqlite:" . getenv("SRC"));
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec("VACUUM INTO " . $db->quote(getenv("SNAP")));
'

docker cp "$CONTAINER:$SNAPSHOT_IN_CONTAINER" "$TMP"
docker exec "$CONTAINER" rm -f "$SNAPSHOT_IN_CONTAINER"

# Verify the copy is readable and structurally sound before promoting it —
# a backup that silently isn't a database is worse than no backup.
if ! sqlite3 "$TMP" "PRAGMA integrity_check;" | grep -q '^ok$'; then
  echo "[backup-byos] integrity check FAILED on $TMP — keeping as .corrupt for inspection" >&2
  mv "$TMP" "$DEST.corrupt"
  exit 2
fi

# Sanity-check that this is actually a BYOS DB with real config in it, not an
# empty/reinitialized one. Restoring an empty snapshot over a working instance
# would be indistinguishable from the disaster it's meant to prevent.
DEVICES="$(sqlite3 "$TMP" "select count(*) from devices;" 2>/dev/null || echo 0)"
if [ "$DEVICES" -lt 1 ]; then
  echo "[backup-byos] snapshot contains no devices — refusing to promote it" >&2
  mv "$TMP" "$DEST.suspect"
  exit 3
fi

mv "$TMP" "$DEST"
rm -f "$TMP-shm" "$TMP-wal"
echo "[backup-byos] wrote $DEST ($(du -h "$DEST" | cut -f1), $DEVICES device(s))"

# Tiered retention: 24 hourly + 14 daily + 8 weekly. Only touches files
# matching byos-YYYYMMDD-HHMMSS.sqlite.
python3 "$REPO_ROOT/scripts/prune-backups.py" "$DEST_DIR"
