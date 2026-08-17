# Kitchen screen — plan (Kindle #2)

Second e-ink screen: a shared daily "paper" in the kitchen, complementing the
v0 desk dashboard. Non-duplicating by **time-horizon**, not by data source:
v0 is LIVE (15–30 min, "focus / status / when to leave"), kitchen is the
DAILY brief ("my day, what to read, how to train"), 2–3 faces per day.

## Device — resolved

- **Model number `DP75SDI`** (the moulded "D" reads as an "O" on the case) —
  Kindle Paperwhite. **Firmware 5.12.3.**
- 5.12.3 is far below the **5.18.1** jailbreak ceiling, so the device is
  jailbreakable via **WinterBreak** (`https://kindlemodding.org/jailbreaking/WinterBreak/`).
  → **Design A (Send-to-Kindle only) is not forced. The jailbreak path is open.**
- Paperwhite means a **frontlight**, which v0 (Kindle Touch) lacks — genuinely
  better for a kitchen that is dark at 6am.

### Render target — resolved

Serial prefix **`G090`** → **Paperwhite 3 (7th gen)**.

| | Panel | PPI |
|---|---|---|
| v0 (Kindle Touch) | 600 × 800 | 167 |
| **kitchen (PW3)** | **1072 × 1448** | **300** |

The kitchen panel is **2.4× the linear resolution of v0** and nearly 3.2× the
pixel count. Two consequences:

- Confirms the TRMNL rejection below. An 800 × 480 letterbox on this panel
  would be indefensible.
- **Type can be much smaller.** The v0 layouts are sized for 167ppi at desk
  distance; at 300ppi a full-day agenda plus themes genuinely fits without
  feeling cramped. Do not port v0's type scale — set it fresh against
  kitchen-counter reading distance.

Render target for `paper.png` is therefore **1072 × 1448, portrait, 8-bit
greyscale**. PW3 is a 16-level greyscale panel, so dithering matters — see the
existing `server/optimize-for-eink.py` for the established treatment.

### Jailbreak — use **WinterBreak2**, not WinterBreak

Corrected after checking kindlemodding.org's machine-readable compatibility
data (`jailbreaks.json` + `models.json`, the same files the site's own wizard
filters). Running the wizard's logic for PW3 + 5.12.3 returns **two** matches,
and WinterBreak2 is the primary; WinterBreak is the fallback.

| | Firmware range | Requires Amazon registration |
|---|---|---|
| **WinterBreak2** ⭐ | 5.6.1.1 – 5.16.3 | **no** |
| WinterBreak | 5.6.1.1 – 5.18.0.2 | yes |

Note there is a **minimum** firmware (5.6.1.1), not just the 5.18.1 ceiling
usually quoted — 5.12.3 sits comfortably inside both ranges. WinterBreak2 is
also mechanically simpler and avoids a macOS-specific trap (below), so it is
the one to use.

**Do NOT follow the `KindleModding/WinterBreak` GitHub README** — its `main`
branch still carries stale "Kindle Bricker 2000 / don't use this" text. Use the
wiki page plus the release asset.

### Runbook

**Step 0 — back up the partitions first.** The PW3 is 8th-gen-or-older, so it
has no secure boot and a **full partition backup is possible** (KUAL + kterm +
knc1's `mkbackup.sh`). This option does not exist on newer Kindles. It is the
single highest-value insurance step available and it is only available because
of which device this is. Do it before anything else.

1. **Fill the storage, with airplane mode ON.** Not superstition: the OTA
   download needs more free space than it will have, so it cannot complete and
   cannot push the device past the jailbreak ceiling mid-process. Target
   **50–90 MB free**. Delete any `*.bin` and `update.bin.tmp.partial` from the
   USB root first.
2. Extract `wb2.zip` to the Kindle root → `jb.sh`, `patchedUks.sqsh`,
   `winterbreak2/dialoger.html`.
3. Eject, connect to wifi.
4. On device: **Experimental Browser → `https://winterbreak2.now.sh/` → press
   Jailbreak.** ~30s, the screen spews text and the GUI restarts.
5. Delete the filler files and any `.bin` left at the root.

**The jailbreak needs live internet at step 4.** The payload is not in the zip
— `dialoger.html` triggers a `com.lab126.transfer` upload that pipes a remote
`jb.sh` into `sh`. Do not run this on a device you cannot get online.

### Do NOT install the hotfix — it is already done

Both the hotfix and disable-OTA pages now say verbatim that you may skip them
if you jailbroke with WinterBreak/WinterBreak2 — **OTA blocking is applied by
the jailbreak itself** (`jb.sh` module `02_stop_ota` kills the OTA services and
deletes staged `.bin`s; `06_patch_system` applies "what was once the hotfix").
The entire `post-jailbreak` tree was moved under `/Legacy/` for this reason.

This flatly contradicts most third-party guides, which still tell you to
install the hotfix as step 2. Following them is wasted work at best.

### SSH — the part that actually matters for this project

The dashboard client needs SSH, same as v0. Package:
**`Update_usbnet_0.22.N_install_pw2_and_up.bin`** (verified in usbnet's
`build/build-updates.sh` — that `.bin` is the one built with `-d paperwhite3`;
the `install_touch_pw` variant is PW1/Touch only and is the wrong file).
Installed via **MRPI**, which needs ~220 MB free — free that space *with
airplane mode on*, or the Kindle will immediately spend it on an OTA.

Then the crucial config detail, read out of usbnet's own `bin/usbnetwork`:

```sh
if [ "${USE_WIFI}" == "false" ]; then SSH_DAEMON_OPTS="${SSH_DAEMON_OPTS} -n"
```

- Over **USB**, dropbear runs with `-n` — **no password check at all.** Root
  logs in with any or no password.
- The moment you set `USE_WIFI="true"`, passwords are enforced *and* an
  iptables rule opens ssh on `wlan0`.

Since this screen must be reachable over wifi, use **key auth**, not the
serial-derived password: drop pubkeys in `/mnt/us/usbnet/etc/authorized_keys`
(usbnet's documented equivalent of `~/.ssh/authorized_keys`). If a password is
ever needed, get it on-device with `kindletool info $(cat /proc/usid)` rather
than trusting an online calculator.

Config lives at `/mnt/us/usbnet/etc/config`, **must keep UNIX line endings**,
and must not be edited while usbnet is running. `touch /mnt/us/usbnet/auto`
starts SSH at boot — that is the flag that makes the device unattended.

### Automation boundary

The bootstrap is **two-phase: manual until SSH is live, fully scriptable
after.** That boundary is real and worth designing around rather than fighting.

**Automated** — `scripts/stage-kitchen-jailbreak.sh` (download + checksum +
copy) and `scripts/setup-kitchen-kindle.sh` (post-SSH provisioning). Between
them they cover every file copy, every artifact download, `authorized_keys`,
the usbnet config, the boot flag, and the dashboard client deploy.

**Irreducibly manual (device UI):** airplane-mode toggles, opening the
Experimental Browser and pressing Jailbreak, Settings → ⋯ → Update Your Kindle
for any `.bin`, and the first `;un` in the search bar to start usbnet. That
last one is the chicken-and-egg step — you cannot SSH in to enable SSH.

**macOS trap the staging script handles for you:** Finder drag-and-drop
silently skips dot-directories, which is fatal for WinterBreak (its payload
lives in `.active_content_sandbox`). The script uses `ditto`, runs
`dot_clean -m` to strip AppleDouble junk, and ejects with `diskutil`.

### Unresolved — flagged, not papered over

**KUAL's status is genuinely ambiguous.** kindlemodding's
`installing-homebrew` page says KUAL is "obsolete and does not work", replaced
by KPM (`;kpm install` from the search bar). But the FAQ still tells you to
install it, Hotfix 2.5.0's release notes mention signing KUAL builds, and
`jb.sh` installs a Kindlet developer keystore specifically so "legacy booklets
such as KUAL" work. Best reading: "obsolete" means *no longer the recommended
launcher*, not *broken on a soft-float PW3* — and KUAL is still the only UI for
usbnet's and MRPI's menus.

**Plan for KPM first, keep PEKI (the K5+ KUAL build) as the fallback.** Nobody
has published a test of KUAL on a WinterBreak'd PW3 on 5.12.3; treat it as
unverified until the device says otherwise.

Also unverified: usbnet 0.22.N is a 2023 build with no PW3-on-5.12.3 report.
PW3/5.12.3 is the well-trodden soft-float (`kindlepw2`) case so the risk is
low, but that is an inference rather than a citation.

### If it goes wrong

Realistic risk is **low**, and the failure mode is almost never a brick — it is
a mid-process OTA moving you off a jailbreakable firmware, which is exactly
what step 1 prevents. Never reboot with a custom `.bin` at the root.

`"Failed to remount rootfs RO, waiting"` is expected, not an error — hold power
and restart. If the screen says *"You are now ready to install the hotfix"*,
that means it **failed**; retry.

Recovery ladder: re-run the jailbreak (idempotent — `jb.sh` detects an existing
install and supports a forced re-run) → check `;log` in the search bar (output
means still jailbroken, so reinstall packages rather than re-jailbreaking) →
restore the step-0 partition backup → factory reset and reflash → last resort,
Popcorn (PW3 can be forced into i.MX SDP mode by bridging `CR501` to `TP508`,
requires teardown).

## The finding that changes the design: TRMNL cannot render a portrait paper

The brief assumed Design C = TRMNL recipes with `active_from` / `active_until`
scheduling, reusing the transit-screen pattern. That does not work here.

**BYOS renders landscape markup and then rotates the output bitmap** — verified
empirically on 2026-08-10 (see `TRMNL_SETUP.md` "Sideways content" and
`project_eink_trmnl_byos`): rendering at a nominally portrait device model
produced a portrait *file* with still-landscape *content*. TRMNL's canvas is
800 × 480, full stop.

Consequences for the kitchen:

- A morning paper — date header, full-day agenda, training rec, RSS themes — is
  an inherently **tall, portrait** layout. TRMNL cannot express that.
- Letterboxing 800 × 480 into a 1072 × 1448 panel uses roughly **a quarter of
  the glass** and upscales a low-res bitmap onto a 300ppi screen. On the sharpest
  display in the house.

So the kitchen screen should **not** be a TRMNL recipe. v0 stays TRMNL/landscape;
they diverge at the render layer, which is fine — they already diverge at the
content layer by design.

## Recommended architecture — "Live Paper", HTML render, native portrait

Design C's *delivery* (jailbroken client, live, permanent charger) with Design
A's *render layer* (HTML → PNG, portrait, full panel resolution). Not TRMNL.

```
  Mac (always-on, 192.168.50.204)
    ├── daily-briefing.py  --json  ──┐
    ├── rss-digest last_digest.json ─┤
    ├── Pi /api/agenda (calendar+todo)┤──►  paper-render (HTML+CSS → PNG)
    └── weather ────────────────────┘         │  portrait, native panel res
                                              │  3 time-of-day faces
                                              ▼
                                        GET /paper.png?device=kitchen
                                              │
                                    Kindle #2 (jailbroken, on charger)
                                    dashboard-loop, eips, ~20 min poll
```

**Why HTML on the Mac and not canvas on the Pi:**

- `TRANSIT_SCREEN_PLAN.md` already concluded hand-drawing on canvas was "slow
  and unpleasant" and that layout should live in markup. That conclusion holds;
  only the *markup engine* changes (HTML/CSS instead of Liquid-in-BYOS).
- Headless Chromium will not fit on the Pi (~600MB free RAM, no Docker, it is
  also the household Pi-hole). The Mac already runs headless Chromium for BYOS.
- `bug_eink_local_canvas_rendering_broken`: node-canvas renders solid black on
  this Mac and a source rebuild does **not** fix it. A canvas-based kitchen
  screen would be un-previewable locally — every iteration a Pi round trip.
  HTML → PNG sidesteps that bug entirely.
- **Design A stays free as a fallback.** Same HTML, print to PDF, Send-to-Kindle.
  If the jailbreak bricks or is abandoned, the content work is not lost — which
  was the brief's own stated reason for preferring C.

Reuse `rss-digest`'s `templates/` + `--render-only` idea directly: every render
dumps its input JSON, and a `--render-only` flag replays it through the
templates in under a second. That is the preview loop, and it is the analogue
of `npm run trmnl:preview` — **never push to the Kindle to check a layout.**

## Data plumbing — what exists, what is missing

| Feed | Source | Status |
|---|---|---|
| Weather | `server/weather-service.js` | exists |
| Calendar | `server/calendar-service.js` (iCal via `CALENDAR_URL`) | exists, **Apple/iCloud published URL — not Google**. Needs a whole-day shape; today it answers "next event". |
| Todoist | — | **missing.** New `todoist-service.js`, same cache/fallback chain. |
| Training rec | `fitlocal/scripts/daily-briefing.py` | **exists, and is better than the brief assumed** — see below. |
| RSS themes | `rss-digest/outputs/last_digest.json` | exists. `themes[].{title,summary,items[]}`, plus `lead`, `videos`, `also`, `generated`. |

### Correction: fitlocal issue #78 is not the training-rec issue

The brief (and `feedback_fitness_briefing_coaching`) point at fitlocal issue
**#78** for the goal-aware next-day training recommendation. That is wrong and
the memory is stale:

- **#78 is CLOSED** and is about *PWA web-push delivery + suggested weights*.
- The goal-aware recommendation **is already built and shipping.**
  `scripts/daily-briefing.py:209` `llm_recommendation()` prompts a local Ollama
  model as "Brendan's strength & running coach" with recovery + deload +
  training-load + cut context, with `rule_based_recommendation()` as a
  deterministic fallback (`:191`).
- No open fitlocal issue tracks this. Open issues are #104, #90, #87 — all
  unrelated.

So the kitchen screen does **not** need to build the synthesis. It needs to
**expose** it. Today the rec is written as Markdown into the Obsidian vault
clone and git-pushed; there is no JSON and no endpoint.

**Work item:** add a `--json <path>` output to `daily-briefing.py` that writes
the rec text plus its inputs, exactly mirroring `rss-digest`'s
`outputs/last_digest.json` convention. Cheap, and it makes the rec consumable
by anything.

### Endpoints

New, on the Mac (a single small static/JSON service beside BYOS — `rss-digest`
already runs one on :8765 under `com.brendan.rss-digest-serve`, follow that
launchd pattern):

- `GET /paper.png?device=kitchen&face=auto` — the rendered page. `face=auto`
  picks by clock; `face=morning|midday|evening` forces one, for previewing.
- `GET /api/fitness` — briefing rec + supporting figures, from the new JSON.
- `GET /api/reading` — top themes from `last_digest.json`.

New, on the Pi (`local-dashboard-server.js`, existing switch at `:407`):

- `GET /api/agenda` — full-day calendar events + top Todoist tasks. Lives on
  the Pi because `CALENDAR_URL` and the calendar cache already do.

## Blocking bug: a second device silently disables v0's death alarm

**This must be fixed before Kindle #2 ever polls the Pi.**

`local-dashboard-server.js` holds **one** set of alert state machines per
server instance — `this.batteryAlerts` (`:28`), `this.stalenessAlert` (`:29`),
`this.bedtimeAlert` (`:35`) — and calls `this.stalenessAlert.recordFetch()` on
**every** `/dashboard` hit (`:232`), with no notion of which device sent it.

So if the kitchen Kindle polls the same server, its fetches continuously
re-arm the staleness alert, and **v0 can die without anyone being told.** That
alarm exists precisely because v0 died unnoticed twice (2026-06-18 and
2026-08-07, see `bug_eink_battery_alert_latch`). Adding a second screen would
quietly re-open the exact failure mode the alerting was built to close.

Fix: key all three state machines by device id, and have `/dashboard` and
`/paper.png` pass one through. Per-device config too, since the two devices
have opposite battery situations:

- **v0** — no permanent charger. Battery + bedtime + staleness alerts all on.
- **kitchen** — permanent charger (the kitchen is near an outlet; this kills
  the flat-battery failure mode outright). Battery and bedtime alerts **off**
  (it is always charging, they would be noise); staleness alert **on**, since
  "the paper stopped updating" is now the only silent-failure mode left.

Extend the existing `*.test.js` suites — the alert modules already have 31 + 18
tests and are pure state machines, so per-device keying is directly testable.

## The three faces

Chosen server-side by clock, not by TRMNL playlist scheduling.

| Face | Window | Answers |
|---|---|---|
| **Morning** | 05:30 – 11:00 | Date + weather header ("high 61°, good run day") → today's full agenda + top Todoist → **training rec** (the headline) → RSS lead + theme titles |
| **Midday** | 11:00 – 17:00 | What's *left* today → remaining tasks → RSS themes in full, with summaries |
| **Evening** | 17:00 – 22:00 | Tomorrow's agenda + first event → tomorrow's training rec → the read/watch tail |

Overnight: hold the evening face; do not refresh (kitchen at 3am should not be
burning e-ink cycles, and there is nothing new to say).

**Schedule dependency:** `daily-briefing.py` runs at **08:00** via
`com.brendan.fitlocal-briefing`. The morning face wants to be correct at 05:30.
Either move that job to ~05:15, or start the morning face at 08:15. Needs a
decision — it depends on when the kitchen is actually first read.

QR code to open the full RSS digest on phone (the tailnet URL) — worth keeping
from Design A even on the live path, since digest items are not tappable on a
rendered PNG either.

## Build order

1. ~~**Confirm PW2 vs PW3** from the serial prefix.~~ **Done** — `G090` = PW3,
   render target 1072 × 1448.
2. ~~**Per-device alert keying** + tests.~~ **Done** — `server/device-alerts.js`
   (`DeviceAlertRegistry`), 26 tests in `device-alerts.test.js`, wired into
   `local-dashboard-server.js`. `MONITORED_DEVICES` in `config.js` defaults to
   `v0`, so **production behaviour is unchanged until `kitchen` is added to it**
   — do that only once the screen is actually polling, or it goes stale
   immediately and alerts every check interval. Discord embeds now name the
   device, which they had no need to do with one screen.
3. `daily-briefing.py --json`. Unblocks the headline content.
4. `/api/agenda` on the Pi (calendar whole-day shape + new `todoist-service.js`).
5. `paper-render` + templates + `--render-only` preview loop, built against
   **fixtures** for all four feeds — as the transit screen was. All three faces
   iterate here, with zero device involvement.
6. Jailbreak the Paperwhite (WinterBreak), permanent charger, deploy the
   `dashboard-loop` client pointed at `/paper.png`.
7. Register it in the staleness alerting; verify a real end-to-end refresh.

Steps 3–5 are the bulk of the work and none of them require the jailbreak, so
they can proceed before the device is touched. If the jailbreak fails, step 5's
output feeds Design A unchanged.

## Also noted

- v0 is **alive** — confirmed via the Pi's `/health` (`lastScreenFetchedAt` was
  8 minutes old, i.e. it is still polling on its 15-minute cycle). An earlier
  draft of this plan flagged it as unreachable because it did not answer a
  ping; that was wrong and `CLAUDE.md` says so explicitly — **the device does
  not answer ICMP, so a failed ping means nothing.** Use `nc -z <ip> 22` or the
  Pi's `/health`.
- BYOS Liquid recipes are **not version-controlled**; they live only in the BYOS
  SQLite volume (backed up hourly by `scripts/backup-byos-db.sh`, but with no
  git history or review). Not a blocker for the kitchen — which under this plan
  uses no Liquid at all — but it is why "the render layer lives in the repo" is
  worth preserving here.
- `wild-swiss` and the other native **portrait** layouts went unused when v0
  flipped to landscape / `TRMNL_MODE=only`. The kitchen is portrait, so that
  stack is relevant again as prior art for spacing and typography, even though
  the engine is different.
- FileVault means a cold Mac reboot parks at the unlock screen — no render
  service until someone logs in. Same known exposure as BYOS; the fallback
  should be "serve the last good PNG", not a blank screen.
