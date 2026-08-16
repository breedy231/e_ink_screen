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

## Second screen — kitchen "Live Paper" (planned, 2026-08-16)

A second e-ink screen is planned for the kitchen: a daily "paper" (2–3
time-of-day faces) complementing v0's live status. **Start at
`KITCHEN_HANDOFF.md`**, then `KITCHEN_SCREEN_PLAN.md` for the design and the
jailbreak runbook.

Device is confirmed: **Kindle Paperwhite 3** (7th gen, `DP75SDI`, serial
`G090…`) on **firmware 5.12.3** — jailbreakable via WinterBreak2. Render target
is **1072x1448 portrait**, versus v0's 600x800.

Two things to know before touching server code:

- **Alert state is now per-device** (`server/device-alerts.js`,
  `DeviceAlertRegistry`). Previously one shared set of state machines meant any
  second device polling `/dashboard` would continuously re-arm v0's staleness
  alert and let it die silently. Devices are identified by `?device=`; an
  absent param means v0, so the existing Kindle is unaffected.
  `MONITORED_DEVICES` in `config.js` defaults to `v0` — add `kitchen` only once
  that screen actually polls, or it goes stale immediately and alerts on every
  check.
- **The kitchen screen is deliberately NOT a TRMNL/Liquid recipe.** BYOS
  renders landscape markup then rotates the bitmap, so it cannot produce a
  portrait page, and 800x480 letterboxed onto a 1072x1448 panel wastes most of
  it. The kitchen renders HTML→PNG at native resolution on the Mac. v0 stays
  TRMNL/landscape; they diverge at the render layer on purpose.

## TRMNL integration (optional)

The dashboard can alternate with screens from a self-hosted TRMNL BYOS
instance (e.g. `usetrmnl/byos_laravel`) instead of showing only the Kindle
layout. `server/trmnl-service.js` polls the BYOS `/api/display` endpoint the
same way real TRMNL firmware would and downloads the rendered PNG; the
`trmnl` component in `dashboard-engine.js` rotates it into the portrait
canvas via the `layouts/trmnl.json` layout. It's entirely additive and off
by default in the code — `TRMNL_MODE` (`off` / `alternate` / `only`) in
`config.js` gates whether `local-dashboard-server.js` ever resolves to
that layout, and an unconfigured or unreachable BYOS instance falls back
to the normal layout, never a broken image. See `TRMNL_SETUP.md` for setup
and troubleshooting (including a real production incident where a
misconfigured `APP_URL` silently broke image fetches for days without
tripping `/health`).

**Current production state (2026-08-10):** live, **`TRMNL_MODE=only`** on
the Pi (flipped from `alternate` — TRMNL is now the sole source for
`/dashboard`; native portrait layouts like `wild-swiss` are unused, see
"Landscape mount" below). BYOS (`byos_laravel`) runs as a Docker container
on Brendan's always-on Mac (`~/services/byos_laravel/docker/prod`),
reachable from the Pi at `http://192.168.50.204:4567`. Playlist is mostly
still the seeded demo recipes (weather, quotes, history, etc.) plus one
real recipe: **"CTA Transit"** (`server/transit-service.js` +
`/api/transit`) — **fully live as of 2026-08-16**: both CTA keys are in the
Pi's `.env` and the recipe polls `http://192.168.50.163:3000/api/transit`.
Most of the playlist is still not real content.

Cautionary tale worth remembering: from 2026-08-10 to 2026-08-16 this screen
*looked* shipped but the code had never been deployed to the Pi — BYOS was
polling a hand-started `node` process on the Mac. **`deploy-to-pi.sh` is
manual and nothing verifies it ran**, so "it works" and "it's deployed" are
independent facts here. Check `curl http://192.168.50.163:3000/api/<thing>`
before believing a feature is in production.

`.env` (including `TRMNL_MODE`) lives only on the Pi at
`~/dashboard-server/.env` and is **not synced by `deploy-to-pi.sh`** — it's
excluded like other secrets. Change it via `ssh pi`, edit, then
`sudo systemctl restart kindle-dashboard`.

Iterate on screens with `npm run trmnl:preview` / `npm run trmnl:serve`
(see `TRMNL_SETUP.md`), which renders what the Kindle would show locally —
don't push to the device to look at a layout. Docker Desktop now auto-starts
at login and the BYOS sqlite DB is backed up hourly by
`scripts/backup-byos-db.sh`, but FileVault means a cold reboot still needs a
human to log in before BYOS comes back.

### Landscape mount (decided 2026-08-10, not yet physically done)

TRMNL renders landscape; `TRMNL_ROTATION=cw` rotates that into the 600x800
file the Kindle displays. This reads sideways on today's **portrait**-mounted
Kindle. The fix is physical, not software: remount the Kindle **landscape**
(`hardware/kindle-frame-mount.scad` supports both orientations) — once
that's done, the same `cw` render reads upright at full resolution. See
`TRMNL_SETUP.md`'s "Sideways content" section.

This is why `TRMNL_MODE=only`: once landscape-mounted, the native portrait
`wild-swiss` layout would be the thing rendering sideways, so it's off
rather than live with a mixed/broken rotation. It hasn't been redone for a
landscape canvas — that's still open, see below.

### Rotation cadence (investigated 2026-08-15, changed 2026-08-16)

**Current setting: ~5 min.** `TRMNL_CACHE_TTL_MS=240000` (Pi `.env`) and
`UPDATE_INTERVAL=300` (Kindle config). The TTL is deliberately 4 min, not 5:
the effective cadence is `max(UPDATE_INTERVAL, TRMNL_CACHE_TTL_MS)`, so equal
values risk a poll finding the cache 299s old, serving a stale image and
skipping the playlist advance — which would silently give 10-min cadence.
Keep the TTL comfortably below the poll interval. Also note
`TRMNL_SLOT_MINUTES` does nothing under `TRMNL_MODE=only`
(`local-dashboard-server.js:192` reads it only in `alternate` mode).

The pre-2026-08-16 analysis below is retained for the mechanism:

No internal BYOS timer — the playlist advances one item per authenticated
`GET /api/display` call. Two caches gate how often that happens in
practice: the Kindle's own fetch loop (`UPDATE_INTERVAL`, 15 min, 7am–10pm
CT) and `trmnl-service.js`'s local screen cache (`TRMNL_CACHE_TTL_MS`,
10 min default, confirmed on the Pi `.env`). Since 10 min < 15 min, every
Kindle poll finds the cache stale and re-hits BYOS — net effect is **one
playlist advance per Kindle poll, ~every 15 min, 7am–10pm CT (~60/day)**.
`local-dashboard-server.js`'s separate 60s `CACHE_TTL_MS` image cache
doesn't change this (60s < 15 min, so it never blocks a poll). **The
LaraPaper admin UI has no manual "advance/next screen" button** — closest
are per-device Pause and per-recipe "Fetch data now" (refetches that
recipe's data source only, doesn't push a screen). The playlist's "Edit
Playlist" modal has a "refresh seconds" field, but BYOS is pull-based —
the Pi decides when to poll, so that field doesn't shorten cadence on its
own; lowering the effective interval means lowering `TRMNL_CACHE_TTL_MS`
and/or `UPDATE_INTERVAL` together. CLI-only forced advance:
`npm run trmnl:preview -- --next`.

### Handoff prompt for the next session

> Continue work on the e_ink_screen Kindle dashboard
> (`~/Projects/e_ink_screen`). TRMNL is the sole source for `/dashboard`
> (`TRMNL_MODE=only` on the Pi); native portrait layouts (`wild-swiss` etc.)
> are unused, see "Landscape mount" above. The CTA transit screen shipped
> 2026-08-10 (`CHANGELOG.md`, `TRANSIT_SCREEN_PLAN.md`) but is still
> fixture-backed for bus/train — only alerts are live.
>
> Two goals for this session, from Brendan directly (2026-08-15): refine
> the CTA tracker, and generally make the rotation feel more like what he
> actually wants day to day — faster cycling through screens and more
> custom recipes, not just the seeded demos. Concretely:
>
> 1. **CTA tracker refinement.** Ask Brendan what's bugging him about it
>    day to day before assuming — could be the fixture data being stale/
>    unrealistic, the layout, or something else. Separately, check whether
>    the CTA Bus Tracker / Train Tracker API keys have arrived yet; if so
>    that's the long-pole item from `TRANSIT_SCREEN_PLAN.md` and unblocks
>    swapping fixtures for live data in `server/transit-service.js` (just
>    drop keys into the Pi's `.env`, fallback chain prefers live
>    automatically — no code change).
> 2. **Faster rotation.** See "Rotation cadence" above for the mechanism.
>    To actually speed it up: lower `TRMNL_CACHE_TTL_MS` (currently 10 min)
>    and/or the Kindle's `UPDATE_INTERVAL` (currently 15 min) together on
>    the Pi's `.env` / Kindle config — but weigh the tradeoff first: more
>    frequent polling means more e-ink refreshes (visible flashing, panel
>    wear) and more load on the always-on Mac hosting BYOS. Ask Brendan
>    what cadence he actually wants before changing it blindly.
> 3. **More real recipes.** Most of the playlist is still seeded demo
>    plugins (weather, quotes, history, Home Assistant, etc.), some erroring
>    (e.g. "Weather forecast data not found"). Follow the CTA Transit
>    pattern for new ones: Node-side service + cache/fallback chain + JSON
>    endpoint (reuse `weather-service.js`/`calendar-service.js`/
>    `pokemon-service.js` where possible) feeding a BYOS Liquid recipe.
>    Ask Brendan what he actually wants to see before building — this is
>    where his day-to-day usage preferences matter most. Also still open:
>    a morning/evening playlist split (`active_from`/`active_until`/
>    `weekdays` per playlist item, already supported by BYOS).
>
> Not yet started, lower priority unless Brendan raises it: redoing
> `wild-swiss` for an 800x480 landscape canvas (only matters if he wants
> native components alongside TRMNL rather than staying TRMNL-only), and
> physically remounting the Kindle landscape (nothing blocks on this
> except seeing renders upright on the real device — flag it as ready
> whenever the frame's been flipped).
