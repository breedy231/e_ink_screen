#!/bin/bash

##############################################################################
# Pre-Deployment Validation Script
#
# Comprehensive testing before deploying e-ink schedule fix
# Run this script to validate all changes before merging to main
##############################################################################

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

VALIDATION_FAILED=0

log_section() {
    echo ""
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${BLUE}  $1${NC}"
    echo -e "${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
}

log_fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    VALIDATION_FAILED=1
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Test 1: File existence
test_required_files() {
    log_section "Test 1: Required Files"

    local required_files=(
        "kindle/start.sh"
        "kindle/stop.sh"
        "kindle/setup-local-cron.sh"
        "kindle/fetch-dashboard.sh"
        "fix-eink-schedule.sh"
        "EINK_SCHEDULE_FIX_README.md"
    )

    local all_exist=true

    for file in "${required_files[@]}"; do
        if [ -f "$file" ]; then
            log_pass "File exists: $file"
        else
            log_fail "Missing file: $file"
            all_exist=false
        fi
    done

    if [ "$all_exist" = true ]; then
        log_pass "All required files present"
    else
        log_fail "Some required files are missing"
    fi
}

# Test 2: Script syntax validation
test_script_syntax() {
    log_section "Test 2: Shell Script Syntax"

    local scripts=(
        "kindle/start.sh"
        "kindle/stop.sh"
        "kindle/setup-local-cron.sh"
        "kindle/fetch-dashboard.sh"
        "fix-eink-schedule.sh"
    )

    local all_valid=true

    for script in "${scripts[@]}"; do
        if [ -f "$script" ]; then
            if sh -n "$script" 2>/dev/null; then
                log_pass "Syntax valid: $script"
            else
                log_fail "Syntax error: $script"
                sh -n "$script" 2>&1 | head -5
                all_valid=false
            fi
        else
            log_warn "Script not found: $script"
        fi
    done

    if [ "$all_valid" = true ]; then
        log_pass "All scripts have valid syntax"
    else
        log_fail "Some scripts have syntax errors"
    fi
}

# Test 3: WiFi command validation
test_wifi_commands() {
    log_section "Test 3: WiFi Command Logic"

    if [ -x "./test-wifi-commands.sh" ]; then
        if ./test-wifi-commands.sh > /tmp/wifi_test_output.txt 2>&1; then
            log_pass "WiFi command validation passed"
            tail -15 /tmp/wifi_test_output.txt
        else
            log_fail "WiFi command validation failed"
            tail -30 /tmp/wifi_test_output.txt
        fi
    else
        log_warn "WiFi test script not found or not executable"
    fi
}

# Test 4: Cron schedule validation
test_cron_schedule() {
    log_section "Test 4: Cron Schedule Logic"

    if [ -x "./test-schedule-logic.sh" ]; then
        if ./test-schedule-logic.sh > /tmp/schedule_test_output.txt 2>&1; then
            log_pass "Cron schedule validation passed"
            # Show key results
            grep -E "(PASS|FAIL|Total|Reduction)" /tmp/schedule_test_output.txt | tail -10
        else
            log_fail "Cron schedule validation failed"
            tail -30 /tmp/schedule_test_output.txt
        fi
    else
        log_warn "Schedule test script not found or not executable"
    fi
}

# Test 5: Configuration values
test_configuration_values() {
    log_section "Test 5: Configuration Values"

    # Check setup-local-cron.sh has correct server IP
    if grep -q 'SERVER_HOST="192.168.50.163"' kindle/setup-local-cron.sh; then
        log_pass "Production server IP configured (192.168.50.163)"
    else
        log_fail "Server IP may not be set to production Pi"
        grep "SERVER_HOST=" kindle/setup-local-cron.sh
    fi

    # Check cron schedule times
    if grep -q '*/5 12-23 \* \* \*' kindle/setup-local-cron.sh; then
        log_pass "Cron schedule 1 configured (12-23 UTC)"
    else
        log_fail "Cron schedule 1 may be incorrect"
    fi

    if grep -q '*/5 0-4 \* \* \*' kindle/setup-local-cron.sh; then
        log_pass "Cron schedule 2 configured (0-4 UTC)"
    else
        log_fail "Cron schedule 2 may be incorrect"
    fi

    # Check that USE_CENTRAL_TIME is true
    if grep -q 'USE_CENTRAL_TIME=true' kindle/setup-local-cron.sh; then
        log_pass "Central Time mode enabled"
    else
        log_warn "Central Time mode may not be enabled"
    fi
}

# Test 6: Function presence in scripts
test_function_presence() {
    log_section "Test 6: Required Functions"

    # Check start.sh has keep_wifi_alive
    if grep -q "keep_wifi_alive()" kindle/start.sh; then
        log_pass "start.sh contains keep_wifi_alive() function"
    else
        log_fail "start.sh missing keep_wifi_alive() function"
    fi

    # Check stop.sh has restore_wifi_power_management
    if grep -q "restore_wifi_power_management()" kindle/stop.sh; then
        log_pass "stop.sh contains restore_wifi_power_management() function"
    else
        log_fail "stop.sh missing restore_wifi_power_management() function"
    fi

    # Check that functions are actually called (search entire file after main())
    if sed -n '/^main()/,$p' kindle/start.sh | grep -q "keep_wifi_alive"; then
        log_pass "keep_wifi_alive is called in start.sh main()"
    else
        log_fail "keep_wifi_alive may not be called in start.sh"
    fi

    if sed -n '/^main()/,$p' kindle/stop.sh | grep -q "restore_wifi_power_management"; then
        log_pass "restore_wifi_power_management is called in stop.sh main()"
    else
        log_fail "restore_wifi_power_management may not be called in stop.sh"
    fi
}

# Test 7: WiFi command correctness
test_wifi_command_correctness() {
    log_section "Test 7: WiFi Command Correctness"

    # Check for keepAliveWirelessRadio enable
    if grep -q "keepAliveWirelessRadio 1" kindle/start.sh; then
        log_pass "WiFi keep-alive enable command present"
    else
        log_fail "WiFi keep-alive enable command missing"
    fi

    # Check for keepAliveWirelessRadio disable
    if grep -q "keepAliveWirelessRadio 0" kindle/stop.sh; then
        log_pass "WiFi keep-alive disable command present"
    else
        log_fail "WiFi keep-alive disable command missing"
    fi

    # Check command symmetry
    local enable_count=$(grep -c "keepAliveWirelessRadio 1" kindle/start.sh 2>/dev/null || echo 0)
    local disable_count=$(grep -c "keepAliveWirelessRadio 0" kindle/stop.sh 2>/dev/null || echo 0)

    if [ "$enable_count" -eq "$disable_count" ] && [ "$enable_count" -gt 0 ]; then
        log_pass "WiFi commands are symmetric (enable: $enable_count, disable: $disable_count)"
    else
        log_warn "WiFi command count mismatch (enable: $enable_count, disable: $disable_count)"
    fi
}

# Test 8: POSIX compatibility
test_posix_compatibility() {
    log_section "Test 8: POSIX Shell Compatibility"

    local kindle_scripts=(
        "kindle/start.sh"
        "kindle/stop.sh"
        "kindle/setup-local-cron.sh"
        "kindle/fetch-dashboard.sh"
    )

    local issues_found=false

    for script in "${kindle_scripts[@]}"; do
        # Check for bash-specific [[ ]]
        if grep -q '\[\[' "$script" 2>/dev/null; then
            log_warn "$script uses [[ ]] (bash-specific)"
            issues_found=true
        fi

        # Check for C-style increment
        if grep -Eq '\(\([a-z_]+\+\+\)\)|\(\(\+\+[a-z_]+\)\)' "$script" 2>/dev/null; then
            log_fail "$script uses ++ operator (breaks on Kindle)"
            issues_found=true
        fi

        # Check for bash source command
        if grep -q '^[[:space:]]*source ' "$script" 2>/dev/null; then
            log_warn "$script uses 'source' (should use '.' for POSIX)"
            issues_found=true
        fi
    done

    if [ "$issues_found" = false ]; then
        log_pass "All Kindle scripts appear POSIX-compatible"
    else
        log_warn "Some POSIX compatibility issues found"
    fi
}

# Test 9: Documentation completeness
test_documentation() {
    log_section "Test 9: Documentation Completeness"

    local required_sections=(
        "Problem Summary"
        "Solutions Implemented"
        "Deployment Instructions"
        "Testing & Verification"
        "Troubleshooting"
    )

    local doc_file="EINK_SCHEDULE_FIX_README.md"

    if [ -f "$doc_file" ]; then
        local all_sections=true
        for section in "${required_sections[@]}"; do
            if grep -q "$section" "$doc_file"; then
                log_pass "Documentation includes: $section"
            else
                log_warn "Documentation may be missing: $section"
                all_sections=false
            fi
        done

        if [ "$all_sections" = true ]; then
            log_pass "All required documentation sections present"
        fi
    else
        log_fail "Documentation file not found: $doc_file"
    fi
}

# Test 10: Deployment script validation
test_deployment_script() {
    log_section "Test 10: Deployment Script"

    local deploy_script="fix-eink-schedule.sh"

    if [ -f "$deploy_script" ]; then
        # Check if executable
        if [ -x "$deploy_script" ]; then
            log_pass "Deployment script is executable"
        else
            log_warn "Deployment script is not executable (run: chmod +x $deploy_script)"
        fi

        # Check for key functions
        local required_functions=(
            "check_connectivity"
            "backup_current_config"
            "deploy_updated_scripts"
            "update_cron_schedule"
            "restart_dashboard_mode"
            "verify_deployment"
        )

        for func in "${required_functions[@]}"; do
            if grep -q "${func}()" "$deploy_script"; then
                log_pass "Deployment script has: ${func}()"
            else
                log_warn "Deployment script may be missing: ${func}()"
            fi
        done

        # Check for correct IPs
        if grep -q "192.168.50.104" "$deploy_script"; then
            log_pass "Kindle IP configured in deployment script"
        else
            log_warn "Kindle IP may not be configured"
        fi

        if grep -q "192.168.50.163" "$deploy_script"; then
            log_pass "Pi server IP configured in deployment script"
        else
            log_warn "Pi server IP may not be configured"
        fi
    else
        log_fail "Deployment script not found: $deploy_script"
    fi
}

# Test 11: Calculate expected improvements
show_expected_improvements() {
    log_section "Expected Improvements"

    echo ""
    echo "Current (Before Fix):"
    echo "  • Updates: 24/7, every 5 minutes"
    echo "  • Daily updates: 288"
    echo "  • WiFi: Disconnects when unplugged"
    echo "  • Battery: High drain"
    echo ""
    echo "After Fix:"
    echo "  • Updates: 7am-10pm Central, every 5 minutes"
    echo "  • Daily updates: 192 (33% reduction)"
    echo "  • WiFi: Stays connected via keep-alive"
    echo "  • Battery: Reduced drain from fewer updates + persistent WiFi"
    echo ""
    echo "Expected Benefits:"
    echo "  ✓ 33% fewer updates = 33% less processing/network activity"
    echo "  ✓ No overnight updates = better battery life"
    echo "  ✓ WiFi keep-alive = reliable updates when unplugged"
    echo "  ✓ Dashboard stays fresh during active hours"
    echo ""
}

# Generate test report
generate_test_report() {
    log_section "Validation Summary"

    echo ""
    if [ "$VALIDATION_FAILED" -eq 0 ]; then
        echo -e "${GREEN}${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}${BOLD}║                                                               ║${NC}"
        echo -e "${GREEN}${BOLD}║                  ✓ ALL VALIDATIONS PASSED                     ║${NC}"
        echo -e "${GREEN}${BOLD}║                                                               ║${NC}"
        echo -e "${GREEN}${BOLD}║              Changes are ready for deployment!                ║${NC}"
        echo -e "${GREEN}${BOLD}║                                                               ║${NC}"
        echo -e "${GREEN}${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${GREEN}Next steps:${NC}"
        echo "  1. Review the test output above"
        echo "  2. Run: ${BOLD}./fix-eink-schedule.sh${NC} to deploy"
        echo "  3. Monitor: ${BOLD}ssh root@192.168.50.104 'tail -f /mnt/us/dashboard/logs/auto-update.log'${NC}"
        echo "  4. Test: Unplug Kindle and verify updates continue"
        echo ""
        return 0
    else
        echo -e "${RED}${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}${BOLD}║                                                               ║${NC}"
        echo -e "${RED}${BOLD}║                  ✗ VALIDATION FAILED                          ║${NC}"
        echo -e "${RED}${BOLD}║                                                               ║${NC}"
        echo -e "${RED}${BOLD}║              Please review errors above                       ║${NC}"
        echo -e "${RED}${BOLD}║                                                               ║${NC}"
        echo -e "${RED}${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${RED}Action required:${NC}"
        echo "  1. Review the failed tests above"
        echo "  2. Fix any issues identified"
        echo "  3. Re-run this validation script"
        echo "  4. Do not deploy until all tests pass"
        echo ""
        return 1
    fi
}

main() {
    echo ""
    echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${BLUE}     E-ink Dashboard Schedule Fix - Pre-Deployment Validation     ${NC}"
    echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════════════${NC}"
    echo ""

    # Run all validation tests
    test_required_files
    test_script_syntax
    test_configuration_values
    test_function_presence
    test_wifi_command_correctness
    test_posix_compatibility
    test_documentation
    test_deployment_script
    test_wifi_commands
    test_cron_schedule
    show_expected_improvements
    generate_test_report

    exit $VALIDATION_FAILED
}

main "$@"
