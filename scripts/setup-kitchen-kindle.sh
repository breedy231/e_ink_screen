#!/usr/bin/env bash
#
# Provision the kitchen Kindle over SSH, once usbnet is running.
#
# This is the second half of the bootstrap: everything from here is scriptable.
# Run it while connected over USB (root has no password there — dropbear runs
# with -n), and it will switch the device over to key-authenticated WiFi SSH so
# subsequent runs work over the network.
#
#   ./scripts/setup-kitchen-kindle.sh --usb        # first run, over usb0
#   ./scripts/setup-kitchen-kindle.sh --host <ip>  # later runs, over wifi
#
set -e

USB_IP="192.168.15.244"
USB_HOST_IP="192.168.15.201"
PUBKEY="${PUBKEY:-$HOME/.ssh/id_ed25519.pub}"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

MODE=""
TARGET=""
case "${1:-}" in
    --usb)  MODE=usb;  TARGET="$USB_IP" ;;
    --host) MODE=wifi; TARGET="${2:?--host needs an IP}" ;;
    *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac

[ -f "$PUBKEY" ] || die "No public key at $PUBKEY (set PUBKEY=...)"

# Over USB the daemon accepts any password, so force password auth off and let
# it through; over wifi we require the key we just installed.
if [ "$MODE" = usb ]; then
    SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive"
    log "USB mode — check the host side is configured:"
    log "  sudo ifconfig usb0 $USB_HOST_IP"
else
    SSH_OPTS="-o StrictHostKeyChecking=accept-new"
fi

kssh() { ssh $SSH_OPTS "root@$TARGET" "$@"; }

log "Testing connectivity to root@$TARGET"
kssh 'echo ok' >/dev/null 2>&1 || die "Cannot reach root@$TARGET.
  USB:  is usbnet started on the device (';un' in the search bar)?
        is usb0 configured on this Mac (sudo ifconfig usb0 $USB_HOST_IP)?
  WiFi: is USE_WIFI=true set and the device on the network?"
log "Connected"

log "Confirming this is the Paperwhite 3 and not the desk Kindle"
# Guard against pointing this at v0 by mistake — it would enable wifi SSH on
# the wrong device and the two are configured very differently.
serial=$(kssh 'cat /proc/usid 2>/dev/null' || echo '')
log "Serial: ${serial:-<unreadable>}"
case "$serial" in
    G090*) log "Confirmed PW3 (G090 prefix)" ;;
    "")    warn "Could not read /proc/usid — continuing, but verify by hand" ;;
    *)     die "Serial prefix is not G090 — this is NOT the kitchen Paperwhite 3.
Refusing to reconfigure SSH on the wrong device." ;;
esac

log "Installing authorized_keys"
# usbnet's documented equivalent of ~/.ssh/authorized_keys. Key auth is the
# point: the moment USE_WIFI=true, dropbear starts enforcing passwords, and we
# do not want to depend on the serial-derived one.
kssh 'mkdir -p /mnt/us/usbnet/etc'
kssh 'cat > /mnt/us/usbnet/etc/authorized_keys' < "$PUBKEY"
kssh 'chmod 600 /mnt/us/usbnet/etc/authorized_keys'
log "Key installed from $PUBKEY"

log "Writing usbnet config (WiFi SSH on, key auth)"
# Written with printf and no CRs: this file must keep UNIX line endings, and
# must not be edited while usbnet is running.
kssh 'printf "%s\n" \
  "KINDLE_IP=192.168.15.244" \
  "USE_WIFI=\"true\"" \
  "USE_WIFI_SSHD_ONLY=\"true\"" \
  "USE_OPENSSH=\"false\"" \
  "QUIET_DROPBEAR=\"false\"" \
  "TWEAK_MAC_ADDRESS=\"false\"" \
  > /mnt/us/usbnet/etc/config'

log "Enabling SSH at boot"
# Without this the device needs a manual ';un' after every reboot, which
# defeats the point of an unattended kitchen screen.
kssh 'touch /mnt/us/usbnet/auto'

log "Device state:"
kssh 'echo "  jailbroken: $([ -f /mnt/us/documents/JAILBROKEN.txt ] && echo yes || echo NO)";
      echo "  ssh-at-boot: $([ -f /mnt/us/usbnet/auto ] && echo yes || echo NO)";
      echo "  keys: $(wc -l < /mnt/us/usbnet/etc/authorized_keys 2>/dev/null || echo 0)";
      echo "  free: $(df -m /mnt/us | awk "NR==2 {print \$4}") MB"'

cat <<EOF

$(log 'Provisioning complete.')

Next, on the device: restart usbnet so the new config takes effect
  ;uns   then   ;un

Then confirm WiFi SSH works with the key (from this Mac):
  ssh root@<kitchen-wifi-ip>

Once that works, add a 'kitchen' host to ~/.ssh/config (mirroring the 'pi'
alias) and the dashboard client can be deployed the same way v0's is.

NOT done yet, deliberately — see KITCHEN_SCREEN_PLAN.md:
  * the paper render service and its endpoints do not exist yet
  * MONITORED_DEVICES must gain 'kitchen' ONLY once this screen is really
    polling, or it goes stale immediately and alerts every check interval
EOF
