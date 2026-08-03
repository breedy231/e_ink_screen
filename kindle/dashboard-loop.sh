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

# Compute current hour in Central Time from UTC
# Handles DST automatically using US rules:
#   CDT (UTC-5): Second Sunday of March through first Sunday of November
#   CST (UTC-6): First Sunday of November through second Sunday of March
get_central_hour() {
    if [ "$UTC_OFFSET" != "auto" ]; then
        utc_hour=$(date -u '+%H' | sed 's/^0//')
        central_hour=$(( (utc_hour + 24 + UTC_OFFSET) % 24 ))
        echo "$central_hour"
        return
    fi

    # Auto-detect DST using US rules
    utc_month=$(date -u '+%m' | sed 's/^0//')
    utc_day=$(date -u '+%d' | sed 's/^0//')
    utc_hour=$(date -u '+%H' | sed 's/^0//')
    utc_dow=$(date -u '+%w')  # 0=Sunday

    offset=-6  # CST default

    if [ "$utc_month" -gt 3 ] && [ "$utc_month" -lt 11 ]; then
        # April through October: always CDT
        offset=-5
    elif [ "$utc_month" = 3 ]; then
        # March: CDT starts at 2am local (8am UTC) on second Sunday
        # Find day of second Sunday: first Sunday + 7
        first_sunday=$(( (7 - utc_dow + utc_day % 7) % 7 ))
        first_sunday=$(( utc_day - utc_dow ))
        # Calculate: what day-of-month was the most recent Sunday?
        last_sunday=$(( utc_day - utc_dow ))
        # Second Sunday is between day 8-14
        # We're in CDT if we're past the second Sunday, or on it after 8am UTC
        second_sunday_min=8
        second_sunday_max=14
        # Find the second Sunday of this month
        # Day of week of the 1st: (utc_dow - (utc_day - 1) % 7 + 7) % 7
        dow_first=$(( (utc_dow - (utc_day - 1) % 7 + 7) % 7 ))
        days_to_first_sun=$(( (7 - dow_first) % 7 ))
        first_sun_day=$(( 1 + days_to_first_sun ))
        second_sun_day=$(( first_sun_day + 7 ))
        if [ "$utc_day" -gt "$second_sun_day" ]; then
            offset=-5
        elif [ "$utc_day" -eq "$second_sun_day" ] && [ "$utc_hour" -ge 8 ]; then
            offset=-5
        fi
    elif [ "$utc_month" = 11 ]; then
        # November: CST starts at 2am local (7am UTC) on first Sunday
        dow_first=$(( (utc_dow - (utc_day - 1) % 7 + 7) % 7 ))
        days_to_first_sun=$(( (7 - dow_first) % 7 ))
        first_sun_day=$(( 1 + days_to_first_sun ))
        if [ "$utc_day" -lt "$first_sun_day" ]; then
            offset=-5
        elif [ "$utc_day" -eq "$first_sun_day" ] && [ "$utc_hour" -lt 7 ]; then
            offset=-5
        fi
    fi

    central_hour=$(( (utc_hour + 24 + offset) % 24 ))
    echo "$central_hour"
}

# Check if current time is within active hours
# Returns 0 (true) if active, 1 (false) if outside active hours
# If both ACTIVE_HOURS_START and ACTIVE_HOURS_END are 0, always active (disabled)
is_active_hours() {
    if [ "$ACTIVE_HOURS_START" = "0" ] && [ "$ACTIVE_HOURS_END" = "0" ]; then
        return 0
    fi

    current_hour=$(get_central_hour)

    if [ "$current_hour" -ge "$ACTIVE_HOURS_START" ] && [ "$current_hour" -lt "$ACTIVE_HOURS_END" ]; then
        return 0
    fi

    return 1
}

##############################################################################
# Main
##############################################################################

main() {
    mkdir -p "$SCRIPT_DIR/logs"
    rotate_log

    # Load config file if it exists
    if [ -f "$CONFIG_FILE" ]; then
        . "$CONFIG_FILE"
    fi

    # Defaults for active hours (can be overridden by config)
    ACTIVE_HOURS_START="${ACTIVE_HOURS_START:-7}"
    ACTIVE_HOURS_END="${ACTIVE_HOURS_END:-22}"
    UTC_OFFSET="${UTC_OFFSET:-auto}"

    log_msg "========================================="
    log_msg "Dashboard loop starting (PID $$)"
    log_msg "  Interval: ${UPDATE_INTERVAL}s"
    log_msg "  Active hours: ${ACTIVE_HOURS_START}:00-${ACTIVE_HOURS_END}:00 Central"
    log_msg "  UTC offset: ${UTC_OFFSET}"
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

    # First update immediately (if within active hours)
    if is_active_hours; then
        do_update
    else
        current_hour=$(get_central_hour)
        log_msg "Outside active hours (${current_hour}:00, active ${ACTIVE_HOURS_START}:00-${ACTIVE_HOURS_END}:00), skipping initial fetch"
    fi

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
        if is_active_hours; then
            do_update
        else
            current_hour=$(get_central_hour)
            log_msg "Outside active hours (${current_hour}:00, active ${ACTIVE_HOURS_START}:00-${ACTIVE_HOURS_END}:00), skipping fetch"
        fi
    done

    cleanup
}

main
