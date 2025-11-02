#!/bin/bash

##############################################################################
# Start Local Dashboard Server
#
# Convenience script to start the dashboard HTTP server for Kindle
# Automatically detects network configuration and provides helpful output
#
# Usage: ./start-local-server.sh [OPTIONS]
##############################################################################

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"
KINDLE_IP="192.168.50.104"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Default configuration
DEFAULT_HOST="0.0.0.0"
DEFAULT_PORT="3000"
CACHE_TIMEOUT="60000"  # 1 minute cache

HOST="$DEFAULT_HOST"
PORT="$DEFAULT_PORT"
ENABLE_CACHE="true"

# Function to show usage
show_usage() {
    cat << EOF
Start Local Dashboard Server for Kindle

USAGE:
    $0 [OPTIONS]

OPTIONS:
    -p, --port PORT         Server port (default: 3000)
    -h, --host HOST         Server host (default: 0.0.0.0)
    --no-cache              Disable image caching
    --cache-timeout MS      Cache timeout in milliseconds (default: 60000)
    --help                  Show this help

EXAMPLES:
    $0                      # Start server on all interfaces, port 3000
    $0 -p 8080              # Start on port 8080
    $0 --no-cache           # Disable caching for testing

ENDPOINTS:
    http://YOUR_IP:$PORT/dashboard       Dashboard image (PNG)
    http://YOUR_IP:$PORT/health          Health check
    http://YOUR_IP:$PORT/api             API documentation

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -h|--host)
            HOST="$2"
            shift 2
            ;;
        --no-cache)
            ENABLE_CACHE="false"
            shift
            ;;
        --cache-timeout)
            CACHE_TIMEOUT="$2"
            shift 2
            ;;
        --help)
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

# Get local IP address (excluding localhost)
LOCAL_IP=$(ifconfig | grep "inet " | grep -v "127.0.0.1" | head -1 | awk '{print $2}')

# Clear screen and show banner
clear
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🖥️  Kindle Dashboard Local Server${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Show network information
echo -e "${GREEN}Network Configuration:${NC}"
echo "  📍 Local IP: $LOCAL_IP"
echo "  🚪 Port: $PORT"
echo "  🔌 Bind: $HOST"
echo "  📱 Kindle IP: $KINDLE_IP"
echo ""

# Show server URLs
echo -e "${GREEN}Server URLs:${NC}"
echo "  Dashboard: http://$LOCAL_IP:$PORT/dashboard"
echo "  Health:    http://$LOCAL_IP:$PORT/health"
echo "  API Info:  http://$LOCAL_IP:$PORT/api"
echo ""

# Show cache configuration
echo -e "${GREEN}Cache Configuration:${NC}"
if [ "$ENABLE_CACHE" = "true" ]; then
    echo "  Cache: ✅ Enabled"
    echo "  Timeout: ${CACHE_TIMEOUT}ms ($(($CACHE_TIMEOUT / 1000))s)"
else
    echo "  Cache: ❌ Disabled"
fi
echo ""

# Check if server directory exists
if [ ! -d "$SERVER_DIR" ]; then
    echo -e "${YELLOW}⚠️  Server directory not found: $SERVER_DIR${NC}"
    exit 1
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}⚠️  Node.js not found - please install Node.js${NC}"
    exit 1
fi

# Check if server.js exists
if [ ! -f "$SERVER_DIR/server.js" ]; then
    echo -e "${YELLOW}⚠️  Server script not found: $SERVER_DIR/server.js${NC}"
    exit 1
fi

# Show quick start guide
echo -e "${GREEN}Quick Start Guide:${NC}"
echo "  1. Server will start in a moment..."
echo "  2. On Kindle, run:"
echo "     ssh root@$KINDLE_IP"
echo "     /mnt/us/dashboard/setup-local-cron.sh"
echo ""
echo "  3. Monitor auto-updates:"
echo "     ssh root@$KINDLE_IP tail -f /mnt/us/dashboard/logs/auto-update.log"
echo ""
echo "  4. Manual test fetch (from Mac):"
echo "     curl http://$LOCAL_IP:$PORT/health"
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🚀 Starting server...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Build server command
cd "$SERVER_DIR"

SERVER_CMD="node local-dashboard-server.js --host $HOST --port $PORT --layout weather"

if [ "$ENABLE_CACHE" = "false" ]; then
    SERVER_CMD="$SERVER_CMD --no-cache"
else
    SERVER_CMD="$SERVER_CMD --cache-timeout $CACHE_TIMEOUT"
fi

# Start server
exec $SERVER_CMD
