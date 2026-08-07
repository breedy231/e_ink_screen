# Kindle Dashboard Recovery Runbook

For when the Kindle has reverted to the stock library view (framework
running, dashboard loop dead). Written to be executed by a Claude Code
session **on the dev machine** (the cloud sandbox cannot reach the LAN),
but works equally as a human checklist.

## Known failure classes

Check the logs before assuming any of these — the 2026-08-07 incident matched
the second, not the first, and the first was the only one documented at the time.

**1. WiFi radio sleep.** The pre-remediation `on-boot.sh` launched the loop
without WiFi keep-alive, so the radio could sleep on battery and fetches died.
Signature: repeated `WiFi timeout` / `not reachable` in `loop.log`.

> Caveat: `keepAliveWirelessRadio` **does not exist on Kindle Touch** — powerd
> returns `lipcErrNoSuchProperty`, and `start.sh` has always logged that. So
> "deploy the fixed scripts" does *not* close this gap on this hardware; only
> the driver-level `iwconfig power off` applies. Treat a keep-alive diagnosis
> with suspicion on Touch.

**2. Battery exhaustion.** The device simply runs flat and powers off.
Signature: `loop.log` ends *cleanly* mid-cycle — a successful fetch followed by
`Sleeping Ns (next fetch ~HH:MM)` that never returns — with no error at all, and
a descending `battery=N` in the fetch URLs over the preceding cycles. Seen
2026-06-18 (`5 → 4 → 3%`). Nothing in the scripts prevents this; it needs a
charger. Confirm the low-battery Discord alert is actually configured
(`DISCORD_WEBHOOK_URL` in `server/.env` on the Pi).

**3. Boot job never fires.** The device rebooted but the dashboard did not come
back, leaving the stock library view. Signature: `uptime` is short, and
`logs/boot.log` is **absent or stale**. See §4b — the trigger event matters.

## 0. Prerequisites (dev machine)

- This repo checked out on `main` (`git pull origin main`).
- `export KINDLE_PASSWORD='...'` (the Kindle root password — post-rotation
  value; see `SECURITY_ROTATION.md`). Note this must be exported in the *same*
  shell that runs the commands; an agent driving this runbook spawns its own
  shells and will not inherit an export from an interactive terminal.
- `sshpass` installed (`brew install sshpass` / `apt install sshpass`).
- On the same LAN as the devices.

## 1. Network access

**The Kindle accepts direct password SSH from the dev machine.** No jump host
is needed, and `deploy-kindle.sh` connects directly too. Use this form
throughout:

```bash
kindle() {
  sshpass -p "$KINDLE_PASSWORD" ssh \
    -o PreferredAuthentications=password -o PubkeyAuthentication=no \
    -o StrictHostKeyChecking=no \
    root@192.168.50.104 "$@"
}
```

Notes:

- The Kindle does **not** answer ICMP. `ping` failing means nothing; test with
  `nc -z 192.168.50.104 22` instead.
- Pi key auth is **not** reliably set up (`Permission denied (publickey,password)`
  from at least one dev machine, with an empty ssh-agent). Only §2a needs the
  Pi, and the `/health` check there is plain HTTP. Route through the Pi as a
  jump host (`-o ProxyJump=pi@192.168.50.163`) only if direct SSH ever fails.
- `/sbin` is not on the device's `PATH` (`PATH=/usr/bin:/bin`) — call
  privileged binaries by full path, e.g. `/sbin/reboot`.

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
# NOTE: busybox's plain `ps` prints no command line, so `ps | grep
# dashboard-loop` always looks empty — a false negative. Use `ps aux`.
kindle 'cat /mnt/us/dashboard/dashboard-loop.pid 2>/dev/null; ps aux | grep dashboard-loop | grep -v grep'
kindle 'pid=$(cat /mnt/us/dashboard/dashboard-loop.pid 2>/dev/null); kill -0 "$pid" 2>/dev/null && echo ALIVE || echo DEAD'

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

Interpret, against the failure classes at the top:

- **`loop.log` ends cleanly** on a `Sleeping Ns` line with a descending
  `battery=N` before it → class 2, battery exhaustion. The device powered off.
  Do not go looking for a WiFi fault; there isn't one.
- **`loop.log` shows repeated WiFi/reachability errors** → class 1. But check
  whether `keepAliveWirelessRadio` is even supported (it is not on Touch).
- **Short `uptime` and no/stale `boot.log`** → class 3, the boot job never ran.
  Note the *old* job never called `on-boot.sh` at all, so on a device that has
  not been fixed yet, an absent `boot.log` proves nothing on its own.
- `date` vs. the last log timestamp gives you the outage window.

## 3. Recover — deploy the fixed scripts, then restart dashboard mode

```bash
cd /path/to/e_ink_screen        # repo root, on main (or the PR branch)
./scripts/validate.sh           # sanity gate
./deploy-kindle.sh --restart    # ships the live script set + stop/start
```

`deploy-kindle.sh --restart` runs `stop.sh` then `start.sh` on the device,
which: stops the framework, clears the screen, sets `preventScreenSaver 1`,
disables WiFi power management (`iwconfig <if> power off` — the
`keepAliveWirelessRadio` attempt is a no-op on Touch, see the caveat above),
and launches `dashboard-loop.sh`. The library view should be replaced by
the dashboard within ~1 minute.

Manual fallback (if the deploy script can't run for some reason):

```bash
kindle 'sh /mnt/us/dashboard/stop.sh; sh /mnt/us/dashboard/start.sh'
```

## 4. Verify

### 4a. Immediately

```bash
kindle 'cat /mnt/us/dashboard/dashboard-loop.pid; ps aux | grep dashboard-loop | grep -v grep'
kindle 'lipc-get-prop com.lab126.powerd preventScreenSaver'   # expect 1
kindle 'tail -20 /mnt/us/dashboard/logs/dashboard-loop.log'
# and look at the physical screen: dashboard, not library
```

(`ps aux`, not `ps` — see §2b.)

Then after ~15–16 minutes, confirm a second fetch landed:

```bash
kindle 'tail -5 /mnt/us/dashboard/logs/fetch.log'
```

### 4b. Boot job (the thing that makes recovery automatic next time)

The canonical job is version-controlled at `kindle/upstart/dashboard.conf`.
Install or repair it with:

```bash
./deploy-kindle.sh --install-boot-job
```

That backs up any existing job to `/mnt/us/dashboard/dashboard.conf.bak` and
handles the read-only rootfs remount. Verify:

```bash
kindle 'cat /etc/upstart/dashboard.conf'
kindle 'mount | grep /dev/root'     # expect (ro,...) again afterwards
```

**Two rules that job encodes — do not "fix" them back:**

- **Trigger on `started lab126_gui`, never `started cron`.** crond starts
  *before* the FUSE mount providing `/mnt/us` (measured: crond pid 636, `fsp`
  pid 943). A cron-triggered job runs while `/mnt/us/dashboard` does not exist,
  so its redirect fails and the script block dies leaving no loop and no log
  whatsoever. An earlier revision of this runbook advised preserving an
  existing job's `start on` stanza on the grounds that "it was working" — that
  premise was false, and following it produced a failed reboot test.
- **Stop on `stopping system`, never `stopping lab126_gui`.** `start.sh` stops
  the framework deliberately; pairing that with a `lab126_gui` stop condition
  makes the job kill the loop it just launched.

Also note `/mnt/base-us` is `vfat,noexec` under a FUSE overlay, so exec bits
there are meaningless — the job must invoke `sh <script>`, never `exec <script>`.

### 4c. Reboot test (the real proof)

```bash
kindle '/sbin/reboot'        # NOT `reboot` — /sbin is not on the device PATH
```

Confirm the device *actually* rebooted before judging the result — SSH stays
briefly answerable after the command, so a "port 22 is open" check gives a
false positive. Poll uptime instead:

```bash
kindle 'cut -d. -f1 /proc/uptime'    # small number = genuinely rebooted
```

Then wait ~3 minutes (on-boot sleeps 30s, then waits for WiFi) and check:

```bash
kindle 'ps aux | grep dashboard-loop | grep -v grep'
kindle 'lipc-get-prop com.lab126.powerd preventScreenSaver'   # expect 1
kindle 'tail -15 /mnt/us/dashboard/logs/boot.log'
```

`boot.log` existing and populated is the signal that the boot job fired at all.
The dashboard should come back on its own.

## 5. Report

Summarize from the saved `/tmp/kindle-recovery/*` logs: which failure class
matched (see the top of this file), what was deployed, and the verification
results. Match the evidence to a class rather than assuming the first one —
don't guess. If it fits none of them, file the logs.
