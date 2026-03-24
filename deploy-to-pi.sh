#!/bin/bash
# Deploy dashboard server code to Raspberry Pi and restart the service.
# Usage: ./deploy-to-pi.sh [--preview] [--no-restart] [--setup-auto-deploy]
#
# This syncs the server/ directory to the Pi and restarts the systemd service.
# After restart, fetches the generated dashboard image back so you can view it locally.
#
# With --setup-auto-deploy: sets up the Pi to automatically pull from GitHub
# every 15 minutes, so you never need to manually deploy again.

set -e

PI_HOST="pi"  # SSH alias from ~/.ssh/config
PI_DIR="dashboard-server/server"
LOCAL_DIR="server/"
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
PREVIEW_DIR="$PROJECT_ROOT/test-images"

# Parse args
RESTART=true
PREVIEW=false
for arg in "$@"; do
    case $arg in
        --no-restart) RESTART=false ;;
        --preview) PREVIEW=true ;;
        --setup-auto-deploy) SETUP_AUTO=true ;;
        --help|-h)
            echo "Usage: ./deploy-to-pi.sh [--preview] [--no-restart] [--setup-auto-deploy]"
            echo ""
            echo "  --preview            Fetch the generated dashboard image back and open it"
            echo "  --no-restart         Sync files but don't restart the service"
            echo "  --setup-auto-deploy  Set up Pi to auto-pull from GitHub (one-time setup)"
            exit 0
            ;;
    esac
done

# Handle auto-deploy setup
if [ "${SETUP_AUTO:-false}" = true ]; then
    echo "=== Setting up auto-deploy on Pi ==="
    echo "This will configure the Pi to automatically pull from GitHub daily at 6am."
    echo "After setup, merging a PR to main will auto-deploy by the next morning."
    echo ""
    ssh "$PI_HOST" 'bash -s' < "$PROJECT_ROOT/pi/setup-auto-deploy.sh"
    exit 0
fi

echo "=== Deploy to Pi ==="

# 1. Sync server code
echo -n "Syncing server/ -> pi:~/$PI_DIR ... "
rsync -az --delete \
    --exclude 'node_modules' \
    --exclude 'cache' \
    --exclude '*.log' \
    "$PROJECT_ROOT/$LOCAL_DIR" \
    "$PI_HOST:~/$PI_DIR/"
echo "done"

# 2. Check if package.json changed (need npm install)
REMOTE_PKGJSON_HASH=$(ssh "$PI_HOST" "md5sum ~/$PI_DIR/package.json 2>/dev/null | cut -d' ' -f1" 2>/dev/null || echo "none")
LOCAL_PKGJSON_HASH=$(md5 -q "$PROJECT_ROOT/$LOCAL_DIR/package.json" 2>/dev/null || echo "none")

if [ "$REMOTE_PKGJSON_HASH" != "none" ] && [ "$LOCAL_PKGJSON_HASH" = "$REMOTE_PKGJSON_HASH" ]; then
    : # hashes match after sync, no npm install needed
else
    echo -n "package.json changed, running npm install on Pi ... "
    ssh "$PI_HOST" "cd ~/$PI_DIR && npm install --production 2>&1 | tail -1"
    echo "done"
fi

# 3. Restart service
if [ "$RESTART" = true ]; then
    echo -n "Restarting kindle-dashboard service ... "
    ssh "$PI_HOST" "sudo systemctl restart kindle-dashboard"
    echo "done"

    # Wait for service to be ready
    sleep 2

    # Verify it's running
    STATUS=$(ssh "$PI_HOST" "sudo systemctl is-active kindle-dashboard" 2>/dev/null || echo "unknown")
    if [ "$STATUS" = "active" ]; then
        echo "Service status: active"
        # Check Discord webhook configuration
        DISCORD_SET=$(ssh "$PI_HOST" "grep -q DISCORD_WEBHOOK_URL ~/dashboard-server/.env 2>/dev/null && echo yes || echo no")
        if [ "$DISCORD_SET" = "yes" ]; then
            echo "Discord notifications: configured"
        else
            echo "Discord notifications: not configured (add DISCORD_WEBHOOK_URL to ~/dashboard-server/.env)"
        fi
    else
        echo "WARNING: Service status: $STATUS"
        echo "Check logs: ssh pi 'sudo journalctl -u kindle-dashboard -n 20'"
        exit 1
    fi
fi

# 4. Preview - fetch the dashboard image back and open it
if [ "$PREVIEW" = true ]; then
    echo -n "Fetching dashboard preview from Pi ... "
    PREVIEW_FILE="$PREVIEW_DIR/pi_preview_$(date +%Y-%m-%d_%H-%M-%S).png"
    # Retry a few times since the server may still be starting up
    for i in 1 2 3; do
        if curl -sf -o "$PREVIEW_FILE" --connect-timeout 3 --max-time 15 "http://192.168.50.163:3000/dashboard"; then
            echo "done -> $PREVIEW_FILE"
            open "$PREVIEW_FILE"
            break
        fi
        if [ "$i" -lt 3 ]; then
            echo -n "retry ... "
            sleep 2
        else
            echo "failed (server may still be starting - try: curl http://192.168.50.163:3000/dashboard -o preview.png)"
        fi
    done
fi

echo "=== Deploy complete ==="
