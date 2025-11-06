#!/bin/bash

##############################################################################
# Kindle Dashboard Start Script
#
# Prepares Kindle for dashboard mode and starts dashboard updates
# Run this script when you want to enable dashboard mode
#
# Usage: ./start.sh [options]
##############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR="/mnt/us/dashboard"
LOG_FILE="${DASHBOARD_DIR}/logs/start.log"
CONFIG_FILE="${SCRIPT_DIR}/config/dashboard.conf"

# Logging function
log_message() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local message="[${timestamp}] $1"
    echo "${message}"
    if [ -w "$(dirname "${LOG_FILE}")" ]; then
        echo "${message}" >> "${LOG_FILE}"
    fi
}

log_info() {
    log_message "[INFO] $1"
}

log_error() {
    log_message "[ERROR] $1"
}

log_warn() {
    log_message "[WARN] $1"
}

log_debug() {
    log_message "[DEBUG] $1"
}

show_help() {
    cat << EOF
Kindle Dashboard Start Script

USAGE:
    ${0} [OPTIONS]

DESCRIPTION:
    Prepares Kindle for dashboard mode by stopping framework services
    and starting the dashboard update process.

OPTIONS:
    --config FILE    Configuration file (default: ${CONFIG_FILE})
    --no-framework   Skip framework stop (for testing)
    --help           Show this help

WHAT THIS SCRIPT DOES:
    1. Creates necessary directories
    2. Stops Kindle framework (reduces power consumption)
    3. Fetches initial dashboard image
    4. Sets up for periodic updates

KINDLE PREPARATION:
    - Ensure Kindle is jailbroken with KUAL
    - Connect to Wi-Fi network
    - Configure server settings in dashboard.conf

EOF
}

check_kindle_environment() {
    log_info "Checking Kindle environment..."

    # Check if we're on a Kindle
    if [ ! -d "/mnt/us" ]; then
        log_warn "Not running on Kindle device - /mnt/us not found"
    fi

    # Check for eips command
    if [ ! -x "/usr/sbin/eips" ]; then
        log_warn "eips command not found - may not be on Kindle device"
    fi

    # Check for framework service (try both init.d and upstart locations)
    if [ ! -f "/etc/init.d/framework" ] && [ ! -f "/etc/upstart/framework" ]; then
        log_warn "framework service not found - may not be on Kindle device"
    fi

    log_info "Environment check completed"
}

prepare_directories() {
    log_info "Preparing dashboard directories..."

    # Create directories one by one (compatible with basic shell)
    for dir in "${DASHBOARD_DIR}" "${DASHBOARD_DIR}/logs" "${DASHBOARD_DIR}/config" "${DASHBOARD_DIR}/backup"; do
        if [ ! -d "${dir}" ]; then
            log_info "Creating directory: ${dir}"
            mkdir -p "${dir}"
        fi
    done

    log_info "Directory preparation completed"
}

clear_screen_completely() {
    log_info "Clearing screen to prevent UI bleed-in..."

    # Check if eips command exists
    if [ ! -x "/usr/sbin/eips" ]; then
        log_warn "eips command not found - cannot clear screen"
        return 1
    fi

    # Multiple-pass screen clearing for stubborn UI elements
    log_debug "Performing multi-pass screen clear..."

    # Pass 1: Basic clear
    if /usr/sbin/eips -c; then
        log_debug "Screen clear pass 1 completed"
    else
        log_warn "Screen clear pass 1 failed"
    fi

    # Brief pause for e-ink settling
    sleep 1

    # Pass 2: Force clear with full refresh
    if /usr/sbin/eips -f -c; then
        log_debug "Screen clear pass 2 (full refresh) completed"
    else
        log_warn "Screen clear pass 2 failed"
    fi

    # Pass 3: Additional clear for stubborn elements
    sleep 1
    if /usr/sbin/eips -c; then
        log_debug "Screen clear pass 3 completed"
        log_info "Multi-pass screen clearing completed"
        return 0
    else
        log_warn "Screen clear pass 3 failed"
        return 1
    fi
}

prevent_screen_sleep() {
    log_info "Disabling screen saver to keep dashboard visible..."

    # Prevent screensaver using lipc-set-prop (use full path for Kindle compatibility)
    if [ -x "/usr/bin/lipc-set-prop" ]; then
        if /usr/bin/lipc-set-prop com.lab126.powerd preventScreenSaver 1; then
            log_info "Screen saver prevention enabled successfully"
        else
            log_warn "Failed to prevent screen saver via lipc-set-prop"
        fi
    else
        log_warn "lipc-set-prop command not found - screen may sleep after timeout"
    fi

    # Also try to disable powerd sleep functionality as backup
    if [ -w "/sys/power/state" ]; then
        log_debug "Power management interfaces available"
    else
        log_debug "Power management interfaces not writable"
    fi
}

keep_wifi_alive() {
    log_info "Configuring WiFi to stay active during dashboard mode..."

    # Prevent WiFi from sleeping to ensure cron jobs can fetch updates
    if [ -x "/usr/bin/lipc-set-prop" ]; then
        # Disable WiFi power management
        if /usr/bin/lipc-set-prop com.lab126.cmd wirelessEnable 1; then
            log_info "WiFi force-enabled successfully"
        else
            log_warn "Failed to force-enable WiFi via lipc-set-prop"
        fi

        # Keep wireless radio active (prevents sleep)
        if /usr/bin/lipc-set-prop com.lab126.powerd keepAliveWirelessRadio 1; then
            log_info "WiFi keep-alive enabled successfully"
        else
            log_warn "Failed to enable WiFi keep-alive"
        fi
    else
        log_warn "lipc-set-prop command not found - WiFi may sleep during power saving"
    fi

    # Disable wireless power management at driver level as backup
    if command -v iwconfig >/dev/null 2>&1; then
        local wifi_interface=$(iwconfig 2>/dev/null | grep -o "^[a-z0-9]*" | head -1)
        if [ -n "${wifi_interface}" ]; then
            log_debug "Found WiFi interface: ${wifi_interface}"
            if iwconfig "${wifi_interface}" power off 2>/dev/null; then
                log_info "WiFi power management disabled at driver level"
            else
                log_debug "Could not disable WiFi power management at driver level"
            fi
        fi
    fi
}

stop_framework() {
    if [ "$1" = "true" ]; then
        log_info "Stopping Kindle framework to reduce power consumption..."

        # Try upstart method first (Kindle Touch uses this)
        if [ -x "/sbin/stop" ] && [ -f "/etc/upstart/framework" ]; then
            if /sbin/stop framework 2>/dev/null; then
                log_info "Framework stopped successfully (upstart)"
                return 0
            fi
        fi

        # Fall back to init.d method
        if [ -f "/etc/init.d/framework" ]; then
            if /etc/init.d/framework stop; then
                log_info "Framework stopped successfully (init.d)"
                return 0
            else
                log_error "Failed to stop framework"
                return 1
            fi
        fi

        log_warn "Framework service not found"
    else
        log_info "Skipping framework stop (--no-framework specified)"
    fi
}

initial_dashboard_fetch() {
    log_info "Fetching initial dashboard image..."

    local fetch_script="${SCRIPT_DIR}/fetch-dashboard.sh"

    if [ -x "${fetch_script}" ]; then
        if "${fetch_script}" --config "${CONFIG_FILE}" --verbose; then
            log_info "Initial dashboard fetch completed successfully"
            return 0
        else
            log_error "Initial dashboard fetch failed"
            return 1
        fi
    else
        log_error "Fetch script not found or not executable: ${fetch_script}"
        return 1
    fi
}

display_status() {
    log_info "=== Dashboard Status ==="

    # Show current image info
    local current_image="${DASHBOARD_DIR}/current.png"
    if [ -f "${current_image}" ]; then
        local size=$(stat -f%z "${current_image}" 2>/dev/null || stat -c%s "${current_image}" 2>/dev/null || echo "unknown")
        local modified=$(stat -f%Sm "${current_image}" 2>/dev/null || stat -c%y "${current_image}" 2>/dev/null || echo "unknown")
        log_info "Current image: ${size} bytes, modified: ${modified}"
    else
        log_warn "No current dashboard image found"
    fi

    # Show log file info
    if [ -f "${LOG_FILE}" ]; then
        local log_lines=$(wc -l < "${LOG_FILE}" 2>/dev/null || echo "unknown")
        log_info "Log file: ${log_lines} lines"
    fi

    # Show battery level if available
    if command -v gasgauge-info >/dev/null 2>&1; then
        local battery=$(gasgauge-info -c 2>/dev/null || echo "unknown")
        log_info "Battery level: ${battery}%"
    fi

    log_info "==========================="
}

main() {
    local stop_framework=true
    local config_file="${CONFIG_FILE}"

    # Parse arguments
    while [ $# -gt 0 ]; do
        case $1 in
            --config)
                config_file="$2"
                shift 2
                ;;
            --no-framework)
                stop_framework=false
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    log_info "=== Starting Kindle Dashboard Mode ==="

    # Check environment
    check_kindle_environment

    # Prepare directories
    prepare_directories

    # Stop framework if requested
    stop_framework "${stop_framework}"

    # Clear screen completely to prevent UI bleed-in (after framework stop)
    clear_screen_completely

    # Prevent screen sleep to keep dashboard visible (after screen clear)
    prevent_screen_sleep

    # Keep WiFi alive to ensure cron jobs can fetch updates
    keep_wifi_alive

    # Fetch initial dashboard
    if initial_dashboard_fetch; then
        log_info "Dashboard mode started successfully"
        display_status
        log_info "Use ./fetch-dashboard.sh to update dashboard manually"
        log_info "Use ./stop.sh to exit dashboard mode"
        exit 0
    else
        log_error "Failed to start dashboard mode"
        exit 1
    fi
}

# Run main function with all arguments
main "$@"