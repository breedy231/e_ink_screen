# Changelog

Milestone history, most recent first. Task IDs (KD-XXX) reference the
original planning tickets.

- **2026-08-16 — CTA transit goes actually-live; faster rotation**: dropped the
  real CTA Bus Tracker + Train Tracker keys into the Pi's `.env` and confirmed
  live data end to end (`rail.source`/`bus.source` = `api`, real arrivals for
  Halsted & Cornelia, Lake Shore & Cornelia, and Belmont). **Correcting the
  2026-08-10 entry below: the transit screen never actually shipped to the
  Pi.** The Pi had no `transit-service.js` and returned 404 for `/api/transit`;
  what was really feeding BYOS was a hand-started `node
  local-dashboard-server.js` on the Mac (launched Aug 10 19:03, still running
  six days later, no launchd job, no `.env` — and `config.js` has no dotenv, so
  the keys would only ever live in that one process's environment). Any reboot
  would have killed the CTA screen permanently. Fixed by running the real
  `deploy-to-pi.sh` (first deploy of ~6 days of accumulated `server/` changes;
  `validate.sh` + 20 transit tests green first), repointing the "CTA Transit"
  recipe's polling URL from `192.168.50.204:3000` (Mac) to
  `192.168.50.163:3000` (Pi), and killing the orphaned Mac process. Also fixed
  the Service Alerts block, which rendered four identical "Temporary Reroute"
  lines — the payload carries `routes` per alert, the Liquid just wasn't using
  it, so it now reads `146, 148 · Temporary Reroute`. Rotation cadence: the
  Kindle's `UPDATE_INTERVAL` is the binding constraint, not
  `TRMNL_CACHE_TTL_MS` — screens change every `max(UPDATE_INTERVAL,
  TRMNL_CACHE_TTL_MS)`, so the old 10-min TTL under a 15-min poll did nothing.
  Set TTL to **4 min** (not 5) and `UPDATE_INTERVAL` to 5 min: if both were
  300s, a poll arriving at 299s of cache age would serve a stale image and skip
  a playlist advance, silently yielding 10-min cadence. Note
  `TRMNL_SLOT_MINUTES` is dead config under `TRMNL_MODE=only` —
  `local-dashboard-server.js:192` only reads it in `alternate` mode.
- **2026-08-10 — CTA transit screen + `TRMNL_MODE=only`**: built the transit
  screen from `TRANSIT_SCREEN_PLAN.md`. `server/transit-stops.js` has the
  GTFS-derived real stop IDs/mapids/ride times for Broadway & Cornelia
  (Belmont Red/Brown + routes 8/146/151), Loop-bound only.
  `server/transit-service.js` follows the existing cache + fallback chain
  (cache → expired cache → fixture) and is fixture-backed until the CTA Bus
  Tracker and Train Tracker keys arrive — alerts need no key so those are
  live now. `/api/transit` on `local-dashboard-server.js` serves it as JSON;
  20 unit tests in `transit-service.test.js` cover parsing, direction
  filtering, and the late-night empty state (`hasAnyArrivals`). A "CTA
  Transit" BYOS recipe renders it landscape via Liquid, with the
  `.item`/`.meta` framework classes swapped for plain inline flexbox after
  the framework classes overlapped badly. Then flipped the Pi to
  `TRMNL_MODE=only` (from `alternate`) — TRMNL is now the sole source for
  `/dashboard`, since the native portrait `wild-swiss` layout would render
  sideways once the Kindle is remounted landscape (see
  `TRANSIT_SCREEN_PLAN.md`'s architecture section and `TRMNL_SETUP.md`'s
  "Sideways content" section). Note: `.env` lives only on the Pi and isn't
  synced by `deploy-to-pi.sh` — `TRMNL_MODE` was changed via
  `ssh pi` + manual edit, not a normal deploy.
- **2026-08-10 — TRMNL local preview + BYOS hardening**: added
  `server/trmnl-preview.py` (`npm run trmnl:preview`), which renders what
  the Kindle would show on the dev machine — no Pi, no SSH, no e-ink round
  trip — using the alias endpoint so iterating on a recipe doesn't perturb
  the live playlist. `npm run trmnl:serve` exposes the same renders over the
  LAN (port 4568) for browsing from another machine. Added `TRMNL_ROTATION=none` to letterbox TRMNL's
  landscape screens upright instead of turning them sideways, after
  confirming a "portrait" BYOS device model doesn't help (BYOS renders
  landscape, then rotates the bitmap). Hourly backups of the BYOS sqlite DB
  (`scripts/backup-byos-db.sh` + launchd), and Docker Desktop set to
  auto-start at login so `restart: unless-stopped` can actually fire.
- **2026-08-10 — TRMNL BYOS goes to production**: permanent `byos_laravel`
  instance stood up (Docker, always-on host), a virtual device registered,
  and the Pi flipped to `TRMNL_MODE=alternate`. Found and fixed a
  production bug where BYOS's `APP_URL` pointed at a Tailscale address the
  Pi couldn't reach, causing every image download to silently time out and
  serve a 3-day-stale cached screen despite `/health` reporting healthy —
  see `TRMNL_SETUP.md`'s "Production gotcha" section.
- **2026-08-03 — Codebase remediation** (see `REVIEW_FINDINGS.md`): secrets
  externalized to env vars; cron-era test suite replaced by
  `scripts/validate.sh`; ~40% dead code deleted; six production bugs fixed in
  the Kindle scripts (broken fallback path, boot-path WiFi keep-alive, log
  collision, malformed --force URLs, stale fallback IP, vfat exec-bit
  reliance); server pipelines unified behind `generate.js` + component
  registry + `config.js`; docs rewritten.
- **2026-03-10 — [KD-014] Sleep fix + V2 layout**: replaced cron with the
  persistent `dashboard-loop.sh` (framework stop + preventScreenSaver is the
  only pattern that survives on battery; RTC wake is broken on this device).
  Upstart boot job, WiFi keep-alive, editorial `weather-pokemon-v2` layout,
  calendar + daily quote + status bar components. Later switched production
  to the `wild-swiss` layout and a 15-minute clock-aligned interval.
- **2025-11-01 — [KD-013] Raspberry Pi production deployment**: systemd
  service on the Pi (192.168.50.163:3000), auto-deploy timer, e-ink
  optimization server-side.
- **[KD-012] Local auto-update system**: local HTTP server + Kindle-side
  scheduled fetching (superseded by KD-013/KD-014).
- **[KD-011] Sleep prevention**: `preventScreenSaver` integration and POSIX
  shell fixes for the Kindle's busybox ash.
- **[KD-010] Netlify/cloud deployment**: planned, never implemented — the Pi
  deployment served the need better (local, free, faster). Do not resurrect
  from old docs.
- **[KD-009] KUAL integration menu**: planned; the KUAL extension was never
  committed to the repo, and the loop architecture made it moot.
- **[KD-008] Weather integration**: Open-Meteo (no API key), 30-min cache,
  fallback chain, e-ink weather symbols.
- **[KD-007] Device statistics**: `kindle/get-device-stats.sh`; production
  battery/charging now arrives as query params on each fetch.
- **[KD-006] Flexible layout system**: grid-based `dashboard-engine.js` with
  JSON layouts and reusable components.
- **Initial MVP**: server-side PNG generation + Kindle fetch/display scripts.
