#!/bin/sh

##############################################################################
# Local Dashboard Auto-Update Script
#
# Periodically regenerates the dashboard and optionally deploys to Kindle
# Usage: ./watch-and-update.sh [options]
##############################################################################

# Configuration
UPDATE_INTERVAL=300  # Default: 5 minutes (300 seconds)
LAYOUT="weather"     # Default layout
AUTO_DEPLOY=false    # Auto-deploy to Kindle
AUTO_TEST=false      # Auto-display in local viewer
VERBOSE=false

# Script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/watch-update.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Function to log messages
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

# Function to show usage
show_usage() {
    cat << EOF
Local Dashboard Auto-Update Script

USAGE:
    $0 [OPTIONS]

OPTIONS:
    -i, --interval SECONDS    Update interval in seconds (default: 300 = 5 minutes)
    -l, --layout LAYOUT       Dashboard layout (default: weather)
    -d, --deploy              Auto-deploy to Kindle after generation
    -t, --test                Auto-display in local viewer after generation
    -v, --verbose             Verbose logging
    -h, --help                Show this help

EXAMPLES:
    $0                                    # Update every 5 minutes (weather layout)
    $0 -i 600                             # Update every 10 minutes
    $0 -i 300 -l compact                  # Update every 5 minutes with compact layout
    $0 -i 300 -d                          # Update and auto-deploy to Kindle
    $0 -i 120 -t                          # Update every 2 minutes and preview locally

KEYBOARD SHORTCUTS:
    Ctrl+C                                # Stop the watch process

EOF
}

# Parse command line arguments
while [ $# -gt 0 ]; do
    case $1 in
        -i|--interval)
            UPDATE_INTERVAL="$2"
            shift 2
            ;;
        -l|--layout)
            LAYOUT="$2"
            shift 2
            ;;
        -d|--deploy)
            AUTO_DEPLOY=true
            shift
            ;;
        -t|--test)
            AUTO_TEST=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
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

# Function to generate dashboard
generate_dashboard() {
    local gen_start=$(date +%s)

    log_message "🔄 Generating dashboard (layout: $LAYOUT)..."

    # Build command with options
    local cmd="node $SCRIPT_DIR/server/generate-flexible-dashboard.js $LAYOUT"

    if [ "$AUTO_TEST" = "true" ]; then
        cmd="$cmd --test"
    fi

    if [ "$VERBOSE" = "true" ]; then
        $cmd 2>&1 | tee -a "$LOG_FILE"
    else
        $cmd >> "$LOG_FILE" 2>&1
    fi

    local gen_status=$?
    local gen_end=$(date +%s)
    local gen_duration=$((gen_end - gen_start))

    if [ $gen_status -eq 0 ]; then
        log_message "✅ Dashboard generated successfully (took ${gen_duration}s)"
        return 0
    else
        log_message "❌ Dashboard generation failed (exit code: $gen_status)"
        return 1
    fi
}

# Function to deploy to Kindle
deploy_to_kindle() {
    if [ "$AUTO_DEPLOY" != "true" ]; then
        return 0
    fi

    log_message "📤 Deploying to Kindle..."

    if [ "$VERBOSE" = "true" ]; then
        "$SCRIPT_DIR/generate-and-test.sh" --deploy 2>&1 | tee -a "$LOG_FILE"
    else
        "$SCRIPT_DIR/generate-and-test.sh" --deploy >> "$LOG_FILE" 2>&1
    fi

    if [ $? -eq 0 ]; then
        log_message "✅ Deployed to Kindle successfully"
        return 0
    else
        log_message "❌ Kindle deployment failed"
        return 1
    fi
}

# Function to update dashboard (generate + optional deploy)
update_dashboard() {
    local update_start=$(date +%s)

    log_message "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_message "🚀 Starting dashboard update cycle"

    if generate_dashboard; then
        deploy_to_kindle
    fi

    local update_end=$(date +%s)
    local update_duration=$((update_end - update_start))

    log_message "⏱️  Update cycle completed (took ${update_duration}s)"
    log_message "⏰ Next update in ${UPDATE_INTERVAL}s"
    log_message ""
}

# Trap Ctrl+C for clean shutdown
trap 'echo ""; log_message "⏹️  Stopping auto-update (received SIGINT)"; exit 0' INT TERM

# Main loop
log_message "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_message "🎬 Starting local dashboard auto-update"
log_message "⚙️  Configuration:"
log_message "   - Update interval: ${UPDATE_INTERVAL}s"
log_message "   - Layout: $LAYOUT"
log_message "   - Auto-deploy: $AUTO_DEPLOY"
log_message "   - Auto-test: $AUTO_TEST"
log_message "   - Log file: $LOG_FILE"
log_message "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_message ""

# Initial update
update_dashboard

# Continuous update loop
while true; do
    sleep "$UPDATE_INTERVAL"
    update_dashboard
done
