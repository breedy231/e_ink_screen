#!/bin/sh

##############################################################################
# Setup Local Dashboard Auto-Update for Kindle Touch
# POSIX-compatible script for scheduling automated dashboard updates from local server
#
# Usage: ./setup-local-cron.sh [OPTIONS]
#
# This script sets up a cron job on the Kindle to fetch dashboard updates
# from your local development server every 5 minutes.
##############################################################################

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config/dashboard.conf"
FETCH_SCRIPT="$SCRIPT_DIR/fetch-dashboard.sh"
LOG_FILE="$SCRIPT_DIR/logs/cron-setup.log"

# Default configuration
# Central Time 7am-10pm requires two cron entries due to UTC timezone
# Entry 1: 12-23 UTC (7am-6:59pm CDT)
# Entry 2: 0-3 UTC (7pm-10pm CDT)
UPDATE_INTERVAL_1="*/5 12-23 * * *"  # Every 5 minutes, 12pm-11pm UTC (7am-6:59pm Central)
UPDATE_INTERVAL_2="*/5 0-3 * * *"    # Every 5 minutes, midnight-3am UTC (7pm-10pm Central)
USE_CENTRAL_TIME=true                # Set to false for single interval
SERVER_HOST="192.168.50.163"         # Production Raspberry Pi server
SERVER_PORT="3000"

# Function to log messages
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
    echo "$1"
}

# Function to display usage
show_usage() {
    cat << EOF
Setup Local Dashboard Auto-Update

USAGE:
    $0 [OPTIONS]

OPTIONS:
    -i, --interval CRON    Cron schedule (default: */5 * * * *)
    -s, --server HOST      Server hostname/IP (default: 192.168.50.200)
    -p, --port PORT        Server port (default: 3000)
    -h, --help             Show this help

EXAMPLES:
    $0                                  # Setup 5-minute updates
    $0 -i "*/10 * * * *"               # Setup 10-minute updates
    $0 -i "*/5 8-22 * * *"             # 5-min updates, 8am-10pm only
    $0 -s 192.168.1.50 -p 8080         # Custom server settings

CRON SCHEDULE FORMAT:
    * * * * *
    │ │ │ │ │
    │ │ │ │ └─ Day of week (0-7, 0 and 7 are Sunday)
    │ │ │ └─── Month (1-12)
    │ │ └───── Day of month (1-31)
    │ └─────── Hour (0-23)
    └───────── Minute (0-59)

COMMON SCHEDULES:
    */5 * * * *        Every 5 minutes
    */10 * * * *       Every 10 minutes
    */15 * * * *       Every 15 minutes
    0 * * * *          Every hour
    */5 6-23 * * *     Every 5 min, 6am-11pm

EOF
}

# Parse command line arguments
while [ $# -gt 0 ]; do
    case $1 in
        -i|--interval)
            UPDATE_INTERVAL_1="$2"
            UPDATE_INTERVAL_2=""
            USE_CENTRAL_TIME=false
            shift 2
            ;;
        -s|--server)
            SERVER_HOST="$2"
            shift 2
            ;;
        -p|--port)
            SERVER_PORT="$2"
            shift 2
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Create directories
mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$SCRIPT_DIR/config"

log_message "=== Local Dashboard Cron Setup ==="

# Check if fetch script exists
if [ ! -f "$FETCH_SCRIPT" ]; then
    log_message "ERROR: fetch-dashboard.sh not found at $FETCH_SCRIPT"
    exit 1
fi

# Make fetch script executable
chmod +x "$FETCH_SCRIPT"

# Update dashboard.conf with local server settings
log_message "Updating dashboard configuration..."
if [ -f "$CONFIG_FILE" ]; then
    # Backup existing config
    cp "$CONFIG_FILE" "${CONFIG_FILE}.backup.$(date +%Y%m%d_%H%M%S)"

    # Update SERVER_HOST and SERVER_PORT in config (busybox-compatible sed)
    TEMP_CONFIG="/tmp/dashboard_conf.tmp"
    sed "s/^SERVER_HOST=.*/SERVER_HOST=\"$SERVER_HOST\"/" "$CONFIG_FILE" | \
        sed "s/^SERVER_PORT=.*/SERVER_PORT=\"$SERVER_PORT\"/" > "$TEMP_CONFIG"

    if [ -s "$TEMP_CONFIG" ]; then
        mv "$TEMP_CONFIG" "$CONFIG_FILE"
        log_message "Updated config: SERVER_HOST=$SERVER_HOST SERVER_PORT=$SERVER_PORT"
    else
        log_message "ERROR: Failed to update config file"
        rm -f "$TEMP_CONFIG"
    fi
else
    log_message "WARNING: dashboard.conf not found, fetch script will use defaults"
fi

if [ "$USE_CENTRAL_TIME" = "true" ]; then
    log_message "Using Central Time schedule (7am-10pm CDT/CST)"
    log_message "  Interval 1: $UPDATE_INTERVAL_1 (12pm-11pm UTC / 7am-6:59pm Central)"
    log_message "  Interval 2: $UPDATE_INTERVAL_2 (midnight-3am UTC / 7pm-10pm Central)"
else
    log_message "Using custom schedule: $UPDATE_INTERVAL_1"
fi
log_message "Server endpoint: http://$SERVER_HOST:$SERVER_PORT"

# Create cron entries (removes --quiet to enable auto-update.log)
# INFO messages go to auto-update.log, DEBUG details still in fetch.log
CRON_CMD="$FETCH_SCRIPT --config $CONFIG_FILE >> $SCRIPT_DIR/logs/auto-update.log 2>&1"
CRON_ENTRY_1="$UPDATE_INTERVAL_1 $CRON_CMD"
if [ -n "$UPDATE_INTERVAL_2" ]; then
    CRON_ENTRY_2="$UPDATE_INTERVAL_2 $CRON_CMD"
fi

log_message "Setting up cron job..."

# Ensure cron directories exist
log_message "Creating cron directories..."
mkdir -p /var/spool/cron/crontabs 2>/dev/null || true
mkdir -p /var/spool/cron 2>/dev/null || true

# Get current crontab (if any)
TEMP_CRON="/tmp/kindle_cron.tmp"
crontab -l > "$TEMP_CRON" 2>/dev/null || touch "$TEMP_CRON"

# Remove any existing dashboard entries (both local and cloud)
grep -v "fetch-dashboard" "$TEMP_CRON" > "${TEMP_CRON}.new" 2>/dev/null || touch "${TEMP_CRON}.new"
mv "${TEMP_CRON}.new" "$TEMP_CRON"

# Add new cron entry/entries
if [ "$USE_CENTRAL_TIME" = "true" ]; then
    echo "# Kindle Dashboard Auto-Update (Local Server - Central Time 7am-10pm)" >> "$TEMP_CRON"
    echo "# Entry 1: 12:00-23:59 UTC (7am-6:59pm CDT)" >> "$TEMP_CRON"
    echo "$CRON_ENTRY_1" >> "$TEMP_CRON"
    echo "# Entry 2: 00:00-03:00 UTC (7pm-10pm CDT previous day)" >> "$TEMP_CRON"
    echo "$CRON_ENTRY_2" >> "$TEMP_CRON"
else
    echo "# Kindle Dashboard Auto-Update (Local Server)" >> "$TEMP_CRON"
    echo "$CRON_ENTRY_1" >> "$TEMP_CRON"
fi

# Install the new crontab
if crontab "$TEMP_CRON" 2>/dev/null; then
    log_message "Cron job installed successfully"
else
    log_message "WARNING: crontab command failed, trying manual installation..."
    # Manual fallback - write directly to cron file
    CRON_USER="${USER:-root}"
    CRON_FILE="/var/spool/cron/crontabs/$CRON_USER"

    if cp "$TEMP_CRON" "$CRON_FILE" 2>/dev/null; then
        chmod 600 "$CRON_FILE" 2>/dev/null
        log_message "Cron job installed manually to $CRON_FILE"
    else
        log_message "ERROR: Failed to install cron job"
        rm -f "$TEMP_CRON"
        exit 1
    fi
fi

# Cleanup
rm -f "$TEMP_CRON"

# Start/restart cron service if not running
if ! pgrep crond >/dev/null 2>&1; then
    log_message "Starting cron service..."
    if /etc/init.d/cron start 2>/dev/null || /etc/init.d/crond start 2>/dev/null; then
        log_message "Cron service started"
    else
        log_message "WARNING: Could not start cron service - may need manual intervention"
    fi
else
    log_message "Cron service already running"
fi

# Show current crontab
log_message "Current crontab entries:"
crontab -l | grep -E "(fetch-dashboard|^#)" >> "$LOG_FILE" 2>&1

# Test fetch script syntax
log_message "Testing fetch script..."
if sh -n "$FETCH_SCRIPT" 2>/dev/null; then
    log_message "Fetch script syntax OK"
else
    log_message "WARNING: Fetch script may have syntax errors"
fi

# Show success message
echo ""
echo "✅ Local dashboard auto-update setup complete!"
echo ""
echo "Configuration:"
if [ "$USE_CENTRAL_TIME" = "true" ]; then
    echo "  📅 Schedule: Central Time 7am-10pm"
    echo "    Entry 1: $UPDATE_INTERVAL_1 (7am-6:59pm CDT)"
    echo "    Entry 2: $UPDATE_INTERVAL_2 (7pm-10pm CDT)"
else
    echo "  📅 Schedule: $UPDATE_INTERVAL_1"
fi
echo "  🖥️  Server: http://$SERVER_HOST:$SERVER_PORT"
echo "  📍 Fetch script: $FETCH_SCRIPT"
echo "  ⚙️  Config: $CONFIG_FILE"
echo "  📋 Log: $SCRIPT_DIR/logs/auto-update.log"
echo ""
echo "Next Steps:"
echo "  1. Start local server on Mac:"
echo "     cd server && node server.js --host 0.0.0.0 --port 3000"
echo ""
echo "  2. Test manual fetch:"
echo "     $FETCH_SCRIPT --verbose"
echo ""
echo "  3. Monitor auto-updates:"
echo "     tail -f $SCRIPT_DIR/logs/auto-update.log"
echo ""
echo "  4. To disable auto-updates:"
echo "     crontab -l | grep -v fetch-dashboard | crontab -"
echo ""
echo "Status:"
crontab -l | grep fetch-dashboard
echo ""
log_message "=== Setup completed successfully ==="
