#!/bin/sh

##############################################################################
# Kindle Dashboard Loop
#
# Keeps the Kindle awake and updates the dashboard every N seconds.
# Replaces cron-based updates which fail when the CPU suspends.
#
# How it works:
#   1. Stop framework (prevents power state management)
#   2. Set preventScreenSaver (keeps dashboard visible)
#   3. Enable WiFi, fetch dashboard, display on e-ink
#   4. Sleep for interval, then repeat
#
# Must be started after boot to survive reboots — see init script.
#
# Usage: ./dashboard-loop.sh [OPTIONS]
#   --interval SECONDS   Update interval (default: 300 = 5 min)
#   --once               Run once and exit (testing)
##############################################################################

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config/dashboard.conf"
FETCH_SCRIPT="$SCRIPT_DIR/fetch-dashboard.sh"
LOG_FILE="$SCRIPT_DIR/logs/dashboard-loop.log"
PID_FILE="$SCRIPT_DIR/dashboard-loop.pid"

# Defaults
UPDATE_INTERVAL=900
ALIGN_BUFFER=30       # seconds past the boundary to fetch (ensures server generates correct time)
RUN_ONCE=false
WIFI_WAIT_MAX=30

# Parse arguments
while [ $# -gt 0 ]; do
    case $1 in
        --interval)
            UPDATE_INTERVAL="$2"
            shift 2
            ;;
        --once)
            RUN_ONCE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

log_msg() {
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$ts] $1"
    if [ -d "$(dirname "$LOG_FILE")" ]; then
        echo "[$ts] $1" >> "$LOG_FILE"
    fi
}

rotate_log() {
    if [ -f "$LOG_FILE" ]; then
        local size
        size=$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)
        if [ "$size" -gt 102400 ]; then
            tail -100 "$LOG_FILE" > "${LOG_FILE}.tmp"
            mv "${LOG_FILE}.tmp" "$LOG_FILE"
            log_msg "Log rotated"
        fi
    fi
}

write_pid() {
    echo $$ > "$PID_FILE"
    log_msg "PID $$ written to $PID_FILE"
}

cleanup() {
    log_msg "Dashboard loop stopping (PID $$)"
    rm -f "$PID_FILE"
    exit 0
}

trap cleanup INT TERM

# Stop Kindle framework to prevent power state management
stop_framework() {
    if [ -x "/sbin/stop" ]; then
        /sbin/stop framework 2>/dev/null && log_msg "Framework stopped" || log_msg "Framework already stopped or not found"
    fi
}

# Prevent screensaver and suspend
prevent_sleep() {
    if [ -x "/usr/bin/lipc-set-prop" ]; then
        /usr/bin/lipc-set-prop com.lab126.powerd preventScreenSaver 1 2>/dev/null || true
    fi
}

# Disable Kindle UI overlay (pillow) to prevent status bar bleed-through
disable_pillow() {
    if [ -x "/usr/bin/lipc-set-prop" ]; then
        /usr/bin/lipc-set-prop com.lab126.pillow disableEnablePillow disable 2>/dev/null && log_msg "Pillow disabled" || log_msg "Pillow disable failed (may already be off)"
    fi
}

# Enable WiFi and wait for connection
enable_wifi() {
    if [ -x "/usr/bin/lipc-set-prop" ]; then
        /usr/bin/lipc-set-prop com.lab126.cmd wirelessEnable 1 2>/dev/null || true
    fi

    local waited=0
    while [ $waited -lt $WIFI_WAIT_MAX ]; do
        if ifconfig wlan0 2>/dev/null | grep -q "inet addr"; then
            log_msg "WiFi connected (${waited}s)"
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
    done

    log_msg "WARNING: WiFi not connected after ${WIFI_WAIT_MAX}s"
    return 1
}

# Fetch and display dashboard
do_update() {
    log_msg "--- Update ---"

    # Re-assert sleep prevention every cycle
    prevent_sleep

    if ! enable_wifi; then
        log_msg "WiFi failed, skipping update"
        return 1
    fi

    if [ -x "$FETCH_SCRIPT" ]; then
        "$FETCH_SCRIPT" --config "$CONFIG_FILE" >> "$LOG_FILE" 2>&1
        local rc=$?
        if [ $rc -eq 0 ]; then
            log_msg "Update successful"
        else
            log_msg "Update failed (rc=$rc)"
        fi
        return $rc
    else
        log_msg "ERROR: Fetch script not found: $FETCH_SCRIPT"
        return 1
    fi
}

##############################################################################
# Main
##############################################################################

main() {
    mkdir -p "$SCRIPT_DIR/logs"
    rotate_log

    log_msg "========================================="
    log_msg "Dashboard loop starting (PID $$)"
    log_msg "  Interval: ${UPDATE_INTERVAL}s"
    log_msg "========================================="

    write_pid

    # Sync clock before anything else (Kindle clock drifts without framework)
    if type ntpdate >/dev/null 2>&1; then
        ntpdate -s pool.ntp.org 2>/dev/null && log_msg "Clock synced via NTP" || log_msg "NTP sync failed (continuing with current time)"
    fi

    # Stop framework, disable UI overlay, and prevent sleep
    stop_framework
    sleep 2
    prevent_sleep
    disable_pillow

    # Clear screen after framework stop
    if [ -x "/usr/sbin/eips" ]; then
        /usr/sbin/eips -c 2>/dev/null || true
        sleep 1
        /usr/sbin/eips -f -c 2>/dev/null || true
    fi

    # First update immediately
    do_update

    if [ "$RUN_ONCE" = "true" ]; then
        log_msg "Run-once mode, exiting"
        cleanup
        return
    fi

    while true; do
        # Re-sync clock each cycle to prevent drift
        if type ntpdate >/dev/null 2>&1; then
            ntpdate -s pool.ntp.org 2>/dev/null || true
        fi

        # Calculate sleep until next aligned boundary + buffer
        # e.g. with 900s interval (15 min), aligns to :00/:15/:30/:45
        now=$(date +%s)
        remainder=$((now % UPDATE_INTERVAL))
        sleep_time=$((UPDATE_INTERVAL - remainder + ALIGN_BUFFER))

        next_epoch=$((now + sleep_time))
        # Format next wake time for logging (busybox date -d @epoch may not work, use arithmetic)
        next_min=$(( (next_epoch / 60) % 60 ))
        next_hour=$(( (next_epoch / 3600) % 24 ))
        log_msg "Sleeping ${sleep_time}s (next fetch ~${next_hour}:$(printf '%02d' $next_min) UTC)"

        sleep "$sleep_time"
        rotate_log
        do_update
    done

    cleanup
}

main
