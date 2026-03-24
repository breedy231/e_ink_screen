#!/bin/bash
# One-time setup: configure the Pi for automatic git-based deployment.
#
# Run this from your Mac:  ssh pi 'bash -s' < pi/setup-auto-deploy.sh
# Or copy to Pi and run:   scp pi/setup-auto-deploy.sh pi:~ && ssh pi './setup-auto-deploy.sh'
#
# What this does:
#   1. Clones the repo (or uses existing clone)
#   2. Installs server dependencies
#   3. Migrates the systemd service to use the repo's server/ directory
#   4. Preserves your .env file (Discord webhook, etc.)
#   5. Installs a systemd timer to auto-pull from GitHub every 15 minutes
#
# After setup, merging a PR to main will auto-deploy to the Pi within 15 minutes.

set -e

REPO_URL="https://github.com/breedy231/e_ink_screen.git"
REPO_DIR="$HOME/e_ink_screen"
OLD_SERVER_DIR="$HOME/dashboard-server/server"
NEW_SERVER_DIR="$REPO_DIR/server"
SERVICE_NAME="kindle-dashboard"

echo "=== Kindle Dashboard Auto-Deploy Setup ==="
echo ""

# ── 1. Clone repo ──────────────────────────────────────────────
if [ -d "$REPO_DIR/.git" ]; then
    echo "[1/6] Repo already cloned at $REPO_DIR, pulling latest..."
    cd "$REPO_DIR"
    git pull origin main
else
    echo "[1/6] Cloning repo to $REPO_DIR..."
    git clone "$REPO_URL" "$REPO_DIR"
    cd "$REPO_DIR"
fi
echo ""

# ── 2. Preserve .env from old deployment ──────────────────────
if [ -f "$HOME/dashboard-server/.env" ] && [ ! -f "$REPO_DIR/server/.env" ]; then
    echo "[2/6] Migrating .env from old deployment..."
    cp "$HOME/dashboard-server/.env" "$REPO_DIR/server/.env"
    echo "  Copied: ~/dashboard-server/.env -> $REPO_DIR/server/.env"
else
    echo "[2/6] No .env migration needed"
fi

# Also preserve config.json if it exists
if [ -f "$HOME/dashboard-server/config.json" ] && [ ! -f "$REPO_DIR/server/config.json" ]; then
    cp "$HOME/dashboard-server/config.json" "$REPO_DIR/server/config.json"
    echo "  Copied: ~/dashboard-server/config.json -> $REPO_DIR/server/config.json"
fi
echo ""

# ── 3. Install server dependencies ───────────────────────────
echo "[3/6] Installing server dependencies..."
cd "$NEW_SERVER_DIR"
npm install --production 2>&1 | tail -3

# Set up Python venv for e-ink optimization if not present
if [ ! -d "$REPO_DIR/venv" ]; then
    echo "  Setting up Python venv for e-ink optimization..."
    python3 -m venv "$REPO_DIR/venv"
    "$REPO_DIR/venv/bin/pip" install Pillow 2>&1 | tail -1
fi
echo ""

# ── 4. Update systemd service ────────────────────────────────
echo "[4/6] Updating systemd service to use repo directory..."

# Create updated service file pointing to the repo
sudo tee /etc/systemd/system/kindle-dashboard.service > /dev/null << EOF
[Unit]
Description=Kindle Dashboard Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=$NEW_SERVER_DIR
ExecStart=/usr/bin/node $NEW_SERVER_DIR/local-dashboard-server.js
Restart=always
RestartSec=10
EnvironmentFile=-$NEW_SERVER_DIR/.env

[Install]
WantedBy=multi-user.target
EOF
echo ""

# ── 5. Install auto-deploy timer ─────────────────────────────
echo "[5/6] Installing auto-deploy timer..."

# Make the auto-deploy script executable
chmod +x "$REPO_DIR/pi/auto-deploy.sh"

# Install the updater service
sudo tee /etc/systemd/system/kindle-dashboard-updater.service > /dev/null << EOF
[Unit]
Description=Kindle Dashboard Auto-Deploy
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=pi
ExecStart=$REPO_DIR/pi/auto-deploy.sh
WorkingDirectory=$REPO_DIR
EOF

# Install the timer (every 15 minutes)
sudo cp "$REPO_DIR/pi/kindle-dashboard-updater.timer" /etc/systemd/system/

# Reload and enable
sudo systemctl daemon-reload
sudo systemctl enable kindle-dashboard-updater.timer
sudo systemctl start kindle-dashboard-updater.timer
echo ""

# ── 6. Restart dashboard service ─────────────────────────────
echo "[6/6] Restarting dashboard service..."
sudo systemctl restart "$SERVICE_NAME"
sleep 2

STATUS=$(sudo systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo "unknown")
TIMER_STATUS=$(sudo systemctl is-active kindle-dashboard-updater.timer 2>/dev/null || echo "unknown")

echo ""
echo "=== Setup Complete ==="
echo ""
echo "  Dashboard service: $STATUS"
echo "  Auto-deploy timer: $TIMER_STATUS"
echo "  Repo location:     $REPO_DIR"
echo "  Server directory:  $NEW_SERVER_DIR"
echo "  Auto-deploy log:   $HOME/auto-deploy.log"
echo ""
echo "  The Pi will check GitHub every 15 minutes."
echo "  When main has new commits, it will pull and restart automatically."
echo ""
echo "  Useful commands:"
echo "    sudo systemctl status kindle-dashboard          # Dashboard status"
echo "    sudo systemctl list-timers                      # Timer status"
echo "    cat ~/auto-deploy.log                           # Deploy log"
echo "    ~/e_ink_screen/pi/auto-deploy.sh --force        # Force redeploy now"
echo ""

# If old deployment dir exists, suggest cleanup
if [ -d "$HOME/dashboard-server" ]; then
    echo "  NOTE: Old deployment at ~/dashboard-server/ still exists."
    echo "  Once you've verified everything works, you can remove it:"
    echo "    rm -rf ~/dashboard-server"
    echo ""
fi
