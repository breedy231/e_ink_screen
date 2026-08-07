# Changelog

Milestone history, most recent first. Task IDs (KD-XXX) reference the
original planning tickets.

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
