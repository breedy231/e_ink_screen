#!/bin/bash

##############################################################################
# Kindle Dashboard Deployment Script
#
# Deploys dashboard system to Kindle Touch (4th Generation)
# Handles file transfer, permission setting, and initial configuration
#
# Usage: ./deploy-to-kindle.sh [options]
##############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default configuration
DEFAULT_KINDLE_IP="192.168.1.xxx"  # Update with your Kindle's IP
DEFAULT_KINDLE_USER="root"
DEFAULT_SSH_KEY=""  # Optional SSH key path

# Global variables
KINDLE_IP=""
KINDLE_USER=""
SSH_KEY=""
VERBOSE=false
DRY_RUN=false
SKIP_CONFIRMATION=false

##############################################################################
# Logging Functions
##############################################################################

log_info() {
    echo "[INFO] $1"
}

log_warn() {
    echo "[WARN] $1" >&2
}

log_error() {
    echo "[ERROR] $1" >&2
}

log_debug() {
    if [[ "${VERBOSE}" == "true" ]]; then
        echo "[DEBUG] $1"
    fi
}

##############################################################################
# SSH Helper Functions
##############################################################################

build_ssh_command() {
    local ssh_cmd="ssh"

    if [[ -n "${SSH_KEY}" ]]; then
        ssh_cmd="${ssh_cmd} -i ${SSH_KEY}"
    fi

    # Add common SSH options for Kindle
    ssh_cmd="${ssh_cmd} -o ConnectTimeout=10 -o StrictHostKeyChecking=no"

    echo "${ssh_cmd} ${KINDLE_USER}@${KINDLE_IP}"
}

build_scp_command() {
    local scp_cmd="scp"

    if [[ -n "${SSH_KEY}" ]]; then
        scp_cmd="${scp_cmd} -i ${SSH_KEY}"
    fi

    # Add common SCP options
    scp_cmd="${scp_cmd} -o ConnectTimeout=10 -o StrictHostKeyChecking=no"

    echo "${scp_cmd}"
}

test_kindle_connection() {
    log_info "Testing connection to Kindle at ${KINDLE_IP}..."

    local ssh_cmd=$(build_ssh_command)

    if ${ssh_cmd} "echo 'Connection successful'" 2>/dev/null; then
        log_info "✓ SSH connection to Kindle successful"
        return 0
    else
        log_error "✗ Failed to connect to Kindle"
        log_error "Please check:"
        log_error "  1. Kindle IP address: ${KINDLE_IP}"
        log_error "  2. SSH is enabled on Kindle"
        log_error "  3. Network connectivity"
        return 1
    fi
}

##############################################################################
# Deployment Functions
##############################################################################

create_kindle_directories() {
    log_info "Creating directories on Kindle..."

    local ssh_cmd=$(build_ssh_command)
    local directories=(
        "/mnt/us/dashboard"
        "/mnt/us/dashboard/logs"
        "/mnt/us/dashboard/config"
        "/mnt/us/dashboard/backup"
        "/mnt/us/extensions/kindle-dash"
    )

    for dir in "${directories[@]}"; do
        log_debug "Creating directory: ${dir}"
        if [[ "${DRY_RUN}" != "true" ]]; then
            ${ssh_cmd} "mkdir -p '${dir}'" || {
                log_error "Failed to create directory: ${dir}"
                return 1
            }
        fi
    done

    log_info "✓ Directories created successfully"
}

deploy_scripts() {
    log_info "Deploying dashboard scripts..."

    local scp_cmd=$(build_scp_command)
    local files_to_deploy=(
        "kindle/fetch-dashboard.sh:/mnt/us/dashboard/"
        "kindle/sleep-wake-scheduler.sh:/mnt/us/dashboard/"
        "kindle/battery-monitor.sh:/mnt/us/dashboard/"
        "kindle/start.sh:/mnt/us/dashboard/"
        "kindle/stop.sh:/mnt/us/dashboard/"
    )

    for file_mapping in "${files_to_deploy[@]}"; do
        local src_file=$(echo "${file_mapping}" | cut -d':' -f1)
        local dest_path=$(echo "${file_mapping}" | cut -d':' -f2)

        if [[ ! -f "${SCRIPT_DIR}/${src_file}" ]]; then
            log_error "Source file not found: ${src_file}"
            return 1
        fi

        log_debug "Deploying: ${src_file} -> ${dest_path}"
        if [[ "${DRY_RUN}" != "true" ]]; then
            ${scp_cmd} "${SCRIPT_DIR}/${src_file}" "${KINDLE_USER}@${KINDLE_IP}:${dest_path}" || {
                log_error "Failed to deploy: ${src_file}"
                return 1
            }
        fi
    done

    log_info "✓ Scripts deployed successfully"
}

deploy_configurations() {
    log_info "Deploying configuration files..."

    local scp_cmd=$(build_scp_command)
    local config_files=(
        "kindle/config/dashboard.conf:/mnt/us/dashboard/config/"
        "kindle/config/schedule.conf:/mnt/us/dashboard/config/"
    )

    for file_mapping in "${config_files[@]}"; do
        local src_file=$(echo "${file_mapping}" | cut -d':' -f1)
        local dest_path=$(echo "${file_mapping}" | cut -d':' -f2)

        if [[ ! -f "${SCRIPT_DIR}/${src_file}" ]]; then
            log_warn "Config file not found: ${src_file}"
            continue
        fi

        log_debug "Deploying: ${src_file} -> ${dest_path}"
        if [[ "${DRY_RUN}" != "true" ]]; then
            ${scp_cmd} "${SCRIPT_DIR}/${src_file}" "${KINDLE_USER}@${KINDLE_IP}:${dest_path}" || {
                log_warn "Failed to deploy config: ${src_file}"
            }
        fi
    done

    log_info "✓ Configuration files deployed"
}

set_permissions() {
    log_info "Setting file permissions on Kindle..."

    local ssh_cmd=$(build_ssh_command)
    local executable_files=(
        "/mnt/us/dashboard/fetch-dashboard.sh"
        "/mnt/us/dashboard/sleep-wake-scheduler.sh"
        "/mnt/us/dashboard/battery-monitor.sh"
        "/mnt/us/dashboard/start.sh"
        "/mnt/us/dashboard/stop.sh"
    )

    for file in "${executable_files[@]}"; do
        log_debug "Making executable: ${file}"
        if [[ "${DRY_RUN}" != "true" ]]; then
            ${ssh_cmd} "chmod +x '${file}'" || {
                log_warn "Failed to set permissions: ${file}"
            }
        fi
    done

    log_info "✓ Permissions set successfully"
}

verify_deployment() {
    log_info "Verifying deployment..."

    local ssh_cmd=$(build_ssh_command)
    local verification_checks=(
        "ls -la /mnt/us/dashboard/"
        "ls -la /mnt/us/dashboard/config/"
        "/mnt/us/dashboard/fetch-dashboard.sh --help | head -3"
        "gasgauge-info -c || echo 'Battery info not available'"
        "ls -la /sys/devices/platform/mxc_rtc.0/ || echo 'RTC device not found'"
    )

    for check in "${verification_checks[@]}"; do
        log_debug "Running check: ${check}"
        if [[ "${DRY_RUN}" != "true" ]]; then
            ${ssh_cmd} "${check}" || {
                log_warn "Verification check failed: ${check}"
            }
        fi
    done

    log_info "✓ Deployment verification completed"
}

configure_kindle_settings() {
    log_info "Configuring Kindle-specific settings..."

    local ssh_cmd=$(build_ssh_command)

    # Update configuration files with Kindle-specific paths
    local config_updates=(
        "sed -i 's|SERVER_HOST=\".*\"|SERVER_HOST=\"${SERVER_IP:-192.168.1.100}\"|' /mnt/us/dashboard/config/dashboard.conf"
        "sed -i 's|DASHBOARD_DIR=\".*\"|DASHBOARD_DIR=\"/mnt/us/dashboard\"|' /mnt/us/dashboard/config/dashboard.conf"
    )

    for update in "${config_updates[@]}"; do
        log_debug "Applying config update: ${update}"
        if [[ "${DRY_RUN}" != "true" ]]; then
            ${ssh_cmd} "${update}" || {
                log_warn "Failed to apply config update"
            }
        fi
    done

    log_info "✓ Kindle settings configured"
}

##############################################################################
# Testing Functions
##############################################################################

run_basic_tests() {
    log_info "Running basic functionality tests..."

    local ssh_cmd=$(build_ssh_command)
    local test_commands=(
        "cd /mnt/us/dashboard && ./fetch-dashboard.sh --help | head -5"
        "cd /mnt/us/dashboard && ./sleep-wake-scheduler.sh --help | head -5"
        "cd /mnt/us/dashboard && ./battery-monitor.sh --help | head -5"
    )

    for test_cmd in "${test_commands[@]}"; do
        log_debug "Running test: ${test_cmd}"
        if [[ "${DRY_RUN}" != "true" ]]; then
            if ${ssh_cmd} "${test_cmd}"; then
                log_info "✓ Test passed"
            else
                log_warn "✗ Test failed: ${test_cmd}"
            fi
        fi
    done
}

##############################################################################
# Main Functions
##############################################################################

show_help() {
    cat << EOF
Kindle Dashboard Deployment Script

USAGE:
    ${0} [OPTIONS]

DESCRIPTION:
    Deploys the dashboard system to a Kindle Touch (4th Generation).
    Handles file transfer, permissions, and basic configuration.

OPTIONS:
    -i, --ip ADDRESS         Kindle IP address (default: prompt)
    -u, --user USER          SSH username (default: ${DEFAULT_KINDLE_USER})
    -k, --key PATH           SSH private key path (optional)
    -s, --server-ip ADDRESS  Dashboard server IP address
    -n, --dry-run            Show what would be done without executing
    -y, --yes                Skip confirmation prompts
    -v, --verbose            Verbose output
    --test-only              Only run connection and basic tests
    --help                   Show this help

PREREQUISITES:
    1. Kindle Touch (4th Generation) with jailbreak
    2. SSH access enabled on Kindle
    3. Kindle connected to same network as deployment machine
    4. Dashboard server running and accessible

EXAMPLES:
    ${0} --ip 192.168.1.150                    # Deploy to specific IP
    ${0} --ip 192.168.1.150 --server-ip 192.168.1.100  # Set server IP
    ${0} --dry-run --verbose                   # Preview deployment
    ${0} --test-only                           # Test connection only

DEPLOYMENT STEPS:
    1. Test SSH connection to Kindle
    2. Create necessary directories
    3. Deploy dashboard scripts
    4. Deploy configuration files
    5. Set file permissions
    6. Configure Kindle-specific settings
    7. Run basic functionality tests

POST-DEPLOYMENT:
    SSH to Kindle and run:
        cd /mnt/us/dashboard
        ./start.sh                             # Start dashboard mode
        ./fetch-dashboard.sh --test            # Test image fetch
        ./sleep-wake-scheduler.sh --single-cycle --test  # Test scheduler

EOF
}

get_kindle_ip() {
    if [[ -n "${KINDLE_IP}" ]]; then
        return 0
    fi

    echo "Please enter your Kindle's IP address."
    echo "You can find this in Kindle Settings > Device Options > Device Info"
    echo "or by checking your router's connected devices."
    echo
    read -p "Kindle IP address: " KINDLE_IP

    if [[ -z "${KINDLE_IP}" ]]; then
        log_error "IP address is required"
        exit 1
    fi
}

get_server_ip() {
    if [[ -n "${SERVER_IP:-}" ]]; then
        return 0
    fi

    echo
    echo "Please enter your dashboard server's IP address."
    echo "This is the machine where you'll run the HTTP server."
    echo "Leave blank to configure later manually."
    echo
    read -p "Server IP address (optional): " SERVER_IP
}

confirm_deployment() {
    if [[ "${SKIP_CONFIRMATION}" == "true" ]]; then
        return 0
    fi

    echo
    echo "=== Deployment Summary ==="
    echo "Kindle IP:      ${KINDLE_IP}"
    echo "SSH User:       ${KINDLE_USER}"
    echo "Server IP:      ${SERVER_IP:-'(to be configured later)'}"
    echo "Dry run:        ${DRY_RUN}"
    echo "=========================="
    echo

    read -p "Proceed with deployment? (y/N): " confirm
    case "${confirm}" in
        [Yy]|[Yy][Ee][Ss])
            return 0
            ;;
        *)
            log_info "Deployment cancelled"
            exit 0
            ;;
    esac
}

main() {
    local test_only=false

    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -i|--ip)
                KINDLE_IP="$2"
                shift 2
                ;;
            -u|--user)
                KINDLE_USER="$2"
                shift 2
                ;;
            -k|--key)
                SSH_KEY="$2"
                shift 2
                ;;
            -s|--server-ip)
                SERVER_IP="$2"
                shift 2
                ;;
            -n|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -y|--yes)
                SKIP_CONFIRMATION=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            --test-only)
                test_only=true
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

    # Set defaults
    KINDLE_USER="${KINDLE_USER:-${DEFAULT_KINDLE_USER}}"

    # Get required information
    get_kindle_ip
    get_server_ip

    # Confirm deployment
    confirm_deployment

    log_info "=== Starting Kindle Dashboard Deployment ==="

    # Test connection
    if ! test_kindle_connection; then
        exit 1
    fi

    # If test-only mode, stop here
    if [[ "${test_only}" == "true" ]]; then
        log_info "Connection test completed successfully"
        run_basic_tests
        exit 0
    fi

    # Execute deployment steps
    create_kindle_directories
    deploy_scripts
    deploy_configurations
    set_permissions
    configure_kindle_settings
    verify_deployment
    run_basic_tests

    log_info "=== Deployment Completed Successfully ==="
    echo
    echo "Next steps:"
    echo "1. SSH to your Kindle: ssh ${KINDLE_USER}@${KINDLE_IP}"
    echo "2. Start dashboard: cd /mnt/us/dashboard && ./start.sh"
    echo "3. Test fetch: ./fetch-dashboard.sh --test"
    echo "4. Test scheduler: ./sleep-wake-scheduler.sh --single-cycle --test"
    echo
    echo "For troubleshooting, check logs in /mnt/us/dashboard/logs/"
}

# Run main function with all arguments
main "$@"