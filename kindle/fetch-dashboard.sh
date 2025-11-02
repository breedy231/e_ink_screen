#!/bin/bash

##############################################################################
# Kindle Dashboard Fetch Script
#
# Fetches dashboard images from HTTP server and displays on e-ink screen
# Optimized for Kindle Touch (4th Generation) with jailbreak + KUAL
#
# Usage: ./fetch-dashboard.sh [options]
#
# Author: ClaudeUser
# Version: 1.0.0
##############################################################################

set -e  # Exit on error, undefined variables, pipe failures

# Script metadata
SCRIPT_NAME="fetch-dashboard"
SCRIPT_VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Default configuration
DEFAULT_CONFIG_FILE="${SCRIPT_DIR}/config/dashboard.conf"
DEFAULT_LOG_FILE="${SCRIPT_DIR}/logs/fetch.log"
DEFAULT_DASHBOARD_DIR="/mnt/us/dashboard"
DEFAULT_SERVER_HOST="192.168.1.100"
DEFAULT_SERVER_PORT="3000"
DEFAULT_TIMEOUT="30"
DEFAULT_RETRIES="3"
DEFAULT_BACKUP_IMAGE="${SCRIPT_DIR}/fallback.png"

# Global variables (will be set from config or command line)
CONFIG_FILE=""
LOG_FILE=""
DASHBOARD_DIR=""
SERVER_HOST=""
SERVER_PORT=""
SERVER_URL=""
TIMEOUT=""
RETRIES=""
BACKUP_IMAGE=""
VERBOSE=false
DRY_RUN=false
FORCE_REFRESH=false
INCLUDE_GRID=false
QUIET=false

##############################################################################
# Logging Functions
##############################################################################

log_message() {
    local level="$1"
    local message="$2"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    # Format: [TIMESTAMP] [LEVEL] MESSAGE
    local log_entry="[${timestamp}] [${level}] ${message}"

    # Write to log file if specified
    if [ -n "${LOG_FILE:-}" ] && [ -w "$(dirname "${LOG_FILE}")" ]; then
        echo "${log_entry}" >> "${LOG_FILE}"
    fi

    # Write to stdout/stderr based on level and quiet setting
    if [ "${QUIET}" != "true" ]; then
        case "${level}" in
            "ERROR"|"FATAL")
                echo "${log_entry}" >&2
                ;;
            "WARN")
                echo "${log_entry}" >&2
                ;;
            "INFO")
                echo "${log_entry}"
                ;;
            "DEBUG")
                if [ "${VERBOSE}" = "true" ]; then
                    echo "${log_entry}"
                fi
                ;;
        esac
    fi
}

log_info() {
    log_message "INFO" "$1"
}

log_warn() {
    log_message "WARN" "$1"
}

log_error() {
    log_message "ERROR" "$1"
}

log_debug() {
    log_message "DEBUG" "$1"
}

log_fatal() {
    log_message "FATAL" "$1"
    exit 1
}

##############################################################################
# Configuration Functions
##############################################################################

load_config() {
    local config_file="${1:-${DEFAULT_CONFIG_FILE}}"

    if [ -f "${config_file}" ]; then
        log_debug "Loading configuration from: ${config_file}"

        # Source config file safely
        # Source config file
        . "${config_file}"

        log_debug "Configuration loaded successfully"
    else
        log_warn "Configuration file not found: ${config_file}"
        log_info "Using default configuration"
    fi

    # Set defaults for any undefined variables
    CONFIG_FILE="${config_file}"
    LOG_FILE="${LOG_FILE:-${DEFAULT_LOG_FILE}}"
    DASHBOARD_DIR="${DASHBOARD_DIR:-${DEFAULT_DASHBOARD_DIR}}"
    SERVER_HOST="${SERVER_HOST:-${DEFAULT_SERVER_HOST}}"
    SERVER_PORT="${SERVER_PORT:-${DEFAULT_SERVER_PORT}}"
    TIMEOUT="${TIMEOUT:-${DEFAULT_TIMEOUT}}"
    RETRIES="${RETRIES:-${DEFAULT_RETRIES}}"
    BACKUP_IMAGE="${BACKUP_IMAGE:-${DEFAULT_BACKUP_IMAGE}}"

    # Construct server URL
    SERVER_URL="http://${SERVER_HOST}:${SERVER_PORT}"

    log_debug "Final configuration:"
    log_debug "  SERVER_URL: ${SERVER_URL}"
    log_debug "  DASHBOARD_DIR: ${DASHBOARD_DIR}"
    log_debug "  LOG_FILE: ${LOG_FILE}"
    log_debug "  TIMEOUT: ${TIMEOUT}s"
    log_debug "  RETRIES: ${RETRIES}"
}

##############################################################################
# Utility Functions
##############################################################################

show_help() {
    cat << EOF
Kindle Dashboard Fetch Script v${SCRIPT_VERSION}

USAGE:
    ${0} [OPTIONS]

DESCRIPTION:
    Fetches dashboard images from HTTP server and displays them on Kindle e-ink screen.
    Designed for Kindle Touch (4th Generation) with jailbreak and KUAL.

OPTIONS:
    -c, --config FILE       Configuration file (default: ${DEFAULT_CONFIG_FILE})
    -h, --host HOST         Server hostname/IP (default: ${DEFAULT_SERVER_HOST})
    -p, --port PORT         Server port (default: ${DEFAULT_SERVER_PORT})
    -d, --dir DIR           Dashboard directory (default: ${DEFAULT_DASHBOARD_DIR})
    -l, --log FILE          Log file path (default: ${DEFAULT_LOG_FILE})
    -t, --timeout SECONDS   Network timeout (default: ${DEFAULT_TIMEOUT})
    -r, --retries COUNT     Retry attempts (default: ${DEFAULT_RETRIES})
    -g, --grid              Include test grid in dashboard
    -f, --force             Force refresh (ignore cache)
    -v, --verbose           Verbose logging
    -q, --quiet             Quiet mode (minimal output)
    -n, --dry-run           Simulate actions without executing
    --help                  Show this help message

EXAMPLES:
    ${0}                                    # Use default settings
    ${0} --host 192.168.1.100 --port 8080  # Custom server
    ${0} --grid --verbose                   # Debug mode with test grid
    ${0} --dry-run                          # Test configuration

FILES:
    ${DEFAULT_CONFIG_FILE}     Configuration file
    ${DEFAULT_LOG_FILE}        Log file
    ${DEFAULT_DASHBOARD_DIR}/current.png    Current dashboard image
    ${DEFAULT_DASHBOARD_DIR}/previous.png   Backup image

KINDLE COMMANDS:
    /usr/sbin/eips -f -g FILE              Display image (full refresh)
    /usr/sbin/eips -g FILE                 Display image (partial refresh)

EOF
}

check_dependencies() {
    local missing_deps=""

    # Check for required commands one by one using which (more reliable on Kindle)
    for cmd in wget date mkdir chmod mv cp; do
        if ! which "${cmd}" >/dev/null 2>&1; then
            missing_deps="${missing_deps} ${cmd}"
        fi
    done

    # Check for Kindle-specific commands
    if [ -f "/usr/sbin/eips" ]; then
        log_debug "Found eips command for image display"
    else
        log_warn "eips command not found - running outside Kindle environment?"
    fi

    if [ -n "${missing_deps}" ]; then
        log_fatal "Missing required dependencies:${missing_deps}"
    fi

    log_debug "All dependencies satisfied"
}

ensure_directories() {
    # Create directories one by one
    for dir in "${DASHBOARD_DIR}" "$(dirname "${LOG_FILE}")"; do
        if [ ! -d "${dir}" ]; then
            log_info "Creating directory: ${dir}"
            if [ "${DRY_RUN}" != "true" ]; then
                mkdir -p "${dir}"
            fi
        fi
    done
}

##############################################################################
# Network Functions
##############################################################################

check_network_connectivity() {
    log_debug "Checking network connectivity..."

    # Test basic connectivity with ping
    if command -v ping >/dev/null 2>&1; then
        if ping -c 1 -W 5 "${SERVER_HOST}" >/dev/null 2>&1; then
            log_debug "Host ${SERVER_HOST} is reachable"
        else
            log_warn "Host ${SERVER_HOST} is not reachable via ping"
            return 1
        fi
    else
        log_debug "ping command not available, skipping connectivity test"
    fi

    # Test HTTP connectivity
    local health_url="${SERVER_URL}/health"
    log_debug "Testing HTTP connectivity: ${health_url}"

    # Try wget with actual download to /tmp (busybox-compatible short options)
    local health_check="/tmp/health_check.tmp"
    if wget -q -O "${health_check}" "${health_url}" 2>/dev/null; then
        rm -f "${health_check}"
        log_debug "HTTP server is accessible (via wget)"
        return 0
    fi
    rm -f "${health_check}"

    # Fallback to curl if wget fails
    if command -v curl >/dev/null 2>&1; then
        if curl --silent --fail --max-time 10 "${health_url}" >/dev/null 2>&1; then
            log_debug "HTTP server is accessible (via curl)"
            return 0
        fi
    fi

    log_error "HTTP server is not accessible: ${health_url}"
    return 1
}

##############################################################################
# Image Functions
##############################################################################

download_dashboard() {
    local dashboard_url="${SERVER_URL}/dashboard"
    local temp_file="${DASHBOARD_DIR}/dashboard_temp.png"
    local current_file="${DASHBOARD_DIR}/current.png"

    # Add grid parameter if requested
    if [ "${INCLUDE_GRID}" = "true" ]; then
        dashboard_url="${dashboard_url}?grid=true"
        log_debug "Including test grid in dashboard"
    fi

    # Add force refresh parameter
    if [ "${FORCE_REFRESH}" = "true" ]; then
        local timestamp=$(date +%s)
        local separator="?"
        if [ "${dashboard_url}" = *"?"* ]; then
            separator="&"
        fi
        dashboard_url="${dashboard_url}${separator}t=${timestamp}"
        log_debug "Force refresh enabled"
    fi

    log_info "Downloading dashboard from: ${dashboard_url}"

    # Attempt download with retries
    local attempt=1
    while [ ${attempt} -le ${RETRIES} ]; do
        log_debug "Download attempt ${attempt}/${RETRIES}"

        if [ "${DRY_RUN}" = "true" ]; then
            log_info "[DRY-RUN] Would download: ${dashboard_url} -> ${temp_file}"
            return 0
        fi

        # Use wget for download (busybox-compatible short options)
        # Note: busybox wget doesn't support --timeout or --tries
        if wget -q -O "${temp_file}" "${dashboard_url}" 2>/dev/null; then

            log_info "Dashboard downloaded successfully (${attempt}/${RETRIES})"

            # Verify downloaded file
            if verify_image "${temp_file}"; then
                # Move temp file to current
                mv "${temp_file}" "${current_file}"
                log_info "Dashboard saved to: ${current_file}"
                return 0
            else
                log_error "Downloaded file verification failed"
                rm -f "${temp_file}"
            fi
        else
            log_warn "Download attempt ${attempt} failed"
        fi

        attempt=$((attempt + 1))

        # Wait before retry (except on last attempt)
        if [ ${attempt} -le ${RETRIES} ]; then
            local wait_time=$((attempt * 2))
            log_debug "Waiting ${wait_time} seconds before retry..."
            sleep "${wait_time}"
        fi
    done

    log_error "Failed to download dashboard after ${RETRIES} attempts"
    return 1
}

verify_image() {
    local image_file="$1"

    if [ ! -f "${image_file}" ]; then
        log_error "Image file does not exist: ${image_file}"
        return 1
    fi

    # Check file size (should be > 1KB for valid PNG)
    local file_size=$(stat -f%z "${image_file}" 2>/dev/null || stat -c%s "${image_file}" 2>/dev/null || echo "0")
    if [ ${file_size} -lt 1024 ]; then
        log_error "Image file too small: ${file_size} bytes"
        return 1
    fi

    # Check PNG header
    if command -v file >/dev/null 2>&1; then
        local file_type=$(file -b "${image_file}")
        if [ "${file_type}" != *"PNG"* ]; then
            log_error "Invalid image format: ${file_type}"
            return 1
        fi
    fi

    log_debug "Image verification passed: ${file_size} bytes"
    return 0
}

clear_screen_before_display() {
    log_debug "Pre-clearing screen to ensure clean display..."

    # Single pass clear before image display
    if [ -x "/usr/sbin/eips" ]; then
        /usr/sbin/eips -c >/dev/null 2>&1 || true
        sleep 1  # Brief pause for e-ink settling (integer seconds only)
    fi
}

display_image() {
    local image_file="$1"
    local refresh_type="${2:-full}"

    if [ ! -f "${image_file}" ]; then
        log_error "Cannot display image - file not found: ${image_file}"
        return 1
    fi

    log_info "Displaying image: ${image_file}"

    if [ "${DRY_RUN}" = "true" ]; then
        log_info "[DRY-RUN] Would display image with eips: ${image_file}"
        return 0
    fi

    # Check if eips command exists
    if [ ! -x "/usr/sbin/eips" ]; then
        log_warn "eips command not found - cannot display image"
        return 1
    fi

    # Clear screen before displaying new image
    clear_screen_before_display

    # Display image using eips
    local eips_args="-g"
    if [ "${refresh_type}" = "full" ]; then
        eips_args="-f -g"
        log_debug "Using full refresh"
    else
        log_debug "Using partial refresh"
    fi

    if /usr/sbin/eips ${eips_args} "${image_file}"; then
        log_info "Image displayed successfully"

        # For full refresh, add a second pass to ensure complete rendering
        if [ "${refresh_type}" = "full" ]; then
            sleep 1
            /usr/sbin/eips -f -g "${image_file}" >/dev/null 2>&1 || true
            log_debug "Secondary full refresh pass completed"
        fi

        return 0
    else
        log_error "Failed to display image"
        return 1
    fi
}

handle_fallback() {
    local current_file="${DASHBOARD_DIR}/current.png"
    local previous_file="${DASHBOARD_DIR}/previous.png"

    log_warn "Attempting fallback image display..."

    # Try previous image first
    if [ -f "${previous_file}" ]; then
        log_info "Using previous dashboard image"
        if display_image "${previous_file}" "partial"; then
            return 0
        fi
    fi

    # Try backup image
    if [ -f "${BACKUP_IMAGE}" ]; then
        log_info "Using backup image: ${BACKUP_IMAGE}"
        if display_image "${BACKUP_IMAGE}" "partial"; then
            return 0
        fi
    fi

    # Try any PNG in dashboard directory
    if [ ! -d "${DASHBOARD_DIR}" ]; then
        log_debug "Dashboard directory doesn't exist, no fallback images available"
    else
        for image in "${DASHBOARD_DIR}"/*.png; do
            if [ -f "${image}" && "${image}" != "${current_file}" ]; then
                log_info "Trying fallback image: ${image}"
                if display_image "${image}" "partial"; then
                    return 0
                fi
            fi
        done
    fi

    log_error "No fallback images available"
    return 1
}

##############################################################################
# Main Functions
##############################################################################

backup_current_image() {
    local current_file="${DASHBOARD_DIR}/current.png"
    local previous_file="${DASHBOARD_DIR}/previous.png"

    if [ -f "${current_file}" ]; then
        log_debug "Backing up current image"
        if [ "${DRY_RUN}" != "true" ]; then
            cp "${current_file}" "${previous_file}"
        fi
    fi
}

ensure_no_sleep_during_update() {
    log_debug "Temporarily disabling screen saver during update..."

    # Prevent screensaver during the update process
    if command -v lipc-set-prop >/dev/null 2>&1; then
        lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1 || true
    fi
}

main() {
    log_info "=== Kindle Dashboard Fetch Script v${SCRIPT_VERSION} ==="
    log_info "Starting dashboard update process..."

    # Check dependencies
    check_dependencies

    # Ensure directories exist
    ensure_directories

    # Prevent sleep during update
    ensure_no_sleep_during_update

    # Backup current image before attempting update
    backup_current_image

    # Check network connectivity
    if ! check_network_connectivity; then
        log_error "Network connectivity check failed"
        handle_fallback
        return 1
    fi

    # Download new dashboard
    if download_dashboard; then
        local current_file="${DASHBOARD_DIR}/current.png"

        # Display the new image
        if display_image "${current_file}" "full"; then
            log_info "Dashboard update completed successfully"
            return 0
        else
            log_error "Failed to display new dashboard"
            handle_fallback
            return 1
        fi
    else
        log_error "Failed to download dashboard"
        handle_fallback
        return 1
    fi
}

##############################################################################
# Command Line Parsing
##############################################################################

parse_args() {
    while [ $# -gt 0 ]; do
        case $1 in
            -c|--config)
                CONFIG_FILE="$2"
                shift 2
                ;;
            -h|--host)
                SERVER_HOST="$2"
                shift 2
                ;;
            -p|--port)
                SERVER_PORT="$2"
                shift 2
                ;;
            -d|--dir)
                DASHBOARD_DIR="$2"
                shift 2
                ;;
            -l|--log)
                LOG_FILE="$2"
                shift 2
                ;;
            -t|--timeout)
                TIMEOUT="$2"
                shift 2
                ;;
            -r|--retries)
                RETRIES="$2"
                shift 2
                ;;
            -g|--grid)
                INCLUDE_GRID=true
                shift
                ;;
            -f|--force)
                FORCE_REFRESH=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -q|--quiet)
                QUIET=true
                shift
                ;;
            -n|--dry-run)
                DRY_RUN=true
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
}

##############################################################################
# Script Entry Point
##############################################################################

# Parse command line arguments
parse_args "$@"

# Load configuration
load_config "${CONFIG_FILE}"

# Run main function
if main; then
    log_info "Script completed successfully"
    exit 0
else
    log_error "Script completed with errors"
    exit 1
fi