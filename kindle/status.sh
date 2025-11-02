#!/bin/sh

# Dashboard Status Script for Kindle Touch
# POSIX-compatible shell script for checking dashboard status

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/dashboard.log"
PID_FILE="$SCRIPT_DIR/dashboard.pid"

# Function to display status message with eips
show_status() {
    echo "$1"
    /usr/sbin/eips 1 1 "$1"
}

# Check if dashboard is running
check_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            return 0  # Running
        else
            rm -f "$PID_FILE"
            return 1  # Not running
        fi
    else
        return 1  # Not running
    fi
}

# Get last update time
get_last_update() {
    if [ -f "$SCRIPT_DIR/dashboard.png" ]; then
        stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$SCRIPT_DIR/dashboard.png" 2>/dev/null || echo "Unknown"
    else
        echo "No dashboard image"
    fi
}

# Get log tail
get_recent_logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -5 "$LOG_FILE" 2>/dev/null || echo "No recent logs"
    else
        echo "No log file found"
    fi
}

# Main status display
show_status "=== Dashboard Status ==="

if check_running; then
    PID=$(cat "$PID_FILE")
    show_status "Status: RUNNING (PID: $PID)"
else
    show_status "Status: STOPPED"
fi

LAST_UPDATE=$(get_last_update)
show_status "Last Update: $LAST_UPDATE"

# Battery info
if command -v gasgauge-info >/dev/null 2>&1; then
    BATTERY=$(gasgauge-info -c 2>/dev/null || echo "Unknown")
    show_status "Battery: $BATTERY%"
fi

# Network status
if iwconfig wlan0 2>/dev/null | grep -q "ESSID:"; then
    NETWORK=$(iwconfig wlan0 2>/dev/null | grep "ESSID:" | cut -d'"' -f2)
    show_status "WiFi: Connected ($NETWORK)"
else
    show_status "WiFi: Disconnected"
fi

show_status ""
show_status "=== Recent Logs ==="
get_recent_logs | while read line; do
    show_status "$line"
done

show_status ""
show_status "Press any key to continue..."