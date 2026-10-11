#!/bin/bash
# Deploy the Kindle-side dashboard scripts to the device.
#
# Ships exactly the live production set — nothing else:
#   fetch-dashboard.sh, dashboard-loop.sh, on-boot.sh, start.sh, stop.sh,
#   get-device-stats.sh, config/dashboard.conf
#
# Auth: KINDLE_PASSWORD from the environment, else from ~/.config/kindle.env
# (chmod 600, outside the repo: KINDLE_PASSWORD='...'). Never hardcoded.
# Requires sshpass or expect on the dev machine.
#
# Reachability: if the Kindle's port 22 isn't reachable directly (this Mac's
# dual-NIC routing quirk does this), it jumps through the Pi (`ssh -J pi`)
# automatically. Force a jump host with --via HOST, or disable with --via none.
#
# Usage: ./deploy-kindle.sh [--host IP] [--via HOST|none] [--restart] [--install-boot-job]
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
VIA="${KINDLE_VIA:-auto}"

while [ $# -gt 0 ]; do
    case $1 in
        --host)             KINDLE_HOST="$2"; shift 2 ;;
        --via)              VIA="$2"; shift 2 ;;
        --restart)          RESTART=true; shift ;;
        --install-boot-job) INSTALL_BOOT_JOB=true; shift ;;
        *) echo "Unknown option: $1 (usage: $0 [--host IP] [--via HOST|none] [--restart] [--install-boot-job])"; exit 1 ;;
    esac
done

if [ -z "$KINDLE_PASSWORD" ] && [ -f "$HOME/.config/kindle.env" ]; then
    . "$HOME/.config/kindle.env"
fi
if [ -z "$KINDLE_PASSWORD" ]; then
    echo "ERROR: KINDLE_PASSWORD is not set. Export it, or put it in ~/.config/kindle.env:"
    echo "  KINDLE_PASSWORD='...'"
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

if [ "$VIA" = "auto" ]; then
    if nc -z -G 5 "$KINDLE_HOST" 22 2>/dev/null || nc -z -w 5 "$KINDLE_HOST" 22 2>/dev/null; then
        VIA=none
    else
        echo "Kindle not reachable directly; jumping through the Pi"
        VIA=pi
    fi
fi
if [ "$VIA" != "none" ]; then
    # The jump hop uses its own ~/.ssh/config entry (key auth); these
    # password-only options apply to the Kindle hop.
    SSH_OPTS="$SSH_OPTS -J $VIA"
fi

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
    # stop.sh restarts the Kindle framework, which bounces WiFi: its own
    # session may drop, and SSH is unreachable for a while after. So
    # start.sh gets a separate call, retried until the device is back.
    run_ssh "sh $TARGET_DIR/stop.sh" || true
    started=false
    for attempt in 1 2 3 4 5 6 7 8; do
        if run_ssh "sh $TARGET_DIR/start.sh > /tmp/start.out 2>&1; tail -2 /tmp/start.out"; then
            started=true
            break
        fi
        echo "  device not back yet (attempt $attempt), retrying in 10s..."
        sleep 10
    done
    if [ "$started" != "true" ]; then
        echo "ERROR: could not start the dashboard loop — the Kindle is in normal (framework) mode."
        echo "  Retry: ./deploy-kindle.sh --restart"
        exit 1
    fi
    if run_ssh "kill -0 \$(cat $TARGET_DIR/dashboard-loop.pid) 2>/dev/null"; then
        echo "  loop running (PID file live)"
    else
        echo "WARNING: dashboard loop not running after restart — check $TARGET_DIR/logs/"
    fi
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
