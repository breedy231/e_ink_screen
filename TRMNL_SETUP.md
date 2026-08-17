# TRMNL Integration Setup

The dashboard can optionally show screens from a self-hosted TRMNL BYOS
(Bring Your Own Server) instance, alternating with the normal Kindle
layout. The Pi acts as a "virtual TRMNL device": it polls your BYOS
instance's `/api/display` endpoint the same way real TRMNL firmware would,
downloads the rendered PNG, and composites it (rotated to portrait) into a
`trmnl` layout. The Kindle side is completely unaware of this — it still
just fetches `/dashboard` on its normal loop.

This is additive and off by default (`TRMNL_MODE=off`). Nothing here
changes Kindle scripts, `on-boot.sh`, or the fetch loop.

## 1. Pre-flight: pick where BYOS runs

BYOS implementations (e.g. [usetrmnl/byos_laravel](https://github.com/usetrmnl/byos_laravel))
render screens with headless Chromium, which wants roughly 1GB of RAM free.
If your Pi is memory-constrained, run BYOS on any other always-on machine
on your network instead — `TRMNL_BASE_URL` is just a URL, it doesn't have
to be `localhost`.

BYOS renders on its own schedule (its playlist/recipe cadence), completely
decoupled from the Kindle's 15-minute fetch loop. The dashboard server just
polls whatever BYOS currently has queued.

## 2. Install BYOS

```bash
# On whichever machine will run it
git clone https://github.com/usetrmnl/byos_laravel.git
cd byos_laravel
# For production, use the prebuilt-image compose file, not the root one
# (the root docker-compose.yml builds from source, which is slow and
# unnecessary — docker/prod/docker-compose.yml pulls ghcr.io/usetrmnl/larapaper:latest)
cd docker/prod
cat > .env <<'EOF'
APP_KEY=base64:REPLACE_ME
APP_URL=http://<LAN-IP-of-this-machine>:4567
EOF
# Generate a real key:
#   echo "base64:$(openssl rand -base64 32)"
docker compose up -d
```

Use a free port — 3000 is already taken by the Kindle dashboard server if
you're running BYOS on the same Pi. 4567 is the compose file's default.

**`APP_URL` must be an address every poller (the Pi, and you) can actually
reach** — see the production gotcha below. If this machine is on a VPN/mesh
(Tailscale) that the Pi isn't, use the plain LAN IP, not the mesh address.

## 3. Register a virtual device

In the BYOS web UI:

1. Create an admin account (registration is on by default —
   `REGISTRATION_ENABLED=1`; consider disabling it once you're set up if the
   instance is reachable beyond your LAN).
2. Add a new device. Since there's no physical TRMNL hardware, use a
   locally-administered MAC address (e.g. `02:00:00:00:00:01` — the `02`
   prefix marks it as locally administered so it can't collide with a real
   device).
3. **`byos_laravel`'s API key is client-chosen, not server-generated** —
   unlike official TRMNL, the "Add Device" form has a required "API Key"
   text field you fill in yourself (e.g. `openssl rand -hex 16`). That
   value becomes what you put in `TRMNL_API_KEY` below.
4. Configure recipes/playlists for what you want the device to show — see
   "Forcing/testing" below for how to iterate quickly instead of waiting
   for the Kindle's own fetch loop.

## 4. Configure the dashboard server

Add to `server/.env` (see `server/.env.example` for the full list):

```bash
TRMNL_MODE=alternate          # off | alternate | only
TRMNL_BASE_URL=http://localhost:4711
TRMNL_DEVICE_MAC=02:00:00:00:00:01
TRMNL_API_KEY=<access token from step 3>
```

Restart the service:

```bash
# On the Pi
sudo systemctl restart kindle-dashboard
```

## 5. Verify

```bash
# Confirm the server sees BYOS as configured
curl http://localhost:3000/health
# → "trmnl": { "mode": "alternate", "configured": true, "lastScreenFetchedAt": ... }

# Force the TRMNL layout directly
curl "http://localhost:3000/dashboard?layout=trmnl" -o /tmp/trmnl-test.png
```

Once `TRMNL_MODE=alternate` is live, requests flip between the TRMNL
layout and the default layout every `TRMNL_SLOT_MINUTES` (default 15) —
stateless, based on wall-clock epoch, so it doesn't need to track anything
across server restarts. Watch two consecutive Kindle refresh cycles on the
actual e-ink display to confirm alternation looks right in practice.

If the TRMNL screen appears sideways, flip `TRMNL_ROTATION` between `cw`
and `ccw` in `.env` and restart.

## Previewing screens locally (the fast loop)

`server/trmnl-preview.py` renders exactly what the Kindle would show, on
your own machine — no Pi, no SSH, no physical refresh. It pulls a screen
from BYOS and applies the same transform the `trmnl` layout does (rotate
into the 600x800 portrait canvas, then the mandatory e-ink pass).

```bash
cd server
npm run trmnl:preview                          # current screen, opens the PNG
npm run trmnl:preview -- --plugin Weather      # one recipe, rendered fresh
npm run trmnl:preview -- --rotation none       # compare upright vs sideways
npm run trmnl:next                             # advance the playlist, then render
```

### Previewing from another machine

`npm run trmnl:serve` starts a small preview server on port 4568 (next to
BYOS's 4567), bound to all interfaces, and prints its LAN URL. Open that from
any machine on the network: the index lists every recipe, and each one shows
the `cw` render, the `none` render, and the raw landscape screen side by side.
Every request re-renders, so editing a recipe and reloading is the whole loop.

It exposes no playlist-advancing route — a page reload can't perturb the live
rotation the way `--next` deliberately does. Recipes without "Enable Alias"
are listed greyed out rather than hidden, so it's obvious why they aren't
clickable.

Needs Pillow, from the same venv `config.js` already looks for:

```bash
python3 -m venv venv && venv/bin/pip install -r server/requirements.txt
```

Three ways in, with different side effects — this matters, because BYOS
advances its playlist on every device poll:

| Flag | Endpoint | Advances the playlist? |
|---|---|---|
| `--peek` (default) | `/api/current_screen` | No — read-only |
| `--next` | `/api/display` | **Yes**, by one, for real |
| `--plugin X` | `/api/display/<uuid>/alias` | No — renders that plugin standalone |

`--plugin` is the one to iterate with: it re-renders a single recipe on
demand without disturbing the live rotation. It requires "Enable Alias" on
that recipe (recipe page → settings → Enable Alias). `--device-model` picks
which BYOS device model to render at, and `--raw` saves BYOS's landscape
screen without the Kindle transform.

This is a Pillow reimplementation of `TrmnlComponent.render()` rather than a
call into it, because node-canvas renders solid black on the dev Mac (a
Cairo/pixman fault — it drops colour channels; rebuilding from source
against Homebrew's libs does not fix it). The `trmnl` layout is a pure
full-canvas passthrough, so there is nothing else for it to miss, and
`trmnl-service.test.js` asserts the two agree on placement geometry. If you
change the geometry in one, change it in the other.

### Sideways content — resolved by mounting the Kindle landscape

TRMNL markup is landscape; the Kindle panel is portrait. `TRMNL_ROTATION=cw`
or `ccw` fills the screen but the content reads sideways in the rendered
file — the two values only pick which way you'd tilt your head. This used
to mean a real tradeoff (sideways at full res vs. upright but letterboxed).

**Decided 2026-08-10** (see `TRANSIT_SCREEN_PLAN.md`): rather than work
around this in software, physically mount the Kindle landscape.
`hardware/kindle-frame-mount.scad` supports both orientations. Once
landscape-mounted, a `cw`-rotated render reads upright at full resolution —
the "sideways" file is only sideways relative to a portrait mount. This is
why the Pi is running `TRMNL_MODE=only` (see `CLAUDE.md`): the native
portrait `wild-swiss` layout would now be the thing rendering sideways, so
it's off until/unless it's redone for a landscape canvas.

Picking a "portrait" BYOS device model does **not** achieve the same thing
in software alone. Verified against `amazon_kindle_7` (800x600, rotation
90): BYOS renders the markup landscape and then rotates the output bitmap,
so you get a 600x800 file with sideways content — no different from
`TRMNL_ROTATION=cw`. The fix is the physical mount, not a device-model
setting.

`TRMNL_ROTATION=none` (letterboxed, upright, ~600x360 of a 600x800 panel)
is still there for a portrait-mounted device, but is no longer the
recommended path now that landscape mounting is the plan.

## Forcing/testing on the real device

There's no built-in cadence inside BYOS itself — `byos_laravel` advances
its playlist to the next item on *every* poll of `/api/display`, from
anyone with valid auth headers. That means normal operation is entirely
poll-driven: the visible screen only changes as often as something asks.
In this setup that's roughly every `TRMNL_SLOT_MINUTES` × 2 (only every
other Kindle fetch requests the TRMNL layout at all), further capped by
`TRMNL_CACHE_TTL_MS` on the dashboard-server side.

To iterate on playlist/recipe content without waiting on that cadence,
chain three steps — advance BYOS, clear the Pi's cache so it doesn't
serve a stale copy, then force the Kindle to fetch and display immediately:

```bash
# 1. Advance BYOS's playlist by one item (each hit = one step forward)
curl -s -H "ID: <device-mac>" -H "Access-Token: <api-key>" \
  http://<byos-host>:4567/api/display

# 2. Clear the dashboard server's TRMNL cache so it re-fetches instead of
#    serving what it already has (on the Pi, or wherever server/ runs)
rm -f cache/trmnl/screen.png cache/trmnl/screen.meta.json

# 3. Force the Kindle to fetch and display right now (bypasses its own
#    15-min loop timing, but still goes through the normal fetch/eips path)
ssh root@<kindle-ip> \
  "wget -q -O /mnt/us/dashboard/current.png 'http://<pi>:3000/dashboard?layout=trmnl' \
   && /usr/sbin/eips -f -g /mnt/us/dashboard/current.png"
```

Use this only to confirm something on the actual e-ink panel. For iterating
on content or layout, use `npm run trmnl:preview` above — it's seconds
instead of a round trip, and it doesn't perturb the live playlist.

## Keeping the BYOS host alive

BYOS holds state that exists nowhere else — the device registration, its API
key, every recipe and playlist — in a Docker named volume (`prod_database`)
on the host Mac. Two things guard it.

**Backups.** `scripts/backup-byos-db.sh` takes an online snapshot (SQLite
`VACUUM INTO` inside the container, copied out with `docker cp`), verifies
`PRAGMA integrity_check` and that the snapshot actually contains a device,
then applies tiered retention (24 hourly / 14 daily / 8 weekly) to
`~/byos-backups/`. Install the hourly launchd job with:

```bash
./scripts/install-byos-backup.sh      # logs to ~/Library/Logs/com.byos.backup.log
```

To restore, stop the container, `docker cp` a snapshot back over
`database/storage/database.sqlite` in the `prod_database` volume, and start it.

**Restart after reboot.** The compose file's `restart: unless-stopped` only
applies once the Docker daemon is running, and Docker Desktop does not start
itself by default. Set `AutoStart` in
`~/Library/Group Containers/group.com.docker/settings-store.json` (the
"Start Docker Desktop when you sign in" setting) — with it on, quitting and
relaunching Docker brings `prod-app-1` back automatically.

**This still isn't unattended.** The host Mac has FileVault on, so after a
real reboot (power cut, kernel panic) it sits at the unlock screen: no login
means no Docker, no BYOS, and no backup job, until someone types the
password. The failure mode is at least graceful — `trmnl-service.js` falls
back to cache and then to the default Kindle layout — so the dashboard
degrades to "no TRMNL slot" rather than breaking. Don't treat the BYOS host
as a server that self-heals from a cold boot.

## Failure behavior

TRMNL is designed to never make the dashboard worse than it is today:

- BYOS unreachable → serves the last cached screen (even if stale) →
  falls back to the default layout if there's no cache at all.
- BYOS returns something that isn't a PNG (some BYOS setups default to
  BMP) → treated as a fetch failure, same fallback chain as above. If your
  BYOS instance only serves BMP, either reconfigure it to output PNG (most
  BYOS forks support this per-device) or open an issue — a Pillow
  conversion hop is the fallback if that's not possible.
- Any render error in the TRMNL component → falls back to placeholder
  text, never a broken image or a 500.
- Battery alerts run independently of layout resolution and are
  unaffected either way.

## Known unknowns (verify against your actual BYOS instance)

- **Auth headers**: `ID` (MAC) + `Access-Token` (API key) are what the
  reference implementations document — confirmed correct via `curl -v`
  against `usetrmnl/byos_laravel` (2026-08-10).
- **Image format**: some BYOS forks serve BMP by default. `trmnl-service.js`
  only accepts PNG (checked via magic bytes) and treats anything else as a
  failure — see above. Confirmed PNG in practice.
- **`image_url`**: may be absolute or relative to `TRMNL_BASE_URL`;
  `trmnl-service.js` resolves both. **byos_laravel always returns an
  absolute URL built from its own `APP_URL` env var** — see the gotcha
  below, this one bit us in production.

## Production gotcha: `APP_URL` must be reachable from the Pi, not just from you

If your BYOS instance (byos_laravel) is behind a VPN/mesh network like
Tailscale that the Pi *doesn't* have, set `APP_URL` in its `.env` to an
address the **Pi** can actually reach (e.g. the plain LAN IP), not a
Tailscale IP that only your dev machine sees — even if `TRMNL_BASE_URL` on
the Pi's side is already correctly LAN-based.

Symptom: everything *looks* healthy. `/health` reports `configured: true`.
The `/api/display` JSON call succeeds (it hits `TRMNL_BASE_URL`, which was
correctly LAN). But `image_url` in that JSON is built from BYOS's `APP_URL`
— if that's Tailscale-only, the Pi's subsequent image download times out on
every single cycle, and `trmnl-service.js`'s fallback chain silently serves
whatever was last successfully cached (which, on a fresh instance, is
BYOS's own "Welcome! Your device is connected" setup screen) forever. Byte
size stays suspiciously identical across "successful" alternation cycles —
that's the tell.

**Always visually confirm the actual rendered PNG** (not just HTTP status
or file size) after setup: `curl -o /tmp/t.png "http://<pi>:3000/dashboard?layout=trmnl"`
and open it. A stuck/stale screen won't show up as an error anywhere in
`/health` or the fetch logs — it looks identical to success.

If this happens after it was previously working, check
`~/dashboard-server/cache/trmnl/screen.meta.json`'s `fetchedAt` timestamp
on the Pi — a value stuck in the past confirms downloads are failing.
Clearing `~/dashboard-server/cache/trmnl/{screen.png,screen.meta.json}`
after fixing `APP_URL` forces a fresh fetch on the next request.
