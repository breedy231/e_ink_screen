#!/bin/sh

##############################################################################
# Kindle Dashboard Boot Script
#
# Auto-starts the dashboard loop after Kindle boots.
# Install to: /etc/init.d/dashboard or trigger from KUAL/usbnet hook.
#
# Waits for network to be ready before launching the loop.
##############################################################################

DASHBOARD_DIR="/mnt/us/dashboard"
LOOP_SCRIPT="$DASHBOARD_DIR/dashboard-loop.sh"
LOG_FILE="$DASHBOARD_DIR/logs/boot.log"
PID_FILE="$DASHBOARD_DIR/dashboard-loop.pid"

log_msg() {
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$ts] $1"
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "[$ts] $1" >> "$LOG_FILE"
}

case "$1" in
    stop)
        log_msg "Stopping dashboard loop..."
        if [ -f "$PID_FILE" ]; then
            pid=$(cat "$PID_FILE")
            if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
                kill "$pid"
                log_msg "Stopped PID $pid"
            fi
            rm -f "$PID_FILE"
        fi
        exit 0
        ;;
esac

log_msg "Dashboard boot script starting..."

# Wait for system to settle after boot
sleep 30

# Wait for WiFi (up to 60s)
waited=0
while [ $waited -lt 60 ]; do
    if ifconfig wlan0 2>/dev/null | grep -q "inet addr"; then
        log_msg "WiFi ready (${waited}s)"
        break
    fi
    sleep 5
    waited=$((waited + 5))
done

# Kill any stale loop process
if [ -f "$PID_FILE" ]; then
    old_pid=$(cat "$PID_FILE")
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
        kill "$old_pid" 2>/dev/null || true
        sleep 1
    fi
    rm -f "$PID_FILE"
fi

# Launch dashboard loop
if [ -x "$LOOP_SCRIPT" ]; then
    log_msg "Launching dashboard loop..."
    "$LOOP_SCRIPT" &
    log_msg "Dashboard loop started (PID $!)"
else
    log_msg "ERROR: $LOOP_SCRIPT not found or not executable"
    exit 1
fi
