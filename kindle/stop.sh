#!/bin/bash

##############################################################################
# Kindle Dashboard Stop Script
#
# Exits dashboard mode and restarts Kindle framework
# Run this script when you want to return to normal Kindle operation
#
# Usage: ./stop.sh [options]
##############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DASHBOARD_DIR="/mnt/us/dashboard"
LOG_FILE="${DASHBOARD_DIR}/logs/stop.log"

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

show_help() {
    cat << EOF
Kindle Dashboard Stop Script

USAGE:
    ${0} [OPTIONS]

DESCRIPTION:
    Exits dashboard mode and restarts the Kindle framework
    to return to normal Kindle operation.

OPTIONS:
    --no-framework   Skip framework restart (for testing)
    --clear-screen   Clear screen before exiting
    --backup         Backup dashboard files before cleanup
    --help           Show this help

WHAT THIS SCRIPT DOES:
    1. Displays exit message on screen
    2. Backs up dashboard files (if requested)
    3. Restarts Kindle framework
    4. Optionally clears the screen

AFTER RUNNING:
    - Kindle will return to normal operation
    - Dashboard files remain in /mnt/us/dashboard/
    - Logs are preserved for troubleshooting

EOF
}

restore_screen_sleep() {
    log_info "Re-enabling screen saver for normal Kindle operation..."

    # Re-enable screensaver using lipc-set-prop (use full path for Kindle compatibility)
    if [ -x "/usr/bin/lipc-set-prop" ]; then
        if /usr/bin/lipc-set-prop com.lab126.powerd preventScreenSaver 0; then
            log_info "Screen saver prevention disabled successfully"
        else
            log_warn "Failed to re-enable screen saver via lipc-set-prop"
        fi
    else
        log_warn "lipc-set-prop command not found - screen sleep behavior unchanged"
    fi
}

restore_wifi_power_management() {
    log_info "Re-enabling WiFi power management for normal operation..."

    # Restore normal WiFi power management
    if [ -x "/usr/bin/lipc-set-prop" ]; then
        # Disable WiFi keep-alive (restore normal power saving)
        if /usr/bin/lipc-set-prop com.lab126.powerd keepAliveWirelessRadio 0; then
            log_info "WiFi keep-alive disabled - power management restored"
        else
            log_warn "Failed to disable WiFi keep-alive"
        fi
    else
        log_warn "lipc-set-prop command not found - WiFi power management unchanged"
    fi

    # Re-enable wireless power management at driver level
    if command -v iwconfig >/dev/null 2>&1; then
        local wifi_interface=$(iwconfig 2>/dev/null | grep -o "^[a-z0-9]*" | head -1)
        if [ -n "${wifi_interface}" ]; then
            log_info "Re-enabling WiFi power management on ${wifi_interface}"
            if iwconfig "${wifi_interface}" power on 2>/dev/null; then
                log_info "WiFi power management re-enabled at driver level"
            else
                log_warn "Could not re-enable WiFi power management at driver level"
            fi
        fi
    fi
}

display_exit_message() {
    log_info "Displaying exit message on screen..."

    # Create a simple exit message image if eips is available
    if [ -x "/usr/sbin/eips" ]; then
        # Try to display a simple text message
        if command -v eips >/dev/null 2>&1; then
            # Clear screen first
            eips -c

            # Display exit message
            eips 10 10 "Dashboard Mode Exited"
            eips 10 12 "Returning to Kindle..."
            eips 10 14 "$(date '+%Y-%m-%d %H:%M:%S')"

            log_info "Exit message displayed"
            sleep 2
        fi
    else
        log_warn "eips not available - cannot display exit message"
    fi
}

backup_dashboard_files() {
    if [ "$1" = "true" ]; then
        log_info "Backing up dashboard files..."

        local backup_dir="${DASHBOARD_DIR}/backup/$(date '+%Y%m%d_%H%M%S')"

        if [ ! -d "${backup_dir}" ]; then
            mkdir -p "${backup_dir}"
        fi

        # Backup current images
        for file in "${DASHBOARD_DIR}/current.png" "${DASHBOARD_DIR}/previous.png" "${DASHBOARD_DIR}/logs/fetch.log"; do
            if [ -f "${file}" ]; then
                local basename=$(basename "${file}")
                cp "${file}" "${backup_dir}/${basename}"
                log_info "Backed up: ${basename}"
            fi
        done

        log_info "Backup completed: ${backup_dir}"
    else
        log_info "Skipping backup (not requested)"
    fi
}

start_framework() {
    if [ "$1" = "true" ]; then
        log_info "Starting Kindle framework..."

        # Try upstart method first (Kindle Touch uses this)
        if [ -x "/sbin/start" ] && [ -f "/etc/upstart/framework" ]; then
            if /sbin/start framework 2>/dev/null; then
                log_info "Framework started successfully (upstart)"
                # Give framework time to initialize
                sleep 3
                return 0
            fi
        fi

        # Fall back to init.d method
        if [ -f "/etc/init.d/framework" ]; then
            if /etc/init.d/framework start; then
                log_info "Framework started successfully (init.d)"
                # Give framework time to initialize
                sleep 3
                return 0
            else
                log_error "Failed to start framework"
                return 1
            fi
        fi

        log_warn "Framework service not found"
    else
        log_info "Skipping framework start (--no-framework specified)"
    fi
}

clear_screen() {
    if [ "$1" = "true" ]; then
        log_info "Clearing screen..."

        if [ -x "/usr/sbin/eips" ]; then
            # Multi-pass clear for thorough cleaning
            if /usr/sbin/eips -c; then
                sleep 1
                /usr/sbin/eips -f -c >/dev/null 2>&1 || true  # Full refresh clear
                log_info "Screen cleared completely"
            else
                log_warn "Failed to clear screen"
            fi
        else
            log_warn "eips not available - cannot clear screen"
        fi
    else
        log_info "Skipping screen clear (not requested)"
    fi
}

show_final_status() {
    log_info "=== Exit Summary ==="

    # Show uptime if available
    if command -v uptime >/dev/null 2>&1; then
        local uptime_info=$(uptime)
        log_info "System uptime: ${uptime_info}"
    fi

    # Show battery level if available
    if command -v gasgauge-info >/dev/null 2>&1; then
        local battery=$(gasgauge-info -c 2>/dev/null || echo "unknown")
        log_info "Battery level: ${battery}%"
    fi

    # Show disk usage
    if [ -d "${DASHBOARD_DIR}" ]; then
        local disk_usage=$(du -sh "${DASHBOARD_DIR}" 2>/dev/null | cut -f1 || echo "unknown")
        log_info "Dashboard directory size: ${disk_usage}"
    fi

    log_info "Dashboard mode has been stopped"
    log_info "Kindle should now return to normal operation"
    log_info "===================="
}

main() {
    local start_framework=true
    local clear_screen=false
    local backup_files=false

    # Parse arguments
    while [ $# -gt 0 ]; do
        case $1 in
            --no-framework)
                start_framework=false
                shift
                ;;
            --clear-screen)
                clear_screen=true
                shift
                ;;
            --backup)
                backup_files=true
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

    log_info "=== Stopping Kindle Dashboard Mode ==="

    # Re-enable screen sleep
    restore_screen_sleep

    # Restore WiFi power management
    restore_wifi_power_management

    # Display exit message
    display_exit_message

    # Backup files if requested
    backup_dashboard_files "${backup_files}"

    # Start framework
    start_framework "${start_framework}"

    # Clear screen if requested
    clear_screen "${clear_screen}"

    # Show final status
    show_final_status

    log_info "Dashboard stop script completed"
    exit 0
}

# Run main function with all arguments
main "$@"