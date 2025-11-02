#!/bin/bash

# Deploy KUAL Extension for Kindle Dashboard
# This script deploys the KUAL extension and sets proper permissions

set -e

KINDLE_IP="192.168.50.104"
KINDLE_USER="root"
KINDLE_PASSWORD="Eragon23129"
LOCAL_KUAL_DIR="./KUAL/kindle-dash"
REMOTE_EXTENSIONS_DIR="/mnt/us/extensions"
REMOTE_KUAL_DIR="$REMOTE_EXTENSIONS_DIR/kindle-dash"

echo "=== Kindle Dashboard KUAL Deployment ==="
echo "Target: $KINDLE_USER@$KINDLE_IP"
echo

# Check expect dependency
if ! command -v expect &> /dev/null; then
    echo "❌ ERROR: expect command not found"
    echo "   Install with: brew install expect"
    exit 1
fi

# Test SSH access using expect (same as generate-and-test.sh)
echo "Testing SSH access..."
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

if [[ $? -ne 0 ]]; then
    echo "❌ ERROR: Cannot SSH to Kindle at $KINDLE_IP"
    echo "   Make sure the Kindle is connected to WiFi and SSH is enabled"
    exit 1
fi

echo "✅ Connectivity OK"
echo

# Create extensions directory if it doesn't exist
echo "Creating extensions directory..."
expect -c "
    spawn ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no $KINDLE_USER@$KINDLE_IP
    expect \"password:\"
    send \"$KINDLE_PASSWORD\r\"
    expect \"# \"
    send \"mkdir -p $REMOTE_EXTENSIONS_DIR\r\"
    expect \"# \"
    send \"exit\r\"
    expect eof
" >/dev/null 2>&1

# Deploy KUAL extension files
echo "Deploying KUAL extension..."
expect -c "
    spawn scp -r -o PreferredAuthentications=password -o PubkeyAuthentication=no \"$LOCAL_KUAL_DIR\" $KINDLE_USER@$KINDLE_IP:$REMOTE_EXTENSIONS_DIR/
    expect \"password:\"
    send \"$KINDLE_PASSWORD\r\"
    expect eof
" >/dev/null 2>&1

if [[ $? -ne 0 ]]; then
    echo "❌ ERROR: Failed to deploy KUAL extension files"
    exit 1
fi

# Set proper permissions
echo "Setting permissions..."
expect -c "
    spawn ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no $KINDLE_USER@$KINDLE_IP
    expect \"password:\"
    send \"$KINDLE_PASSWORD\r\"
    expect \"# \"
    send \"chmod 755 $REMOTE_KUAL_DIR\r\"
    expect \"# \"
    send \"chmod 644 $REMOTE_KUAL_DIR/config.xml\r\"
    expect \"# \"
    send \"chmod 644 $REMOTE_KUAL_DIR/menu.json\r\"
    expect \"# \"
    send \"chmod 755 $REMOTE_EXTENSIONS_DIR\r\"
    expect \"# \"
    send \"echo 'Installed files:'\r\"
    expect \"# \"
    send \"ls -la $REMOTE_KUAL_DIR\r\"
    expect \"# \"
    send \"exit\r\"
    expect eof
"

if [[ $? -ne 0 ]]; then
    echo "❌ ERROR: Failed to set permissions"
    exit 1
fi

echo
echo "✅ KUAL extension deployed successfully!"
echo
echo "Next steps:"
echo "1. Restart KUAL or reboot Kindle"
echo "2. Look for 'Kindle Dashboard' in KUAL menu"
echo "3. Test menu functions"
echo
echo "If you still see permission errors:"
echo "- Try rebooting the Kindle"
echo "- Check that KUAL itself is properly installed"
echo "- Verify the extensions directory: $REMOTE_EXTENSIONS_DIR"