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
START_SCRIPT="$DASHBOARD_DIR/start.sh"
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

# Delegate to start.sh rather than launching the loop directly: start.sh
# also stops the framework, prevents screen sleep, enables WiFi keep-alive
# (keepAliveWirelessRadio + iwconfig power off), clears the screen, and
# kills any stale loop. Launching the loop directly here used to skip the
# WiFi keep-alive, so the radio slept on battery after every reboot.
# Invoke via sh: /mnt/us is vfat, so exec bits don't survive there.
if [ -f "$START_SCRIPT" ]; then
    log_msg "Delegating to start.sh (framework stop, keep-alives, loop launch)..."
    if sh "$START_SCRIPT"; then
        log_msg "Dashboard mode started"
    else
        log_msg "ERROR: start.sh failed (rc=$?)"
        exit 1
    fi
else
    log_msg "ERROR: $START_SCRIPT not found"
    exit 1
fi
