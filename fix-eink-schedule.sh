#!/bin/bash

##############################################################################
# E-ink Dashboard Schedule Fix Deployment Script
#
# This script fixes two critical issues:
# 1. Changes update schedule from 24/7 to 7am-10pm (Central Time)
# 2. Prevents WiFi from sleeping when dashboard mode is active
#
# Usage: ./fix-eink-schedule.sh [--skip-checks]
#
# Options:
#   --skip-checks  Skip connectivity checks (use if checks fail but SSH works)
##############################################################################

set -e

KINDLE_IP="192.168.50.104"
KINDLE_USER="root"
PI_SERVER="192.168.50.163"
KINDLE_DASH_DIR="/mnt/us/dashboard"
SKIP_CHECKS=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-checks)
            SKIP_CHECKS=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--skip-checks]"
            exit 1
            ;;
    esac
done

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_connectivity() {
    log_step "Checking connectivity to Kindle and Pi server..."

    # Check Kindle connectivity via SSH (more reliable than ping)
    if ssh -o ConnectTimeout=5 -o BatchMode=yes "${KINDLE_USER}@${KINDLE_IP}" "exit" >/dev/null 2>&1; then
        log_info "✓ Kindle is reachable at $KINDLE_IP"
    else
        log_error "Cannot SSH to Kindle at $KINDLE_IP"
        log_error "Make sure Kindle is on and connected to WiFi"
        log_error "Verify SSH access with: ssh ${KINDLE_USER}@${KINDLE_IP}"
        exit 1
    fi

    # Check Pi server connectivity (try ping first, fallback to curl)
    if command -v ping >/dev/null 2>&1 && ping -c 1 -W 2 "$PI_SERVER" >/dev/null 2>&1; then
        log_info "✓ Raspberry Pi is reachable at $PI_SERVER"
    elif curl -s --max-time 5 "http://$PI_SERVER:3000/health" >/dev/null 2>&1; then
        log_info "✓ Pi server is responding on port 3000"
    else
        log_warn "Warning: Cannot verify Pi server connectivity"
        log_warn "Will proceed, but verify server is running"
    fi
}

backup_current_config() {
    log_step "Backing up current Kindle configuration..."

    BACKUP_DIR="backup/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"

    # Backup current crontab from Kindle
    if ssh "${KINDLE_USER}@${KINDLE_IP}" "crontab -l" > "$BACKUP_DIR/crontab_before.txt" 2>/dev/null; then
        log_info "✓ Backed up current crontab to $BACKUP_DIR/crontab_before.txt"
    else
        log_warn "Could not backup crontab (may not exist yet)"
    fi

    # Backup current start.sh and stop.sh
    for script in start.sh stop.sh; do
        if ssh "${KINDLE_USER}@${KINDLE_IP}" "test -f $KINDLE_DASH_DIR/$script" 2>/dev/null; then
            scp "${KINDLE_USER}@${KINDLE_IP}:$KINDLE_DASH_DIR/$script" "$BACKUP_DIR/" >/dev/null 2>&1
            log_info "✓ Backed up $script"
        fi
    done

    log_info "Backup completed in $BACKUP_DIR"
}

deploy_updated_scripts() {
    log_step "Deploying updated scripts to Kindle..."

    # Deploy updated start.sh (with WiFi keep-alive)
    if scp kindle/start.sh "${KINDLE_USER}@${KINDLE_IP}:$KINDLE_DASH_DIR/" >/dev/null 2>&1; then
        log_info "✓ Deployed start.sh with WiFi keep-alive"
    else
        log_error "Failed to deploy start.sh"
        exit 1
    fi

    # Deploy updated stop.sh (with WiFi power management restore)
    if scp kindle/stop.sh "${KINDLE_USER}@${KINDLE_IP}:$KINDLE_DASH_DIR/" >/dev/null 2>&1; then
        log_info "✓ Deployed stop.sh with WiFi restore"
    else
        log_error "Failed to deploy stop.sh"
        exit 1
    fi

    # Deploy setup-local-cron.sh (with Pi server IP)
    if scp kindle/setup-local-cron.sh "${KINDLE_USER}@${KINDLE_IP}:$KINDLE_DASH_DIR/" >/dev/null 2>&1; then
        log_info "✓ Deployed setup-local-cron.sh"
    else
        log_error "Failed to deploy setup-local-cron.sh"
        exit 1
    fi

    # Make scripts executable
    ssh "${KINDLE_USER}@${KINDLE_IP}" "chmod +x $KINDLE_DASH_DIR/*.sh" 2>/dev/null
    log_info "✓ Made scripts executable"
}

update_cron_schedule() {
    log_step "Updating cron schedule to 7am-10pm Central Time..."

    # Run the setup script on Kindle to configure 7am-10pm schedule
    if ssh "${KINDLE_USER}@${KINDLE_IP}" "$KINDLE_DASH_DIR/setup-local-cron.sh" 2>&1 | grep -q "setup complete"; then
        log_info "✓ Cron schedule updated successfully"
    else
        log_warn "Cron setup completed but check logs for any issues"
    fi

    # Verify cron entries
    log_step "Verifying new cron schedule..."
    ssh "${KINDLE_USER}@${KINDLE_IP}" "crontab -l 2>/dev/null | grep fetch-dashboard" | while read -r line; do
        log_info "  Cron entry: $line"
    done
}

restart_dashboard_mode() {
    log_step "Restarting dashboard mode to apply WiFi fixes..."

    # Stop dashboard mode (this will restore old WiFi settings)
    log_info "Stopping dashboard mode..."
    ssh "${KINDLE_USER}@${KINDLE_IP}" "$KINDLE_DASH_DIR/stop.sh" >/dev/null 2>&1 || true
    sleep 3

    # Start dashboard mode (this will apply new WiFi keep-alive settings)
    log_info "Starting dashboard mode with new WiFi settings..."
    if ssh "${KINDLE_USER}@${KINDLE_IP}" "$KINDLE_DASH_DIR/start.sh" 2>&1 | grep -q "started successfully"; then
        log_info "✓ Dashboard mode restarted with WiFi keep-alive enabled"
    else
        log_warn "Dashboard restart completed but check logs for any issues"
    fi
}

verify_deployment() {
    log_step "Verifying deployment..."

    # Check that cron is running
    if ssh "${KINDLE_USER}@${KINDLE_IP}" "pgrep crond" >/dev/null 2>&1; then
        log_info "✓ Cron daemon is running"
    else
        log_error "Cron daemon is not running!"
        exit 1
    fi

    # Check WiFi status
    log_info "Checking WiFi status..."
    ssh "${KINDLE_USER}@${KINDLE_IP}" "iwconfig 2>/dev/null | head -5" | while read -r line; do
        log_info "  $line"
    done

    # Show next scheduled update
    log_info "Next scheduled updates:"
    ssh "${KINDLE_USER}@${KINDLE_IP}" "crontab -l 2>/dev/null | grep -E '(fetch-dashboard|^[^#])' | grep fetch" | while read -r line; do
        log_info "  $line"
    done
}

show_summary() {
    echo ""
    echo "======================================================================"
    echo -e "${GREEN}Deployment Complete!${NC}"
    echo "======================================================================"
    echo ""
    echo "Changes applied:"
    echo "  1. ✓ Update schedule changed from 24/7 to 7am-10pm Central Time"
    echo "  2. ✓ WiFi keep-alive enabled to prevent connection drops"
    echo "  3. ✓ Dashboard mode restarted with new settings"
    echo ""
    echo "Schedule details:"
    echo "  - Updates every 5 minutes during active hours (7am-10pm Central)"
    echo "  - No updates overnight (10pm-7am) to conserve battery"
    echo "  - WiFi stays connected even when unplugged from power"
    echo ""
    echo "Testing instructions:"
    echo "  1. Monitor for the next few hours to ensure updates work"
    echo "  2. Unplug Kindle from power and verify updates continue"
    echo "  3. Check battery level after 24 hours"
    echo ""
    echo "Monitoring commands:"
    echo "  # Watch auto-update log in real-time"
    echo "  ssh root@$KINDLE_IP 'tail -f $KINDLE_DASH_DIR/logs/auto-update.log'"
    echo ""
    echo "  # Check current cron schedule"
    echo "  ssh root@$KINDLE_IP 'crontab -l | grep fetch'"
    echo ""
    echo "  # Check WiFi status"
    echo "  ssh root@$KINDLE_IP 'iwconfig'"
    echo ""
    echo "  # Check battery level"
    echo "  ssh root@$KINDLE_IP 'gasgauge-info -c'"
    echo ""
    echo "Rollback (if needed):"
    echo "  # Restore previous crontab"
    echo "  cat backup/*/crontab_before.txt | ssh root@$KINDLE_IP 'crontab -'"
    echo ""
    echo "======================================================================"
}

main() {
    echo ""
    echo "======================================================================"
    echo "E-ink Dashboard Schedule Fix"
    echo "======================================================================"
    echo ""
    echo "This script will:"
    echo "  1. Change update schedule from 24/7 to 7am-10pm Central Time"
    echo "  2. Enable WiFi keep-alive to prevent connection drops"
    echo "  3. Restart dashboard mode to apply changes"
    echo ""
    echo "Target devices:"
    echo "  - Kindle: $KINDLE_IP"
    echo "  - Pi Server: $PI_SERVER"
    echo ""
    if [ "$SKIP_CHECKS" = true ]; then
        echo "⚠️  Running with --skip-checks (connectivity verification disabled)"
        echo ""
    fi
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi

    if [ "$SKIP_CHECKS" = false ]; then
        check_connectivity
    else
        log_warn "Skipping connectivity checks (--skip-checks specified)"
        log_warn "Make sure you can SSH to Kindle before proceeding"
    fi

    backup_current_config
    deploy_updated_scripts
    update_cron_schedule
    restart_dashboard_mode
    verify_deployment
    show_summary
}

main "$@"
