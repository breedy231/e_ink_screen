#!/bin/bash
# Auto-deploy: checks GitHub for new commits on main, pulls and restarts if changed.
# Designed to run via systemd timer on the Raspberry Pi.
#
# Usage: ./auto-deploy.sh [--force]

set -e

REPO_DIR="$HOME/e_ink_screen"
SERVER_DIR="$REPO_DIR/server"
SERVICE_NAME="kindle-dashboard"
LOG_FILE="$HOME/auto-deploy.log"
BRANCH="main"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Keep log file from growing forever (keep last 500 lines)
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 1000 ]; then
    tail -500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

FORCE=false
if [ "$1" = "--force" ]; then
    FORCE=true
fi

cd "$REPO_DIR" || { log "ERROR: $REPO_DIR does not exist"; exit 1; }

# Fetch latest from origin
if ! git fetch origin "$BRANCH" 2>>"$LOG_FILE"; then
    log "ERROR: git fetch failed (network issue?)"
    exit 1
fi

LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ] && [ "$FORCE" = false ]; then
    log "OK: up to date ($LOCAL_HEAD)"
    exit 0
fi

log "UPDATE: $LOCAL_HEAD -> $REMOTE_HEAD"

# Pull changes
if ! git pull origin "$BRANCH" 2>>"$LOG_FILE"; then
    log "ERROR: git pull failed"
    exit 1
fi

# Check if package.json changed (need npm install)
CHANGED_FILES=$(git diff --name-only "$LOCAL_HEAD" "$REMOTE_HEAD" 2>/dev/null || echo "")

if echo "$CHANGED_FILES" | grep -q "server/package.json"; then
    log "package.json changed, running npm install"
    cd "$SERVER_DIR"
    npm install --production >> "$LOG_FILE" 2>&1
    cd "$REPO_DIR"
fi

# Check if any server/ files changed
if echo "$CHANGED_FILES" | grep -q "^server/"; then
    log "Server files changed, restarting $SERVICE_NAME"
    sudo systemctl restart "$SERVICE_NAME"

    sleep 2
    STATUS=$(sudo systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo "unknown")
    if [ "$STATUS" = "active" ]; then
        log "Service restarted successfully"
    else
        log "ERROR: Service failed to start (status: $STATUS)"
        exit 1
    fi
else
    log "No server/ changes, skipping restart"
fi

log "Deploy complete (now at $(git rev-parse --short HEAD))"
