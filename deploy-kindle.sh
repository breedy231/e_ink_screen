#!/bin/bash
# Deploy the Kindle-side dashboard scripts to the device.
#
# Ships exactly the live production set — nothing else:
#   fetch-dashboard.sh, dashboard-loop.sh, on-boot.sh, start.sh, stop.sh,
#   get-device-stats.sh, config/dashboard.conf
#
# Auth: export KINDLE_PASSWORD before running (never hardcoded).
# Requires sshpass or expect on the dev machine.
#
# Usage: ./deploy-kindle.sh [--host IP] [--restart] [--install-boot-job]
#
# --install-boot-job writes kindle/upstart/dashboard.conf to
# /etc/upstart/dashboard.conf. That touches the read-only rootfs, so it is
# opt-in rather than part of every deploy.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KINDLE_HOST="${KINDLE_HOST:-192.168.50.104}"
KINDLE_USER="${KINDLE_USER:-root}"
TARGET_DIR="/mnt/us/dashboard"
RESTART=false
INSTALL_BOOT_JOB=false

while [ $# -gt 0 ]; do
    case $1 in
        --host)             KINDLE_HOST="$2"; shift 2 ;;
        --restart)          RESTART=true; shift ;;
        --install-boot-job) INSTALL_BOOT_JOB=true; shift ;;
        *) echo "Unknown option: $1 (usage: $0 [--host IP] [--restart] [--install-boot-job])"; exit 1 ;;
    esac
done

if [ -z "$KINDLE_PASSWORD" ]; then
    echo "ERROR: KINDLE_PASSWORD is not set. Export it first:"
    echo "  export KINDLE_PASSWORD='...'"
    exit 1
fi

FILES="
kindle/fetch-dashboard.sh
kindle/dashboard-loop.sh
kindle/on-boot.sh
kindle/start.sh
kindle/stop.sh
kindle/get-device-stats.sh
"
CONFIG_FILE="kindle/config/dashboard.conf"

# Verify sources exist and pass a POSIX syntax check before shipping
for f in $FILES; do
    [ -f "$SCRIPT_DIR/$f" ] || { echo "ERROR: missing $f"; exit 1; }
    sh -n "$SCRIPT_DIR/$f" || { echo "ERROR: $f fails sh -n"; exit 1; }
done
[ -f "$SCRIPT_DIR/$CONFIG_FILE" ] || { echo "ERROR: missing $CONFIG_FILE"; exit 1; }

SSH_OPTS="-o ConnectTimeout=10 -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no"

run_ssh() {
    if command -v sshpass >/dev/null 2>&1; then
        sshpass -e ssh $SSH_OPTS "$KINDLE_USER@$KINDLE_HOST" "$1"
    else
        expect -c "
            spawn ssh $SSH_OPTS $KINDLE_USER@$KINDLE_HOST {$1}
            expect \"password:\"
            send \"\$env(KINDLE_PASSWORD)\r\"
            expect eof
        "
    fi
}

run_scp() {
    if command -v sshpass >/dev/null 2>&1; then
        sshpass -e scp $SSH_OPTS "$1" "$KINDLE_USER@$KINDLE_HOST:$2"
    else
        expect -c "
            spawn scp $SSH_OPTS {$1} $KINDLE_USER@$KINDLE_HOST:{$2}
            expect \"password:\"
            send \"\$env(KINDLE_PASSWORD)\r\"
            expect eof
        "
    fi
}

export SSHPASS="$KINDLE_PASSWORD"

echo "Deploying to $KINDLE_USER@$KINDLE_HOST:$TARGET_DIR"
run_ssh "mkdir -p $TARGET_DIR/config $TARGET_DIR/logs"

for f in $FILES; do
    echo "  -> $(basename "$f")"
    run_scp "$SCRIPT_DIR/$f" "$TARGET_DIR/$(basename "$f")"
done

echo "  -> config/dashboard.conf"
run_scp "$SCRIPT_DIR/$CONFIG_FILE" "$TARGET_DIR/config/dashboard.conf"

# chmod is best-effort: /mnt/us is vfat, so scripts are invoked as `sh script`
# and the exec bit is not relied upon.
run_ssh "chmod +x $TARGET_DIR/*.sh 2>/dev/null || true"

if [ "$INSTALL_BOOT_JOB" = "true" ]; then
    BOOT_JOB="$SCRIPT_DIR/kindle/upstart/dashboard.conf"
    [ -f "$BOOT_JOB" ] || { echo "ERROR: missing kindle/upstart/dashboard.conf"; exit 1; }
    echo "Installing boot job to /etc/upstart/dashboard.conf..."
    # Stage on /mnt/us (writable), back up any existing job, then remount the
    # rootfs rw only for the copy itself and put it straight back to ro.
    run_scp "$BOOT_JOB" "$TARGET_DIR/dashboard.conf"
    run_ssh "set -e
        if [ -f /etc/upstart/dashboard.conf ]; then
            cp /etc/upstart/dashboard.conf $TARGET_DIR/dashboard.conf.bak
            echo '  backed up existing job to $TARGET_DIR/dashboard.conf.bak'
        fi
        mount -o remount,rw /
        cp $TARGET_DIR/dashboard.conf /etc/upstart/dashboard.conf
        mount -o remount,ro /
        echo '  installed; rootfs remounted ro'"
fi

if [ "$RESTART" = "true" ]; then
    echo "Restarting dashboard mode..."
    run_ssh "sh $TARGET_DIR/stop.sh; sh $TARGET_DIR/start.sh"
fi

echo ""
echo "Deploy complete."
if [ "$INSTALL_BOOT_JOB" != "true" ]; then
    echo "Reminders (one-time, on-device):"
    echo "  - Boot auto-start: ./deploy-kindle.sh --install-boot-job"
    echo "    (or check /etc/upstart/dashboard.conf execs 'sh $TARGET_DIR/on-boot.sh')"
fi
echo "  - Manual start/stop: sh $TARGET_DIR/start.sh | sh $TARGET_DIR/stop.sh"
echo "  - Verify the loop with 'ps aux | grep dashboard-loop' (busybox plain"
echo "    'ps' shows no cmdline and will look like a false negative)"
