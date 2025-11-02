#!/bin/bash
# Complete dashboard generation and testing pipeline
# Usage: ./generate-and-test.sh [--test] [--deploy]

set -e

# Configuration
PROJECT_ROOT="/Users/brendanreed/repos/e_ink_screen"
SERVER_DIR="$PROJECT_ROOT/server"
TEST_ENV="$PROJECT_ROOT/test_env"
KINDLE_IP="192.168.50.104"
KINDLE_USER="root"
KINDLE_PASSWORD="Eragon23129"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Function to check dependencies
check_dependencies() {
    log_info "Checking dependencies..."

    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found"
        exit 1
    fi

    # Check expect
    if ! command -v expect &> /dev/null; then
        log_error "expect command not found"
        exit 1
    fi

    # Check Python virtual environment
    if [[ ! -f "$TEST_ENV/bin/activate" ]]; then
        log_error "Python virtual environment not found at $TEST_ENV"
        exit 1
    fi

    log_success "All dependencies found"
}

# Function to generate dashboard
generate_dashboard() {
    log_info "Generating dashboard..."

    cd "$SERVER_DIR"

    if [[ "$1" == "--test" ]]; then
        node generate-flexible-dashboard.js weather --test
    else
        node generate-flexible-dashboard.js weather
    fi

    log_success "Dashboard generated"
}

# Function to optimize for e-ink
optimize_dashboard() {
    local input_image="$1"

    log_info "Optimizing dashboard for e-ink..."

    source "$TEST_ENV/bin/activate"
    python3 "$SERVER_DIR/optimize-for-eink.py" "$input_image"

    log_success "Dashboard optimized for e-ink"
}

# Function to test Kindle connectivity
test_kindle_connection() {
    log_info "Testing Kindle connectivity..."

    timeout 5 expect -c "
        spawn ssh -o ConnectTimeout=5 -o PreferredAuthentications=password -o PubkeyAuthentication=no $KINDLE_USER@$KINDLE_IP
        expect {
            \"password:\" {
                send \"$KINDLE_PASSWORD\r\"
                expect \"# \"
                send \"echo 'Connection test successful'\r\"
                expect \"# \"
                send \"exit\r\"
                expect eof
                exit 0
            }
            timeout {
                exit 1
            }
        }
    " 2>/dev/null

    if [[ $? -eq 0 ]]; then
        log_success "Kindle connection successful"
        return 0
    else
        log_warning "Kindle not reachable (IP: $KINDLE_IP)"
        return 1
    fi
}

# Function to deploy device stats script to Kindle
deploy_device_stats_script() {
    local script_path="$PROJECT_ROOT/kindle/get-device-stats.sh"
    local target_path="/mnt/us/dashboard/get-device-stats.sh"

    log_info "Deploying device stats script to Kindle..."

    # Transfer script
    expect -c "
        spawn scp -o PreferredAuthentications=password -o PubkeyAuthentication=no \"$script_path\" $KINDLE_USER@$KINDLE_IP:$target_path
        expect \"password:\"
        send \"$KINDLE_PASSWORD\r\"
        expect eof
    " >/dev/null 2>&1

    if [[ $? -ne 0 ]]; then
        log_error "Failed to transfer device stats script to Kindle"
        return 1
    fi

    # Make script executable
    expect -c "
        spawn ssh -o ConnectTimeout=10 -o PreferredAuthentications=password -o PubkeyAuthentication=no $KINDLE_USER@$KINDLE_IP
        expect \"password:\"
        send \"$KINDLE_PASSWORD\r\"
        expect \"# \"
        send \"chmod +x $target_path\r\"
        expect \"# \"
        send \"echo 'Device stats script deployed'\r\"
        expect \"# \"
        send \"exit\r\"
        expect eof
    " >/dev/null 2>&1

    if [[ $? -eq 0 ]]; then
        log_success "Device stats script deployed successfully"
        return 0
    else
        log_error "Failed to make device stats script executable"
        return 1
    fi
}

# Function to deploy to Kindle
deploy_to_kindle() {
    local image_path="$1"
    local image_name=$(basename "$image_path")

    log_info "Deploying dashboard to Kindle..."

    # Transfer image
    expect -c "
        spawn scp -o PreferredAuthentications=password -o PubkeyAuthentication=no \"$image_path\" $KINDLE_USER@$KINDLE_IP:/mnt/us/dashboard/
        expect \"password:\"
        send \"$KINDLE_PASSWORD\r\"
        expect eof
    " >/dev/null 2>&1

    if [[ $? -ne 0 ]]; then
        log_error "Failed to transfer image to Kindle"
        return 1
    fi

    # Display image with ULTRA-NUCLEAR screen clearing (extended framework restart)
    expect -c "
        spawn ssh -o ConnectTimeout=20 -o PreferredAuthentications=password -o PubkeyAuthentication=no $KINDLE_USER@$KINDLE_IP
        expect \"password:\"
        send \"$KINDLE_PASSWORD\r\"
        expect \"# \"
        send \"echo 'ULTRA-NUCLEAR OPTION: Extended framework restart to obliterate UI bleed-in...'\r\"
        expect \"# \"
        send \"/etc/init.d/framework stop\r\"
        expect \"# \"
        send \"sleep 3\r\"
        expect \"# \"
        send \"echo 'Phase 1: Aggressive screen clearing (5 passes)...'\r\"
        expect \"# \"
        send \"eips -c\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"eips -f -c\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"eips -c\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"eips -f -c\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"eips -c\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"echo 'Phase 2: Framework restart cycle...'\r\"
        expect \"# \"
        send \"/etc/init.d/framework start\r\"
        expect \"# \"
        send \"sleep 5\r\"
        expect \"# \"
        send \"/etc/init.d/framework stop\r\"
        expect \"# \"
        send \"sleep 3\r\"
        expect \"# \"
        send \"echo 'Phase 3: Extended final clearing (7 passes)...'\r\"
        expect \"# \"
        send \"eips -c\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"eips -f -c\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"eips -c\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"eips -f -c\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"eips -c\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"eips -f -c\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"eips -c\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"echo 'Phase 4: Dashboard display with triple refresh...'\r\"
        expect \"# \"
        send \"eips -f -g /mnt/us/dashboard/$image_name\r\"
        expect \"# \"
        send \"sleep 3\r\"
        expect \"# \"
        send \"eips -f -g /mnt/us/dashboard/$image_name\r\"
        expect \"# \"
        send \"sleep 3\r\"
        expect \"# \"
        send \"eips -f -g /mnt/us/dashboard/$image_name\r\"
        expect \"# \"
        send \"sleep 2\r\"
        expect \"# \"
        send \"echo 'Phase 5: Sleep prevention activation...'\r\"
        expect \"# \"
        send \"lipc-set-prop com.lab126.powerd preventScreenSaver 1 || echo 'Sleep prevention command not available'\r\"
        expect \"# \"
        send \"echo 'ULTRA-NUCLEAR screen clearing completed - bleed-in should be obliterated'\r\"
        expect \"# \"
        send \"echo 'Dashboard will remain visible indefinitely'\r\"
        expect \"# \"
        send \"echo 'Use /mnt/us/dashboard/stop.sh to exit dashboard mode'\r\"
        expect \"# \"
        send \"exit\r\"
        expect eof
    " >/dev/null 2>&1

    if [[ $? -eq 0 ]]; then
        log_success "Dashboard deployed and displayed on Kindle"
        return 0
    else
        log_error "Failed to display dashboard on Kindle"
        return 1
    fi
}

# Function to show usage
show_usage() {
    echo "Dashboard Generation and Testing Pipeline"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --test      Generate dashboard with test grid and timestamp"
    echo "  --deploy    Deploy generated dashboard to Kindle"
    echo "  --help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                      # Generate standard dashboard"
    echo "  $0 --test              # Generate test dashboard"
    echo "  $0 --deploy            # Generate and deploy to Kindle"
    echo "  $0 --test --deploy     # Generate test dashboard and deploy"
}

# Main function
main() {
    local test_mode=false
    local deploy_mode=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --test)
                test_mode=true
                shift
                ;;
            --deploy)
                deploy_mode=true
                shift
                ;;
            --help|-h)
                show_usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done

    echo "🖼️  Kindle Dashboard Generation Pipeline"
    echo "========================================"

    # Check dependencies
    check_dependencies

    # Generate dashboard
    if [[ "$test_mode" == true ]]; then
        generate_dashboard --test
        latest_image=$(find "$PROJECT_ROOT/test-images" -name "dashboard_*20*.png" | sort | tail -1)
    else
        generate_dashboard
        latest_image="$PROJECT_ROOT/test-images/dashboard_weather.png"
    fi

    # Optimize for e-ink
    optimize_dashboard "$latest_image"

    # Find optimized image
    optimized_image="${latest_image%.*}_eink_optimized.png"

    # Deploy if requested
    if [[ "$deploy_mode" == true ]]; then
        if test_kindle_connection; then
            # Deploy device stats script first (only if it doesn't exist or is newer)
            deploy_device_stats_script
            # Then deploy the dashboard image
            deploy_to_kindle "$optimized_image"
        else
            log_warning "Skipping deployment - Kindle not reachable"
            log_info "Generated image: $optimized_image"
            log_info "Use manual transfer when Kindle is available"
        fi
    else
        log_success "Pipeline completed successfully!"
        log_info "Generated image: $optimized_image"
        log_info "Use --deploy flag to automatically deploy to Kindle"
    fi
}

# Run main function with all arguments
main "$@"