#!/usr/bin/env bash
# Install (or refresh) the hourly launchd job that snapshots the BYOS sqlite DB.
#
# The plist is generated here rather than symlinked out of the repo on purpose:
# fitlocal's com.fitlocal.backup.plist is a symlink into a path that no longer
# exists, so its hourly backups silently stopped and nobody noticed for weeks.
# A generated copy can go stale if this repo moves, but `launchctl list` will
# still show the job — and the verify step below fails loudly at install time.
#
# Re-run this after moving the repo or editing the schedule.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.byos.backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPT="$REPO_ROOT/scripts/backup-byos-db.sh"
LOG_DIR="$HOME/Library/Logs"
INTERVAL="${BYOS_BACKUP_INTERVAL:-3600}"

[ -x "$SCRIPT" ] || { echo "missing or non-executable: $SCRIPT" >&2; exit 1; }

mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$SCRIPT</string>
    </array>
    <key>StartInterval</key>
    <integer>$INTERVAL</integer>
    <!-- Catch up after the Mac has been asleep/off, rather than silently
         skipping every missed hour. -->
    <key>RunAtLoad</key>
    <true/>
    <!-- The Docker CLI lives outside launchd's minimal default PATH. -->
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/$LABEL.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/$LABEL.err</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"

# Prove it's actually loaded — the whole point of this script.
if launchctl list | grep -q "$LABEL"; then
    echo "[install] $LABEL loaded (every ${INTERVAL}s)"
    echo "[install] logs: $LOG_DIR/$LABEL.log"
else
    echo "[install] FAILED to load $LABEL" >&2
    exit 1
fi
