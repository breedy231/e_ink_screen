#!/bin/sh

# Show Dashboard Logs Script for Kindle Touch
# POSIX-compatible shell script for displaying recent log entries

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/dashboard.log"

# Function to display log lines with eips
show_log_line() {
    echo "$1"
    /usr/sbin/eips 1 $2 "$1"
}

# Clear screen
/usr/sbin/eips -c

show_log_line "=== Dashboard Logs ===" 1

if [ ! -f "$LOG_FILE" ]; then
    show_log_line "No log file found at:" 3
    show_log_line "$LOG_FILE" 4
    show_log_line "" 5
    show_log_line "Press any key to continue..." 6
    exit 1
fi

# Show file info
LOG_SIZE=$(wc -l < "$LOG_FILE" 2>/dev/null || echo "0")
show_log_line "Log entries: $LOG_SIZE" 3

# Show last 15 lines of log
LINE_NUM=5
tail -15 "$LOG_FILE" 2>/dev/null | while read log_line; do
    if [ $LINE_NUM -le 20 ]; then  # Limit to screen height
        show_log_line "$log_line" $LINE_NUM
        LINE_NUM=$((LINE_NUM + 1))
    fi
done

# Add separator and instruction
show_log_line "" 21
show_log_line "=== End of Logs ===" 22
show_log_line "Press any key to continue..." 23