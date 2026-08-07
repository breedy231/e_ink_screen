# Kindle Dashboard Project

**Goal**: A low-power e-ink dashboard on a jailbroken Kindle Touch (4th gen)
showing time, weather, calendar, a daily Pokemon, and device status. A
Raspberry Pi renders PNGs; the Kindle fetches and displays them on a loop.

See `CHANGELOG.md` for project history, `REVIEW_FINDINGS.md` for the 2026-08
codebase review that shaped the current structure.

## Architecture (production)

```
┌──────────────────────┐   GET /dashboard?battery=N&charging=N   ┌──────────────────────────┐
│ Kindle Touch         │ ──────────────────────────────────────▶ │ Raspberry Pi             │
│ 192.168.50.104       │       e-ink optimized PNG (~25KB)       │ 192.168.50.163:3000      │
│                      │ ◀────────────────────────────────────── │                          │
│ upstart: dashboard   │                                         │ systemd:                 │
│  └─ on-boot.sh       │                                         │  kindle-dashboard        │
│     └─ start.sh      │                                         │  └─ local-dashboard-     │
│        └─ dashboard-loop.sh  (15 min, 7am-10pm CT)             │     server.js            │
│           └─ fetch-dashboard.sh → eips                         │  (~/dashboard-server)    │
└──────────────────────┘                                         └──────────────────────────┘
```

Deploys are manual: `./deploy-to-pi.sh` rsyncs `server/` to `~/dashboard-server/server`
on the Pi and restarts the systemd unit. There is no git checkout or auto-deploy
timer running in production — `pi/setup-auto-deploy.sh` can set one up
(`kindle-dashboard-updater.timer`, git-pull based) but it has never been applied
to this Pi (verified 2026-08-07).

- **Kindle side** (`kindle/`): POSIX shell scripts. `on-boot.sh` (launched by
  the upstart job `/etc/upstart/dashboard.conf`) delegates to `start.sh`,
  which stops the framework, prevents sleep, enables WiFi keep-alive, and
  spawns `dashboard-loop.sh`. The loop fetches via `fetch-dashboard.sh` every
  `UPDATE_INTERVAL` seconds (default 900, aligned to clock boundaries) within
  active hours, and displays with `eips`. Config: `kindle/config/dashboard.conf`.
- **Server side** (`server/`): Node.js + canvas. `local-dashboard-server.js`
  is a thin HTTP layer (routing, 60s cache, Discord battery alerts) over
  `generate.js`, the single render pipeline also used by the CLI
  (`generate-flexible-dashboard.js`). Components live in
  `dashboard-engine.js`; environment config in `config.js`; PNG
  post-processing in `optimize-for-eink.py` (Pillow).
- **Pi ops** (`pi/`): `setup-auto-deploy.sh` bootstraps the systemd service +
  venv; `auto-deploy.sh` runs on a timer to git-pull and restart on changes.

### Why a persistent loop instead of cron
RTC wake does NOT work on this Kindle Touch (`rtcwake` → "short write";
`echo mem > /sys/power/state` returns immediately). With the framework
running, powerd suspends the CPU after ~5 min regardless of
`preventScreenSaver`, which kills cron. The only reliable pattern: stop the
framework, set `preventScreenSaver 1`, and keep a foreground loop alive.

## Configuration

**Server** — env vars with defaults in `server/config.js`, loaded on the Pi
from `server/.env` via the systemd unit (`EnvironmentFile=`). Copy
`server/.env.example` to get started. Key values: `PORT`, `HOST`,
`DEFAULT_LAYOUT`, `TIMEZONE`, `LATITUDE`/`LONGITUDE`, `CALENDAR_URL`
(secret — private iCloud URL), `DISCORD_WEBHOOK_URL`, `PYTHON_BIN`.

**Kindle** — `kindle/config/dashboard.conf`, flat-sourced by
`fetch-dashboard.sh` and `dashboard-loop.sh`. Only add keys that a script
actually reads, and never name one after a script-local variable (the config
once clobbered the loop's `LOG_FILE`). CLI flags beat config values.

**Secrets** are never committed: `KINDLE_PASSWORD` and `CALENDAR_URL` come
from the environment. `scripts/validate.sh` fails the build if known secret
patterns reappear. See `SECURITY_ROTATION.md`.

## How to add a dashboard component (e.g. tasks, news)

1. **Service** (if it needs data): `server/<thing>-service.js` following
   `calendar-service.js` — constructor takes options with `config.js`
   defaults, file cache under `cache/`, graceful fallback chain
   (API → cache → expired cache → empty/mock).
2. **Component**: class in `server/dashboard-engine.js` extending
   `ComponentBase`, with `static dataNeeds = ['<need>']` and a `render(ctx,
   bounds)`. Add one entry to `COMPONENT_REGISTRY` and (for a new data type)
   `DATA_CONFIG_KEYS`, plus the fetch branch in `generate.js`.
3. **Layout**: reference the type from a JSON file in `server/layouts/`.

Enrichment and service selection are registry-driven — there is nothing else
to wire. Test with `node generate-flexible-dashboard.js <layout> --mock`.

## Shell Compatibility Rules for Kindle Development

### CRITICAL: Kindle uses busybox ash, NOT bash
All `kindle/*.sh` scripts must be POSIX-compatible with `#!/bin/sh` shebangs
(bash does not exist on the device). `local` is allowed (busybox supports it).

#### ❌ NEVER USE (bash-specific)
```bash
local arr=("item1" "item2")          # arrays
if [[ condition ]]; then              # double-bracket test
${BASH_SOURCE[0]}                     # bash source array
set -euo pipefail                     # -u/-o pipefail unsupported
for ((i=1; i<=10; i++)); do           # C-style loops
((var++))                             # arithmetic increment — syntax error
while read l; do ...; done < <(cmd)   # process substitution
if [[ "$var" == "value" ]]; then      # == comparison
source file.conf                      # bash 'source'
command -v foo                        # not a busybox builtin
```

#### ✅ ALWAYS USE (POSIX)
```bash
for item in item1 item2 item3; do     # space-separated loops
if [ condition ]; then                # single-bracket test
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
set -e                                # basic set only
i=$((i + 1))                          # POSIX arithmetic
if [ "$var" = "value" ]; then         # = comparison
. file.conf                           # dot-sourcing
type foo >/dev/null 2>&1              # command existence check
case "$s" in *"?"*) ... ;; esac       # pattern matching ([ ] can't glob)
```

Device quirks that shape the scripts:
- `/mnt/us` is a **FUSE overlay (`fuse.fsp`) on top of `vfat,noexec`
  `/mnt/base-us`** — exec bits are meaningless there, so scripts invoke each
  other as `sh "$script"` and gate on `-f`, never `-x`. A bare
  `exec /mnt/us/...` fails silently; this broke the upstart boot job.
- busybox `wget` only takes short options (`-q -O`) and has no `--timeout`.
- busybox plain `ps` prints no command line — use `ps aux` when checking
  whether the loop is running, or `ps | grep` will look like a false negative.
- `/sbin` is not on the device's `PATH` (`PATH=/usr/bin:/bin`). Use
  `/sbin/reboot`, not `reboot`.
- The device does not answer ICMP; `ping` failing says nothing. Use
  `nc -z <ip> 22`.
- `keepAliveWirelessRadio` does not exist on Kindle Touch powerd
  (`lipcErrNoSuchProperty`). Only `iwconfig <if> power off` holds the radio up.

Verify before deploy: `sh -n kindle/*.sh` (or just run `./scripts/validate.sh`).

## Essential Kindle commands

```bash
/usr/sbin/eips -g file.png            # display image (partial refresh)
/usr/sbin/eips -f -g file.png         # display image (full refresh, clears ghosting)
gasgauge-info -c                      # battery %
lipc-get-prop com.lab126.powerd isCharging
lipc-set-prop com.lab126.powerd preventScreenSaver 1   # after framework stop
lipc-set-prop com.lab126.powerd keepAliveWirelessRadio 1
/sbin/stop framework                  # upstart (this device); /etc/init.d/framework on others
mount -o remount,rw /                 # /etc is read-only; remount to edit, then ro
```

## Development workflow

```bash
# Validate everything (syntax, secrets, exec bits, unit tests)
./scripts/validate.sh

# Server unit tests
cd server && npm test

# Render layouts locally (no network/device needed)
cd server && node generate-flexible-dashboard.js wild-swiss --mock
node generate-flexible-dashboard.js --list
node generate-flexible-dashboard.js --all --test

# Run the server locally
cd server && npm start                # then: curl localhost:3000/dashboard

# Deploy
./deploy-to-pi.sh                     # server → Pi (rsync + systemd restart)
KINDLE_PASSWORD=... ./deploy-kindle.sh --restart   # scripts → Kindle
KINDLE_PASSWORD=... ./deploy-kindle.sh --install-boot-job  # upstart job (writes rootfs)
```

Always run `./scripts/validate.sh` before deploying, and validate visual
changes on the actual e-ink display — it behaves nothing like an LCD.

### Image requirements
600x800 portrait, grayscale PNG, no alpha, high contrast (pure black on
white), no gradients. The server's `optimize-for-eink.py` pass
(grayscale + autocontrast + resize) is mandatory for production images.

## Device & network reference

- **Kindle Touch 4th gen**: 600x800 e-ink, 16-level grayscale, jailbroken
  with KUAL + SSH. IP `192.168.50.104`. **Direct password SSH from the dev
  machine works** — no jump host needed, and `deploy-kindle.sh` connects
  directly. Force password auth (`-o PreferredAuthentications=password -o
  PubkeyAuthentication=no`); key auth is not set up. Root password:
  `KINDLE_PASSWORD` env — never committed (it was once; see
  `SECURITY_ROTATION.md` for the rotation runbook).
- **Raspberry Pi**: `192.168.50.163`. Server code lives at `~/dashboard-server/server`
  on the Pi — plain files rsynced by `./deploy-to-pi.sh`, NOT a git checkout — run
  under the `kindle-dashboard` systemd service (`WorkingDirectory=~/dashboard-server/server`,
  `EnvironmentFile=~/dashboard-server/.env`). There is no auto-deploy timer active;
  `pi/setup-auto-deploy.sh` can set up a git-pull-based `kindle-dashboard-updater.timer`
  but it has never been run here — a long `/health` uptime just means nobody has
  run `deploy-to-pi.sh` recently, not that a timer is quietly doing its job.
  A stray `~/kindle-dashboard` directory also exists on the Pi (an old plain
  copy, not a git repo, not wired to any systemd unit) — don't confuse it with
  the live `~/dashboard-server`. SSH from this Mac needed a key installed via
  `ssh-copy-id` (fixed 2026-08-07, alias `pi` added to `~/.ssh/config`); if a
  future dev machine hits `Permission denied (publickey,password)`, that's
  per-machine, not a Pi-side problem — unblock it before server-side debugging.
  `/health` on port 3000 is plain HTTP and needs no SSH.
- Ops runbook: `PI_PRODUCTION_GUIDE.md`. Layout system: `DASHBOARD_LAYOUTS.md`.

## TRMNL integration (optional)

The dashboard can alternate with screens from a self-hosted TRMNL BYOS
instance (e.g. `usetrmnl/byos_laravel`) instead of showing only the Kindle
layout. `server/trmnl-service.js` polls the BYOS `/api/display` endpoint the
same way real TRMNL firmware would and downloads the rendered PNG; the
`trmnl` component in `dashboard-engine.js` rotates it into the portrait
canvas via the `layouts/trmnl.json` layout. It's entirely additive and off
by default — `TRMNL_MODE` (`off` / `alternate` / `only`) in `config.js`
gates whether `local-dashboard-server.js` ever resolves to that layout, and
an unconfigured or unreachable BYOS instance falls back to the normal
layout, never a broken image. See `TRMNL_SETUP.md` for setup.
