# Steps tile — scoping

**Status:** design only, no code. Written 2026-09-27.

**Want:** today's step count, from iPhone and Apple Watch Health data, on the
dashboard (and later on the kitchen paper).

**Recommendation:** **path (a), ride FitLocal**, but only after a
10-minute diagnostic that nobody has run yet (step 1 below). Build the tile
against one `/api/steps` contract that either path can fill, so the choice of
source never blocks the recipe.

## What I could and couldn't check

- `fitlocal-app.fly.dev` is **blocked by this cloud session's egress proxy**
  (CONNECT 403). The requested `/api/health` probe could not be run from here.
  The command is in the checklist.
- **FitLocal side.** Everything about FitLocal comes from this repo's
  `server/fitness-service.js` and its fixture, plus what you told me. The
  `/health-snapshots` rows carry `date`, `bodyWeightKg` and `steps`, and the
  sync has been stale since late June.
- **iOS side.** Web search only, done by a research sub-agent. Sources are
  cited inline and are secondary (Apple docs, the vendor's help pages,
  forums). None of it was tested on a phone.

## What already exists

- `fitness-service.js:95-113` already fetches **`/health-snapshots`**, about
  350 rows, every `FITLOCAL_CACHE_TTL_MS` (30 min). It then **throws away
  everything except the latest `bodyWeightKg`** (`:104-111`). So the steps
  data, if FitLocal has it, is already reaching the Pi and being discarded.
- The fixture shows the symptom: `latestSnapshot.date` is `"2026-06-24"`,
  while nutrition is dated `2026-09-09`/`10`. Nutrition has its own pipeline
  and is still live. The Fitness tile's weight has shown a June date ever
  since.

### The question that decides everything: *what* went stale in June?

"Body weight stopped updating" does **not** prove the Health → FitLocal sync
died. There are two different failures that look the same on the tile:

| Hypothesis | Where the break is | Implication for steps |
|---|---|---|
| **H1: the whole sync is dead.** No snapshot rows after about 2026-06-24 at all. | iOS automation, or FitLocal ingest | Path (a) needs the iOS/FitLocal fix first. |
| **H2: only weight stopped.** Rows keep arriving, but `bodyWeightKg` is null. | The smart scale → Apple Health link (scale app permission, Bluetooth pairing, a scale app update) | **Path (a) may already work today.** Steps could be sitting in `/health-snapshots` right now. |
| **H3: rows arrive but `steps` isn't populated** | The FitLocal ingest mapping | A FitLocal change is needed on either path. |

Step 1 of the checklist tells these apart with one `curl`.

## Path (a): ride FitLocal

```
iPhone/Watch → HealthKit → (existing iOS automation) → fitlocal-app.fly.dev ─┐
                                                           (bearer, internet)│
Pi fitness-service (already polls /health-snapshots, 30 min) ◀────────────────┘
      └─ NEW getStepsData() → GET /api/steps → BYOS "Steps" recipe
```

**What it needs**

1. **The sync fix, if the diagnostic says H1 or H3.** This is iOS or FitLocal
   work I can only describe, not do. Likely causes, none of them verified for
   this setup:
   - The exporting automation was **turned off**, or flipped to "Ask Before
     Running".
   - **Health read permission** was revoked for the exporter (Settings →
     Health → Data Access & Devices).
   - **Background App Refresh or Low Power Mode** is starving it.
   - A FitLocal bearer token was **rotated** on Fly without being updated on
     the phone, so every post gets a 401.
   - The FitLocal ingest route **changed or started failing**. On the FitLocal
     side, `fly logs -a <app> | grep -i snapshot` shows in minutes whether the
     phone is still posting and what status code it gets.
   - A background point: HealthKit data is **"Protected Unless Open"**. It
     can't be read about 10 minutes after the phone locks
     ([Apple Platform Security](https://support.apple.com/guide/security/protecting-access-to-users-health-data-sec88be9900f/web)).
     A scheduled export that fires while the phone is locked fails.
     ([Health Auto Export's docs](https://help.healthyapps.dev/en/health-auto-export/automations/schedule-automations-using-shortcuts/)
     say this outright.) That explains *intermittent* gaps, but not a
     three-month silence.
2. **Dashboard side**, which is small:
   - `fetchAll` keeps a `stepsSeries`: the last 8 rows with non-null `steps`,
     sorted by date. This is roughly 8 rows of disk cache.
   - `getStepsData()` maps it to the contract below.
   - The `/api/steps` route.
   - Adding `stepsSeries` to `fixtures/fitness/fitlocal.json`, and tests.
   - The existing `/api/fitness` shape stays unchanged.

**Freshness caveat.** Whether the tile shows *today, live* or *yesterday's
total* depends on how FitLocal's ingest works. Does it re-post and update
today's row during the day, or write one roll-up at night? Step 2 of the
checklist measures it. Either is acceptable for a wall tile; the contract
below covers both.

## Path (b): push directly to the Pi

```
iPhone → (Health Auto Export REST automation, or a Shortcut) ── POST, LAN only ──▶
Pi  POST /api/steps  (bearer STEPS_INGEST_TOKEN) → cache/steps.json (30 days)
    GET  /api/steps  → BYOS "Steps" recipe
```

### Endpoint design

**`POST /api/steps`**

- **Auth.** `Authorization: Bearer <STEPS_INGEST_TOKEN>`, compared with
  `crypto.timingSafeEqual`.
  - If `STEPS_INGEST_TOKEN` is unset, the route answers **404**. It doesn't
    exist until it is configured, which matches how every other integration
    here is off by default.
  - A bad token gets a 401, logged without echoing the header.
- **Limits.** `Content-Type: application/json`, a body of at most 64 KB, and a
  timeout of about 5 s on reading it.
- **Accepted bodies.** Everything is normalised to `{date, steps}` per day.

  ```jsonc
  // 1) Minimal: what a hand-built Shortcut sends
  { "date": "2026-09-27", "steps": 6412, "asOf": "2026-09-27T14:05:00-05:00" }

  // 2) Multi-day backfill
  { "days": [ { "date": "2026-09-26", "steps": 11204 }, { "date": "2026-09-27", "steps": 6412 } ] }

  // 3) Health Auto Export native. Time grouping "Day", metric step_count
  //    (format per the app's docs/wiki; verify against a real export)
  { "data": { "metrics": [ { "name": "step_count", "units": "count",
      "data": [ { "date": "2026-09-27 00:00:00 -0500", "qty": 6412 } ] } ] } }
  ```

  HAE format sources:
  [REST API automation](https://help.healthyapps.dev/en/health-auto-export/automations/rest-api/)
  and [JSON format](https://github.com/Lybron/health-auto-export/wiki/API-Export---JSON-Format).
- **Validation.**
  - `date` must parse as a local date within [today−30, today+1].
  - `steps` must be an integer between 0 and 100,000. Other metrics in an HAE
    batch are ignored.
  - If nothing survives validation, the reply is **422**.
- **Storage.**
  - Data goes to `cache/steps.json`, keyed by date, keeping 30 days.
  - Each date's value is **last-write-wins** by receipt time. HealthKit daily
    totals rise through the day, and a later, smaller value means a deletion,
    which should win too.
  - Writes go to a temp file and are then renamed (review F17).
- **Reply.** `200 {"accepted": N, "dates": [...]}`.

**`GET /api/steps`** returns the shared contract below, with `source: "push"`.

### iOS senders, compared

| | Health Auto Export (paid) | Apple Shortcuts (free) |
|---|---|---|
| Schedule | A background sync interval; runs more often while charging | Personal automation at a time of day. "Run Immediately" plus "Notify When Run" off, since iOS 17 ([ref](https://matthewcassinelli.com/automations-run-immediately-shortcuts-notifications/)) |
| Locked phone | **Only runs while unlocked** (vendor FAQ). "Since Last Sync" catches up on the next unlock. | "Find Health Samples" fails while locked (Protected Unless Open). "Allow Running When Locked" doesn't bring the data back. |
| iPhone + Watch de-duplication | Its summarised daily values come from HealthKit statistics, so they are de-duplicated (third-party report) | Adding up raw samples **double counts** (e.g. 11,309 vs 8,898 in one report). Use "Find Health Samples", grouped by Day, and check it against the Health app. |
| Custom headers (bearer) | Yes | Yes ("Get Contents of URL": POST, JSON body, headers) |
| Plain HTTP to a LAN IP | Inferred to work (its Home Assistant guide uses `http://…local:8123`) | Inferred to work. Test once. |
| Cost | Premium, about $25 lifetime, or a subscription (App Store listing) | $0 |
| Setup effort | About 10 minutes in the app | About 30 minutes, plus debugging missed runs |

### The part that decides against (b): the Pi is LAN-only

- A push to `192.168.50.163` only lands while the phone is **on home Wi-Fi**.
- Away all day means no updates until you're home. HAE's "Since Last Sync"
  back-fills then, but the tile is stale all day.
- The alternatives are Tailscale on the phone plus the Pi, which is unverified
  (the Pi is not known to be on the tailnet), or exposing the Pi. Exposing it
  is a no, since it is the household Pi-hole.
- FitLocal is already on the public internet with bearer auth, so path (a)
  doesn't have this problem.

## Recommendation: (a), gated on the diagnostic

| | (a) Ride FitLocal | (b) Push to the Pi |
|---|---|---|
| New infra and secrets | **None.** It reuses `FITLOCAL_API_KEY`. | A new write endpoint, `STEPS_INGEST_TOKEN`, and an app or Shortcut on the phone |
| Works away from home | **Yes** (the ingest is on the internet) | No, unless Tailscale |
| Freshness | Depends on the FitLocal ingest cadence (to be measured) | As fast as the sender, while home and unlocked |
| Fixes other things too | **Yes.** It likely revives the Fitness tile's weight, stuck at June, and gives `daily-briefing.py` steps for the kitchen. | No |
| Blocker | An unknown-size iOS/FitLocal fix (H1/H3). Possibly **none** (H2). | None on the Pi side; about $25 or Shortcut fiddling |
| Pi attack surface | Unchanged (read-only) | The first POST route on the Pi |

**Pick (a)** if the diagnostic comes back H2, or H1/H3 with a fix within
about a week. **Fall back to (b)** only if FitLocal can't carry daily steps
soon, or you want intraday freshness that FitLocal's cadence can't give.
Either way, the tile ships against the same contract.

## Shared contract: `GET /api/steps`

```json
{
  "today":     { "date": "2026-09-27", "steps": 6412, "asOf": "2026-09-27T14:05:00-05:00" },
  "yesterday": { "date": "2026-09-26", "steps": 11204 },
  "goal": 10000,
  "pct": 64,
  "week": [
    { "date": "2026-09-21", "steps": 9120 }, { "date": "2026-09-22", "steps": 7410 },
    { "date": "2026-09-23", "steps": 12055 }, { "date": "2026-09-24", "steps": 5230 },
    { "date": "2026-09-25", "steps": 8830 }, { "date": "2026-09-26", "steps": 11204 },
    { "date": "2026-09-27", "steps": 6412 }
  ],
  "avg7": 8609,
  "stale": false,
  "source": "fitlocal",
  "_timestamp": "<ms epoch>"
}
```

- `today` is **null** when there's no row for today yet. The tile then shows
  `yesterday` big, labelled "yesterday".
- `stale` means the newest data is more than 36 hours old, which is what the
  tile has effectively been since June for weight.
- `week` always has 7 slots, oldest first, with `steps: null` for a missing
  day, so bar charts don't shift.
- `goal` comes from `STEPS_GOAL` (default 10000).
- `pct` is capped at 100 for the bar. The number itself is not capped.
- `source` is `fitlocal` | `push` | `cache` | `expired-cache` | `fixture`. The
  recipe shows **SAMPLE** on `fixture` and "as of" on the others (review F3).

### Recipe sketch (quadrant, 400×300 in TRMNL px)

```
┌──────────────────────────────────────┐
│ Steps                    as of 2:05p │ 26px header, 16px as-of
│ ──────────────────────────────────── │
│  6,412                  / 10k        │ 64px key number, 24px goal
│ ████████████████░░░░░░░░░  64%       │ 20px bar
│ ▂ ▁ █ ▁ ▃ ▆ ▃                        │ 7-day bars (div heights), today last
│ M T W T F S S   avg 8.6k             │ 18px labels
└──────────────────────────────────────┘
```

The key number is 64px, well above the 34px floor, and nothing is under 16px.
A `full` variant can come later. This is a quadrant tile, and the 2×2 boards
are where it fits. It needs `quadrant.liquid` before it goes into any mashup.

## Local-deploy checklist

1. **Diagnose which hypothesis holds.** Run this from the Mac. It reads the key
   from the Pi's `.env` and never prints it.
   ```bash
   ssh pi 'set -a; . ~/dashboard-server/.env; set +a;
     curl -s -H "Authorization: Bearer $FITLOCAL_API_KEY" \
       "${FITLOCAL_API_URL:-https://fitlocal-app.fly.dev/api}/health-snapshots"' \
   | jq '{rows: length,
          latest_any:    (map(.date) | max),
          latest_weight: (map(select(.bodyWeightKg != null)) | map(.date) | max),
          latest_steps:  (map(select(.steps != null)) | map(.date) | max),
          newest_row:    (sort_by(.date) | last)}'
   curl -s https://fitlocal-app.fly.dev/api/health    # the unauthenticated probe I couldn't run
   ```
   - `latest_any` and `latest_steps` are recent but `latest_weight` is June:
     **H2**. Steps are already there, so go to step 3. Fix the scale → Health
     link separately.
   - `latest_any` is June: **H1**. Fix the iOS → FitLocal automation first,
     then re-run this step.
   - Rows are recent but `latest_steps` is null or June: **H3**. The FitLocal
     ingest mapping needs a change.
   - If `.env` isn't at that path, see review F18: `pi/setup-auto-deploy.sh`
     points the unit at `server/.env`.
2. **Measure freshness.** Run step 1 twice, 2–3 hours apart during the day.
   If today's `steps` rises between runs, the tile is near-live. If today's row
   doesn't exist until tomorrow, it is a "yesterday" tile. Either is fine; just
   know which one it is.
3. **Build the tile against the contract.**
   - `getStepsData()` in `fitness-service.js`, and the `stepsSeries` fixture.
   - Tests, including null-today, gaps in `week`, and `stale`.
   - `byos-recipes/steps/{settings.yml,quadrant.liquid}`.
   - `./scripts/validate.sh`.
   - No new npm dependencies, so review F4 isn't triggered.
4. Run `./deploy-to-pi.sh`, then
   `curl -s http://192.168.50.163:3000/api/steps | jq '.source, .today, .stale'`.
   Expect `"fitlocal"`, not `"fixture"`.
5. **Create and import the recipe.**
   - `POST /api/plugin_settings`, then add the `id:` to `settings.yml`, then
     the zip import (see `docs/scoping/horoscope-tile.md` steps 6–8 for the
     exact commands).
   - Force a data refetch after the import: **imports wipe the cached data
     payload**.
   - Preview with `npm run trmnl:preview -- --plugin steps`.
6. Add it to a 2×2 board. Mashup items can't be edited, only recreated. Keep
   `scripts/setup-byos-playlists.sh` in step with BYOS.
7. **Only if falling back to (b):**
   - Add `STEPS_INGEST_TOKEN` to the Pi's `.env` (generate it with
     `openssl rand -hex 24`), then `sudo systemctl restart kindle-dashboard`.
   - Configure the iOS sender to POST to
     `http://192.168.50.163:3000/api/steps` with the bearer header.
   - For HAE: Time Grouping = Day, metrics = `step_count` only, range "Since
     Last Sync". Keep the token in the app, not in a synced note.
   - Check with `jq .` on `cache/steps.json` on the Pi after the first run,
     and compare with the Health app's number for today.
