# Kindle Dashboard Recovery Runbook

For when the Kindle has reverted to the stock library view (framework
running, dashboard loop dead). Written to be executed by a Claude Code
session **on the dev machine** (the cloud sandbox cannot reach the LAN),
but works equally as a human checklist.

**Known failure class**: the pre-remediation `on-boot.sh` launched the loop
without WiFi keep-alive, so after prolonged sleep/reboot the radio slept on
battery, fetches died, and the device eventually fell back to the framework
UI. The fixed scripts (2026-08 remediation) close this — recovery should
**deploy them**, not just restart the old ones.

## 0. Prerequisites (dev machine)

- This repo checked out, on `main` **after PR #8 is merged**
  (`git pull origin main`). If PR #8 is not merged yet, work from the
  `claude/eink-codebase-review-bvxjn0` branch instead — the fixed Kindle
  scripts live there.
- `export KINDLE_PASSWORD='...'` (the Kindle root password — post-rotation
  value; see `SECURITY_ROTATION.md`).
- `sshpass` installed (`brew install sshpass` / `apt install sshpass`).
- On the same LAN as the devices.

## 1. Network access

Direct SSH from the dev machine to the Kindle fails (key auth). Route
through the Pi:

```bash
# Pi (key auth, should just work)
ssh pi@192.168.50.163

# Kindle via the Pi as jump host, from the dev machine:
sshpass -p "$KINDLE_PASSWORD" ssh \
  -o ProxyJump=pi@192.168.50.163 \
  -o PreferredAuthentications=password -o PubkeyAuthentication=no \
  -o StrictHostKeyChecking=no \
  root@192.168.50.104

# If ProxyJump misbehaves, two hops manually:
#   ssh pi@192.168.50.163
#   then on the Pi: ssh root@192.168.50.104   (enter password)
```

Non-interactive command form used throughout below:

```bash
kindle() {
  sshpass -p "$KINDLE_PASSWORD" ssh \
    -o ProxyJump=pi@192.168.50.163 \
    -o PreferredAuthentications=password -o PubkeyAuthentication=no \
    -o StrictHostKeyChecking=no \
    root@192.168.50.104 "$@"
}
```

## 2. Diagnose (read-only — do this BEFORE restarting anything)

### 2a. Pi server side

```bash
curl -s http://192.168.50.163:3000/health          # expect status: healthy
ssh pi@192.168.50.163 'systemctl status kindle-dashboard --no-pager | head -12'
ssh pi@192.168.50.163 'journalctl -u kindle-dashboard -n 30 --no-pager'
```

If the server is down, fix that first (`sudo systemctl restart
kindle-dashboard`) — the Kindle can't recover against a dead server.

### 2b. Kindle side — capture evidence first

```bash
# Is the loop alive? (library view showing usually means: no)
kindle 'cat /mnt/us/dashboard/dashboard-loop.pid 2>/dev/null; ps | grep dashboard-loop | grep -v grep'

# SAVE the log tails locally before anything restarts/rotates them —
# this is the root-cause evidence
mkdir -p /tmp/kindle-recovery
kindle 'tail -100 /mnt/us/dashboard/logs/dashboard-loop.log 2>/dev/null' > /tmp/kindle-recovery/loop.log
kindle 'tail -100 /mnt/us/dashboard/logs/fetch.log 2>/dev/null'          > /tmp/kindle-recovery/fetch.log
kindle 'tail -50  /mnt/us/dashboard/logs/boot.log 2>/dev/null'           > /tmp/kindle-recovery/boot.log
kindle 'tail -50  /mnt/us/dashboard/logs/start.log 2>/dev/null'          > /tmp/kindle-recovery/start.log

# State snapshot
kindle 'date; gasgauge-info -c; lipc-get-prop com.lab126.powerd preventScreenSaver 2>/dev/null; ifconfig wlan0 | grep "inet addr"; uptime'

# Is the boot job even installed? (empty output = it never was — see 4b)
kindle 'ls -la /etc/upstart/dashboard.conf 2>/dev/null; cat /etc/upstart/dashboard.conf 2>/dev/null'

# What script versions are on the device? (old on-boot.sh launches the
# loop directly; fixed one delegates to start.sh)
kindle 'grep -l "Delegating to start.sh" /mnt/us/dashboard/on-boot.sh 2>/dev/null && echo FIXED-SCRIPTS || echo OLD-SCRIPTS'
```

Interpret: uptime tells you whether the device rebooted (battery died) or
stayed up while the loop died. `boot.log` shows whether on-boot ran after a
reboot. `OLD-SCRIPTS` + WiFi dead in the loop log = the known keep-alive
bug.

## 3. Recover — deploy the fixed scripts, then restart dashboard mode

```bash
cd /path/to/e_ink_screen        # repo root, on main (or the PR branch)
./scripts/validate.sh           # sanity gate
./deploy-kindle.sh --restart    # ships the live script set + stop/start
```

`deploy-kindle.sh --restart` runs `stop.sh` then `start.sh` on the device,
which: stops the framework, clears the screen, sets `preventScreenSaver 1`,
enables WiFi keep-alive (`keepAliveWirelessRadio 1` + `iwconfig power off`),
and launches `dashboard-loop.sh`. The library view should be replaced by
the dashboard within ~1 minute.

Manual fallback (if the deploy script can't run for some reason):

```bash
kindle 'sh /mnt/us/dashboard/stop.sh; sh /mnt/us/dashboard/start.sh'
```

## 4. Verify

### 4a. Immediately

```bash
kindle 'cat /mnt/us/dashboard/dashboard-loop.pid; ps | grep dashboard-loop | grep -v grep'
kindle 'tail -20 /mnt/us/dashboard/logs/dashboard-loop.log'
# and look at the physical screen: dashboard, not library
```

Then after ~15–16 minutes, confirm a second fetch landed:

```bash
kindle 'tail -5 /mnt/us/dashboard/logs/fetch.log'
```

### 4b. Boot job (the thing that makes recovery automatic next time)

`/etc/upstart/dashboard.conf` must exist and exec the on-boot script. If it
was missing in step 2b, install it (rootfs is read-only — remount around
the edit):

```bash
kindle 'mount -o remount,rw / && cat > /etc/upstart/dashboard.conf << "UPSTART_EOF"
start on started lab126_gui
stop on stopping lab126_gui
script
exec sh /mnt/us/dashboard/on-boot.sh >> /mnt/us/dashboard/logs/boot.log 2>&1
end script
UPSTART_EOF
mount -o remount,ro /'
```

(If an existing job differs, prefer keeping its `start on` stanza — it was
working — and just ensure the exec line is `sh /mnt/us/dashboard/on-boot.sh`.)

### 4c. Reboot test (the real proof)

```bash
kindle 'reboot'
# wait ~2-3 minutes (on-boot sleeps 30s + waits for WiFi), then:
kindle 'ps | grep dashboard-loop | grep -v grep && tail -5 /mnt/us/dashboard/logs/boot.log'
```

The dashboard should come back on its own. If it does, the original
failure mode is closed.

## 5. Report

Summarize from the saved `/tmp/kindle-recovery/*` logs: what killed the
loop (WiFi death? battery/reboot with no boot job? crash?), what was
deployed, and the verification results. If the root cause is NOT the known
keep-alive bug, file the evidence — don't guess.
