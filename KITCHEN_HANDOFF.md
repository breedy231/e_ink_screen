# Kitchen screen — session handoff

Read this first, then `KITCHEN_SCREEN_PLAN.md` for the full design and the
jailbreak runbook. This file is the state-of-play: what is done, what is not,
what will bite you.

Written 2026-08-16.

---

## The one-paragraph version

A second e-ink screen for the kitchen: a "daily paper" (2–3 faces/day)
complementing the v0 desk dashboard, which stays live-status. Device is
confirmed as a **Kindle Paperwhite 3** (7th gen, `DP75SDI`, serial `G090…`) on
**firmware 5.12.3**, which is jailbreakable. The design is decided, the
blocking server-side bug is fixed, and the jailbreak is scripted. Nothing has
touched the physical device yet. The next real work is the render layer.

## Status

| | State |
|---|---|
| Device identified | **done** — PW3, FW 5.12.3, render target 1072 × 1448 |
| Design decided | **done** — `KITCHEN_SCREEN_PLAN.md` |
| Per-device alert fix | **done, uncommitted** — see Git below |
| Jailbreak scripted | **done, untested against hardware** |
| Jailbreak performed | **not started** |
| Render layer | **not started** ← the real work |
| Data endpoints | **not started** |

## Git — read before committing anything

Branch `claude/bedtime-charge-alert`. **PR #13 is already merged** to
`origin/main`; local `main` is just stale. Nothing to do there.

**A separate, concurrent session owns the transit screen.** Its files
(`server/transit-service.js`, `transit-stops.js`, `transit-service.test.js`,
`server/fixtures/`, `trmnl-preview.py`, `TRANSIT_SCREEN_PLAN.md`) are untracked
or modified in this same working tree. **Do not commit, stage, revert, or
"tidy" them.**

The kitchen work is deliberately left uncommitted because three files are
shared with that session:

- `server/local-dashboard-server.js`
- `server/config.js`
- `server/package.json`

Committing them now would drag transit work into a kitchen commit. Wait for the
transit PR to land, then commit the kitchen change on its own branch.

**Kitchen-owned files (safe, nothing else touches them):**

```
KITCHEN_SCREEN_PLAN.md
KITCHEN_HANDOFF.md
server/device-alerts.js
server/device-alerts.test.js
scripts/stage-kitchen-jailbreak.sh
scripts/setup-kitchen-kindle.sh
```

**Kitchen edits inside shared files** (small, easy to re-apply if they get
clobbered): the `DeviceAlertRegistry` import + construction, `device`-aware
`checkBatteryAndNotify` / `checkBedtimeAndNotify` / `checkStaleness`, the
`resolveId`/`recordFetch` call in `handleDashboardRequest`, a `getCacheKey`
comment, `MONITORED_DEVICES` in `config.js`, and `device-alerts.test.js` added
to both npm test scripts.

## What was fixed, and why it mattered

`local-dashboard-server.js` held **one** set of alert state machines and called
`stalenessAlert.recordFetch()` on every `/dashboard` hit with no idea which
device sent it. A second Kindle polling the same server would have
continuously re-armed that alert, so **v0 could have died silently** — exactly
the failure mode from 2026-06-18 and 2026-08-07 that the alerting exists to
prevent.

Now `server/device-alerts.js` keys state by device, with per-device profiles:

- **v0** — no permanent charger → battery + bedtime + staleness all on.
- **kitchen** — permanent charger → battery/bedtime **off** (always charging,
  they would be pure noise), staleness **on** (its only silent failure).

26 tests in `device-alerts.test.js`; test 2 is the direct regression proof.

⚠️ **`MONITORED_DEVICES` defaults to `v0`, so production behaviour is
unchanged.** Add `kitchen` **only once that screen is genuinely polling** — a
monitored-but-absent device goes stale immediately and alerts every check
interval.

## Next three tasks, in order

**1. `daily-briefing.py --json`** (in `~/Projects/fitlocal`)
The goal-aware training recommendation — the headline content for the morning
face — already exists and ships (`scripts/daily-briefing.py`,
`llm_recommendation()` ~line 209, local Ollama with a rule-based fallback at
~line 191). It is **not** tracked by fitlocal issue #78; that issue is closed
and about something else. The gap is purely that the rec exists only as
Markdown in the Obsidian vault.
*Done when:* a run writes `outputs/last_briefing.json` containing the rec text
plus its inputs, mirroring `rss-digest`'s `outputs/last_digest.json`, without
changing the existing vault output.

**2. `/api/agenda` on the Pi**
Full-day calendar + top Todoist. `server/calendar-service.js` already fetches
iCal from `CALENDAR_URL` (a private **iCloud** URL — Apple Calendar, never
Google) but answers "next event"; it needs a whole-day shape. Todoist needs a
new `todoist-service.js` following the same cache/fallback chain.
*Done when:* `curl http://192.168.50.163:3000/api/agenda` returns today's
events + tasks, with fixtures and unit tests, degrading like the other
services.

**3. The render layer** — the bulk of the work
HTML+CSS → PNG, portrait, 1072 × 1448, rendered on the Mac. Build all three
faces against **fixtures** for all four feeds, exactly as the transit screen
was built before its API keys arrived.
*Done when:* `--render-only` replays a saved JSON through the templates in
about a second and all three faces look right — **with zero device
involvement.** That preview loop is the deliverable; treat it as
non-negotiable, the same way `npm run trmnl:preview` is for v0.

## Decisions already made — do not relitigate without new information

- **Not TRMNL, not Liquid, for this screen.** BYOS renders landscape markup and
  then rotates the *bitmap* — verified empirically on 2026-08-10. A portrait
  "paper" is not expressible in it, and 800 × 480 letterboxed onto a 1072 × 1448
  panel wastes ~¾ of the glass. v0 stays TRMNL/landscape; the two diverge at the
  render layer on purpose.
- **Render on the Mac, not the Pi.** Headless Chromium does not fit on the Pi
  (~600 MB free, also the household Pi-hole). The Mac already runs it for BYOS.
- **HTML, not node-canvas.** `bug_eink_local_canvas_rendering_broken`:
  node-canvas renders solid black on this Mac and rebuilding from source does
  **not** fix it — do not retry that. A canvas-based kitchen screen would be
  un-previewable locally.
- **WinterBreak2, not WinterBreak** — see the plan. The site's own wizard data
  ranks it first for this device, and it needs no Amazon registration.
- **Do not install the hotfix.** WinterBreak2 already blocks OTA and applies
  the system patches. Most third-party guides are wrong about this.

## Gotchas

- **"It works" and "it's deployed" are independent facts.** `deploy-to-pi.sh`
  is manual and nothing verifies it ran — the transit screen looked shipped for
  six days while BYOS was really polling a hand-started `node` process on the
  Mac. Check `curl http://192.168.50.163:3000/api/<thing>` before believing
  anything is in production.
- **The Kindle does not answer ICMP.** A failed `ping` means nothing. Use
  `nc -z <ip> 22`, or the Pi's `/health`.
- **Verify a claimed bug against live state before fixing it.** This has burned
  this project before (see the correction in `bug_eink_battery_alert_latch`).
- Kindle scripts are **busybox ash**, not bash — see CLAUDE.md's rules.
- **FileVault**: a cold Mac reboot parks at the unlock screen, so no BYOS and
  no render service until someone logs in. The kitchen renderer must serve its
  last good PNG rather than a blank screen.
- Morning-face timing vs. the 08:00 briefing job is **deliberately unresolved**
  — Brendan deferred it. Do not silently pick one.

## Jailbreak

Fully specified in `KITCHEN_SCREEN_PLAN.md`. Two scripts do everything that is
automatable:

```bash
./scripts/stage-kitchen-jailbreak.sh fetch      # download + checksum
./scripts/stage-kitchen-jailbreak.sh jailbreak  # copy WinterBreak2 to device
./scripts/stage-kitchen-jailbreak.sh ssh        # MRPI + usbnet + KUAL
./scripts/setup-kitchen-kindle.sh --usb         # keys, wifi SSH, boot flag
```

`fetch` has been **run and verified**: all four artifacts download, and both
upstream-published checksums match. Archive contents were confirmed to hold
what the scripts look for (including the PW3-correct
`Update_usbnet_0.22.N_install_pw2_and_up.bin` — the `touch_pw` variant is the
wrong file and installs as a silent no-op). Everything after the download is
**untested against hardware**, because no hardware has been touched.

The bootstrap is irreducibly two-phase: manual device-UI steps until usbnet and
SSH are live, fully scriptable after. The scripts stop and prompt at each
manual step rather than assuming.

**Step 0 is a full partition backup.** The PW3 is old enough to have no secure
boot, so this is possible — it is not on newer Kindles. Highest-value
insurance available; do it before anything else.

`setup-kitchen-kindle.sh` refuses to run against a device whose serial is not
`G090…`, so it cannot accidentally reconfigure SSH on the desk Kindle.

## Tracking

Todoist: **"Set up kitchen e-ink screen (Kindle Paperwhite 3) — jailbreak +
Live Paper build"** in the *e-ink screen* project (`6hHMfmhG6QfgqrvJ`), with a
comment pointing back here.
