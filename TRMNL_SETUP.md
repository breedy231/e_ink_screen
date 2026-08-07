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
docker compose up -d
```

Use a free port — 3000 is already taken by the Kindle dashboard server if
you're running BYOS on the same Pi. 4711 is a reasonable choice.

## 3. Register a virtual device

In the BYOS web UI:

1. Create an admin account.
2. Add a new device. Since there's no physical TRMNL hardware, use a
   locally-administered MAC address (e.g. `02:00:00:00:00:01` — the `02`
   prefix marks it as locally administered so it can't collide with a real
   device).
3. Record the device's MAC address and API key/access token from the admin
   UI — you'll need both for `server/.env`.
4. Configure recipes/playlists for what you want the device to show.

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
  reference implementations document, but confirm with `curl -v` against
  your instance before assuming.
- **Image format**: some BYOS forks serve BMP by default. `trmnl-service.js`
  only accepts PNG (checked via magic bytes) and treats anything else as a
  failure — see above.
- **`image_url`**: may be absolute or relative to `TRMNL_BASE_URL`;
  `trmnl-service.js` resolves both.
