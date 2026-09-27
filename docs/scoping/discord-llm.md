# Discord and local-LLM integrations: options memo

**Status:** brainstorm and ranking only. No code, and nothing verified
against the LAN. Written 2026-09-27.

The question was which small, concrete things would be worth connecting
between the dashboard, Discord, and the always-on Mac's local LLMs. Every
option below says **which parts need the LAN**, because none of it can be
built end to end from a cloud session. What a cloud session *can* do is write
and unit-test the Pi-side code against fixtures (the same way the tile
services were built), and write the Mac-side scripts blind for someone on the
LAN to run.

## What exists today

| Piece | Where | What it can do | Direction |
|---|---|---|---|
| Discord **webhook** alerts: battery, bedtime, device silent, BYOS stale | Pi (`notify.js`, `DISCORD_WEBHOOK_URL`) | Post embeds | **Outbound only.** A webhook can't receive anything. |
| Discord **home-assistant channel** (Claude Code Channels) | Separate. Where the session runs is **unknown to me**. | An agent that reads channel messages and runs tools | Inbound plus outbound. It reaches the LAN **only if** the session runs on the Mac or the Pi. |
| Ollama and a `llama-server` service | Mac `192.168.50.204` | Local generation | LAN |
| Nightly **RSS digest**, `last_digest.json` on `:8765` | Mac (launchd `com.brendan.rss-digest-serve`) | Already feeds `/api/rss` → the RSS tile | Mac → Pi (the Pi pulls) |
| Morning **fitness briefing**, `daily-briefing.py` at 08:00 | Mac (`com.brendan.fitlocal-briefing`) | An LLM training recommendation, currently written **only as Markdown into Obsidian** | Nowhere yet (a `--json` output is KITCHEN_HANDOFF task 1) |
| `/next`, `/api/poke`, `/health`, `/api/*` | Pi `:3000` | Playlist advance, liveness, tile JSON | LAN, plain HTTP, no auth |

Two constraints shape everything below:

- **Receiving from Discord needs a listener.** That means either a bot on
  Discord's gateway, which is an outbound WebSocket and needs no open port, or
  the existing Channels session.
- **Discord's HTTP "interactions endpoint" would need a public HTTPS URL on
  the LAN.** That's a non-starter, because the Pi is also the household
  Pi-hole.

## Ranked options

Plumbing sizes: **S** means about one file on one machine. **M** means two
machines, or a new daemon or secret. **L** means new infrastructure or
exposing something to the internet.

| Rank | Idea | Value | Plumbing | Needs LAN for | Doable from the cloud now |
|---|---|---|---|---|---|
| 1 | **Diagnostics in the existing alerts** | High (every incident) | **S**, Pi only | Deploy and a live test | All the code and tests |
| 2 | **Surface the existing LLM training rec** on the Fitness tile, plus a Discord post | High (content that is already computed but shown nowhere) | M: fitlocal repo plus Pi | Both halves, and running the briefing | The Pi service, fixture and recipe, with an assumed JSON shape |
| 3 | **Morning board snapshot posted to Discord** | Medium–high | S–M, Pi only | Deploy and a live test | All the code and tests |
| 4 | **"Ask the dashboard" and alert triage** through the existing Channels session | Medium (rare but valuable) | S, *if* the session runs on the LAN | Everything | The runbook text only |
| 5 | **LLM daily-summary tile**, following the RSS pattern | Medium–high (especially for the kitchen) | M: Mac job plus Pi service | The Mac job and the LLM | The Pi service, fixture and recipe |
| 6 | Alert **ack/snooze** replies | Low–medium | M | Everything | The Pi endpoint only |
| 7 | **`/next` from Discord** | **Low** | M (bot), or S through Channels | Everything | — |
| 8 | Weekly "dashboard health" report | Low–medium | S–M | Deploy | The code |

### 1. Diagnostics in the existing alerts: most value for the least plumbing

The "Desk Kindle Silent" embed today says only *that* it went quiet. The Pi
already knows most of *why*, and it could say so at send time. No inbound
path and no LLM are needed.

- **Last telemetry.** `handleDashboardRequest` already parses `battery` and
  `charging` on every poll. Store them on the device's registry entry as
  `lastBattery`, `lastCharging` and `lastTelemetryAt`.
  - "Last seen at 6%, not charging" means *it's dead, go charge it*.
  - "Last seen at 80%, charging" means *the loop crashed or Wi-Fi dropped*.
- **An SSH port probe at alert time.** Run `net.connect(<kindle ip>, 22)` with
  a 2 s timeout. A per-device `host` would go in `DEVICE_PROFILES`.
  - The device doesn't answer ICMP (CLAUDE.md), but SSH answers whenever the
    device is up and on Wi-Fi. `deploy-kindle.sh` relies on that.
  - Port open means *alive, but the loop or fetch path is dead*: SSH in and
    restart it. Port closed means *asleep, dead or off Wi-Fi*.
- **Last good BYOS fetch**, from `trmnl.loadMeta()`. This rules the Mac in or
  out.
- **The local time of the last fetch.** Today the embed only says "silent for
  N min".

It would also help with review findings F1, F8 and F16. The same
`lastFetchAt`/`lastTelemetry` data answers `/health`'s per-device block (F8).

- **Needs LAN:** only the deploy and one real alert, which you can force with
  `STALE_THRESHOLD_MS=60000` on a test run.
- **Cloud-doable:** everything else. The embed builder is a pure function, so
  it is easy to test.

### 2. Show the LLM training recommendation that already exists

`daily-briefing.py` already writes an LLM training recommendation every
morning, with a rule-based fallback if the LLM fails. It goes into Obsidian
and nowhere else.

**Mac side**
- Add the `--json` output from KITCHEN_HANDOFF task 1, writing
  `outputs/last_briefing.json` as
  `{generated, recommendation, inputs: {…}, model}`.
- Serve it next to `last_digest.json` on `:8765`.
- Optionally, post the recommendation to Discord from the same job, using its
  **own** webhook and channel so it doesn't mix with alerts. That makes it an
  08:05 push to the phone.

**Pi side**
- `fitness-service.js` fetches the file, following the `rss-service.js`
  pattern: cache, then expired cache, then fixture.
- It adds `briefing: {text, generated}` to `/api/fitness`.
- That changes the **endpoint shape**, so the recipe, service, tests and
  fixtures must change together.
- Recipe: in the quadrant, one 22–24px line under the header. In the full
  view, a boxed "Today" block.

**Why rank 2:** the content already exists, is personal, and changes daily.
It is also the kitchen's headline content, so the JSON is needed regardless.

- **Needs LAN:** the fitlocal repo change, the 08:00 job, and serving the
  file.
- **Cloud-doable:** the Pi half, against an assumed JSON shape. Agree the
  shape first, so that half doesn't have to be redone.

### 3. Morning board snapshot to Discord

At about 07:30, post the image the desk Kindle is showing, plus one line of
text, to Discord. It lets you look at the board from your phone, and it is a
daily visible proof that the whole chain (BYOS → Pi → Kindle) is alive.

**Don't** get the image by fetching `/dashboard`. Both of these are traps:

- A fetch with no `?device=` **counts as v0**. It records a v0 fetch and
  masks v0's staleness alert. That is F1 again.
- A fetch that finds the TRMNL cache stale calls BYOS `/api/display`, which
  **advances the playlist**.

**Instead:**
- Keep the last buffer served to each device (`this.lastServed[device] =
  {buffer, at}`).
- Expose it read-only at `GET /api/last.png?device=v0`. That endpoint records
  nothing and advances nothing.
- A timer in the server posts it at 07:30. Posting a file needs `notify.js`
  to support a multipart `files[0]` upload.
- The content is pre-rotated for a landscape mount, so rotate it back for a
  phone. node-canvas is already loaded.
- The text line can come from the `/api/*` JSON (for example "Red 4m · 3
  tasks · 1st event 10:00"), plus the horoscope `teaser` and
  `moonAlert.headline` once that tile exists.

**Privacy:** this sends calendar and task contents to Discord's servers every
day. Decide that on purpose.

- **Needs LAN:** the deploy, and checking the posted image.
- **Cloud-doable:** everything else.

### 4. "Ask the dashboard" and triage through the existing Channels session

If the Claude Code Channels session runs **on the Mac, or anywhere on the
LAN**, it can already reach everything. No new code is needed, just a runbook
skill in that session's working directory:

- Read-only by default:
  - `curl -s http://192.168.50.163:3000/health | jq`
  - `curl -s …/api/transit | jq '.rail.lines'`
  - `nc -z 192.168.50.104 22`
  - `curl -s -o /dev/null -w '%{http_code}' http://192.168.50.204:4567/`
  - `ssh pi 'journalctl -u kindle-dashboard -n 50 --no-pager'`
- `/next` allowed.
- **Restarts only with explicit confirmation** in the channel: `systemctl
  restart`, re-running the Kindle loop over SSH.

This turns "Desk Kindle Silent" into "what's wrong?" → a diagnosis in the
channel. It also gives you "when's the next Red Line?" for free.

**Unknowns to check first:**
- Where does that session run?
- Can it see the webhook's alert channel? A webhook usually posts into a
  different channel from the one a Channels session listens on.
- An LLM agent answering in about 10–30 s is fine for triage. It is overkill
  for a button (see 7).

- **Needs LAN:** all of it.
- **Cloud-doable:** writing the runbook text.

### 5. LLM daily-summary tile, following the RSS pattern

This is "today in one breath" (a headline plus three bullets), made the same
way as the RSS tile.

1. **Mac job** (launchd, around 06:15 and 12:15), `summary.py`:
   - It reads the Pi's `/api/calendar`, `/api/todoist`, `/api/fitness` and
     `/api/transit` alerts, the met.no forecast, and `/api/horoscope` once
     that exists.
   - It prompts the local model, then writes `outputs/last_summary.json` as
     `{generated, headline, bullets: [≤3], model, fallback: bool}`, served on
     `:8765`.
2. **Pi**: `summary-service.js`, a clone of `rss-service.js`, serving
   `/api/summary`.
3. **Recipe**: a 26px headline and 22px bullets in the quadrant.

**Guardrails.** A wall display must not hallucinate your schedule.
- Structured facts pass **through** untouched. The LLM writes prose only.
- Post-validate every time or number in the output against the inputs. If a
  "3:30" appears that isn't in the calendar, drop the LLM output.
- Fall back to a rule-based headline, the same pattern as
  `rule_based_recommendation()` in `daily-briefing.py`.
- Show `generated`. FileVault means that after a cold reboot the Mac produces
  nothing until someone logs in. The tile must show that it's stale, not a
  blank.

This matters more for the **kitchen paper** than for v0. Its morning face is
literally a synthesised header ("high 61°, good run day").

- **Needs LAN:** the Mac job, the model, and serving the file.
- **Cloud-doable:** the Pi service, fixture and recipe.

### 6. Alert ack/snooze

- Build this only after 4 exists, because it needs an inbound path.
- The Pi needs `POST /api/alerts/snooze?device=v0&hours=2`, which suppresses
  `notify` for that device until a deadline. That is a small change to
  `StalenessAlertState`.
- It is worth it only if false alarms become a real annoyance.
- Today's latches already fire **once per episode**, so there's little noise
  to snooze.

### 7. `/next` from Discord: low value, don't build a bot for it

- `/next` already works from a phone bookmark on home Wi-Fi, with a 20–30 s
  tap-to-panel time thanks to the poke flag.
- Away from home is exactly when you aren't looking at the Kindle. A dedicated
  gateway bot (a bot token plus a new daemon) buys almost nothing.
- If 4 exists, "next" is one line in its runbook. Accept the LLM's latency.
- **Note** review F15: `/next` changes state on a GET. Discord's own link
  unfurler can't reach a LAN IP, so pasting the link into Discord is safe.
  iMessage builds link previews *on the device*, on the LAN, so pasting it
  there will advance the playlist.

### 8. Weekly dashboard health report

- On Sunday evening, the Pi posts counts for the week: stale episodes, BYOS
  failures, lowest battery, and fixture-served tile-hours (see review F3).
- It needs small counters persisted to `cache/`.
- It is nice for spotting slow rot, such as "calendar served mock all week".
  Not urgent.

## Things not to do

- **Expose the Pi or BYOS to the internet** for Discord interactions or
  webhooks. The Pi is the household Pi-hole.
- **Run models on the Pi.** It has about 600 MB free. LLM work stays on the
  Mac, and the Pi only ever *reads* its JSON output.
- **Let an LLM rewrite live numbers**: transit countdowns, times, step
  counts. Prose only, and validated.
- **Put a new Discord bot token or webhook on the Pi** unless the feature
  needs the Pi. The Mac already holds the LLM-side secrets. Keep the Pi's
  secret surface to what it has.

## LAN plumbing notes for whoever builds these

- The Mac is addressed two ways: BYOS at `192.168.50.204` (a DHCP
  reservation) and RSS at the mDNS name, because `config.js` says
  reservations "don't stick" under macOS private Wi-Fi addressing. Those two
  claims conflict (review F18).
  - Settle it before adding a third Mac-hosted JSON file. Either turn off
    rotating private addressing for the home network, or use the mDNS name
    everywhere.
  - Anything on `:8765` should use the same form `RSS_DIGEST_URL` uses.
- **Every** Mac-produced JSON should carry `generated`, and its Pi service
  should follow `rss-service.js`: cache, then expired cache, then fixture,
  with `source` exposed. The recipe should show age and **SAMPLE**
  (review F3).
- Discord webhook rate limits (about 5 requests per 2 s per webhook) don't
  matter at these volumes. A hung Discord request does, until `notify.js`
  gets a timeout (review F16).

## Suggested order

1. **Build 1 now.** It is cloud-doable, small, and makes every future
   incident cheaper.
2. **Agree the JSON shape for 2 and build it.** It overlaps kitchen task 1,
   and the content already exists.
3. **Build 3** if you want a daily phone view. It shares the multipart
   `notify.js` change with anything else that posts images.
4. **Check where the Channels session runs.** If it's on the LAN, write the
   runbook for 4. That is an afternoon, and 6 and 7 come almost free with it.
5. **Build 5 alongside the kitchen render layer**, where it pays off most.
