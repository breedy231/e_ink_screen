#!/bin/bash

# Script to test different dashboard layouts on Kindle
# Usage: ./test-layouts.sh [layout_name]

set -e

LAYOUTS=("default" "compact" "minimal" "split")
SERVER_DIR="/Users/brendanreed/repos/e_ink_screen/server"
KINDLE_IP="192.168.50.104"
KINDLE_USER="root"
KINDLE_PASSWORD="Eragon23129"

log_info() {
    echo -e "\033[0;34mℹ️  $1\033[0m"
}

log_success() {
    echo -e "\033[0;32m✅ $1\033[0m"
}

deploy_layout() {
    local layout="$1"

    log_info "Testing layout: $layout"

    # Generate layout
    cd "$SERVER_DIR"
    node generate-dashboard-v2.js --layout "$layout"

    # Find the generated image
    local image_file=$(find ../test-images -name "dashboard_${layout}.png" | head -1)

    if [[ ! -f "$image_file" ]]; then
        echo "❌ Image not found for layout: $layout"
        return 1
    fi

    # Deploy to Kindle
    timeout 10 expect -c "
        spawn scp -o ConnectTimeout=5 -o PreferredAuthentications=password -o PubkeyAuthentication=no \"$image_file\" $KINDLE_USER@$KINDLE_IP:/mnt/us/dashboard/current.png
        expect {
            \"password:\" {
                send \"$KINDLE_PASSWORD\r\"
                expect eof
                exit 0
            }
            timeout {
                exit 1
            }
        }
    " >/dev/null 2>&1

    # Display on Kindle
    timeout 10 expect -c "
        spawn ssh -o ConnectTimeout=5 -o PreferredAuthentications=password -o PubkeyAuthentication=no $KINDLE_USER@$KINDLE_IP
        expect {
            \"password:\" {
                send \"$KINDLE_PASSWORD\r\"
                expect \"# \"
                send \"/usr/sbin/eips -f -g /mnt/us/dashboard/current.png\r\"
                expect \"# \"
                send \"exit\r\"
                expect eof
                exit 0
            }
            timeout {
                exit 1
            }
        }
    " >/dev/null 2>&1

    log_success "Layout '$layout' deployed and displayed"

    # Wait for user to observe
    echo "📱 Layout '$layout' is now displayed on Kindle. Press Enter to continue to next layout..."
    read
}

# Main execution
if [[ $# -eq 1 ]]; then
    # Test specific layout
    deploy_layout "$1"
else
    # Test all layouts
    log_info "Testing all available layouts on Kindle"
    echo "🎨 This will cycle through all 4 layouts for visual comparison"
    echo "Press Enter to start..."
    read

    for layout in "${LAYOUTS[@]}"; do
        deploy_layout "$layout"
    done

    log_success "All layouts tested successfully!"
fi