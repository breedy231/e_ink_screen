# Transit screen — research + plan

Status: **built and live, 2026-08-10.** `server/transit-service.js` +
`/api/transit` + the "CTA Transit" BYOS recipe are done (see `CHANGELOG.md`).
Fixture-backed until the CTA keys arrive. This doc is kept for the research
and the architecture reasoning — the "what can be built before the keys
arrive" checklist below is now all done, and the handoff prompt at the
bottom is stale (superseded — see `CLAUDE.md`'s TRMNL section for the
current handoff instead).

Goal: a screen showing real-time departures from Brendan's stops — the 8,
146 and 151 buses, Red and Brown line trains — plus a sense of travel time
to the Loop.

## Data sources (all CTA, all first-party)

CTA runs three separate real-time APIs. Bus and train are **different
systems with different keys** — this is the main surprise.

| What | Endpoint | Key | Format |
|---|---|---|---|
| Bus arrivals (8/146/151) | `ctabustracker.com/bustime/api/v3/getpredictions` | Bus Tracker key | XML, `format=json` for JSON |
| Train arrivals (Red/Brown) | `lapi.transitchicago.com/api/1.0/ttarrivals.aspx` | **separate** Train Tracker key | XML, `outputType=JSON` |
| Service alerts | `lapi.transitchicago.com/api/1.0/alerts.aspx` | none | XML/JSON |
| GTFS-RT (bulk trip updates / vehicle positions) | `transitdata.transitchicago.com` | key, appended as `?key=` | protobuf + JSON |
| Static schedules (stop IDs, trip times) | `transitchicago.com/developers/gtfs/` | none | GTFS zip |

Both keys are **request-and-wait**, not self-serve: you create an account and
CTA emails a key after approval, one key per account. Neither can be obtained
by an agent — **Brendan has to do this himself, and it's the long pole.**
Start there before any code.

Notes that shape the design:

- Train Tracker caps a request at **4 `stpid`s**. Prefer `mapid` (a whole
  station, both directions) over enumerating platform stops. Red+Brown from
  one station = one `mapid` call.
- Train Tracker has a **daily quota** that resets at midnight; exceeding it
  returns an error rather than data. At the dashboard's 15-minute cadence
  (~60 calls/day) this is not close to a problem, but a tight dev loop could
  burn it — cache aggressively and use fixtures while iterating.
- Bus Tracker `getpredictions` takes `rt` + `stpid`, and multiple stops per
  call. Its companion `getstops` is how you discover stop IDs for a route +
  direction.
- Arrival predictions are **only ~30 minutes out**. Late night, the screen
  will legitimately be empty — design for that state, don't treat it as an
  error.
- Alerts need no key, so "Red Line: significant delays" can ship even before
  the tracker keys arrive.

### Travel time to the Loop

There is no CTA "how long will my trip take" API. Three honest options,
cheapest first:

1. **Departure + static ride time.** Take the next departure from the
   real-time API and add a fixed ride duration derived once from the static
   GTFS schedule. Free, no extra dependency, and correct to within a few
   minutes on rail. Recommended.
2. **GTFS-RT trip updates.** The trip's predicted arrival at a Loop stop is
   in the feed. Accurate, but means parsing protobuf and matching trip IDs —
   real work for a marginal gain.
3. **Google/Mapbox Directions.** Actually models traffic, but it's a paid,
   keyed, external dependency for a number that changes by minutes. Skip
   unless driving is a real alternative he'd act on.

## Architecture — decided: BYOS recipe, device mounted landscape

**Decided 2026-08-10.** Brendan prefers TRMNL's landscape layouts to the
hand-rolled portrait ones, and `hardware/kindle-frame-mount.scad` is a
magnetic mount that "Holds Kindle in portrait OR landscape". So the fix for
the sideways problem is physical: **turn the frame 90°.** A `TRMNL_ROTATION=cw`
render then reads upright and uses the full 800x600 panel. No letterbox, no
compromise, and the whole reason to prefer a native component evaporates.

The shape:

- `server/transit-service.js` — merges bus + train into one payload, with the
  cache + fallback chain `calendar-service.js` uses.
- `/api/transit` on `local-dashboard-server.js` — serves that as JSON.
- A BYOS polling plugin fetches that URL and renders it in Liquid.

Layout iteration is then edit-Liquid → reload `npm run trmnl:serve`, no Node
redeploy and no device round trip.

**This also answers the broader "can BYOS replace bespoke Node work?"
question: yes, for new content screens.** The Node side becomes data plumbing
(fetch, cache, fall back, expose JSON) — which is where its existing patterns
are genuinely good — and BYOS owns layout, which is where hand-drawing on a
canvas was slow and unpleasant. Existing portrait layouts still work and
don't need migrating; this is the pattern for new work.

Consequences to keep in mind:

- The **whole rotation, including the Kindle-native layouts, flips.** Once the
  frame is landscape, `wild-swiss` and friends are the ones rendering
  sideways. Either move to `TRMNL_MODE=only`, or re-do the portrait layouts
  landscape, or accept the mixed state. Worth settling explicitly.
- `TRMNL_ROTATION=none` (the 600x360 letterbox added earlier) becomes
  unnecessary for this use. Keep it — it costs nothing and covers the
  portrait-mount case — but it is no longer the recommended path.

## What can be built before the keys arrive

Almost everything. The keys gate live data, not the design:

- **Stop IDs and ride times** come from the **static GTFS zip, which needs no
  key.** Download it, find the 8/146/151 stops and the Red/Brown station
  `mapid`s nearest Brendan, and derive the scheduled ride time to the Loop.
  Only needs his cross-streets.
- **Fixtures.** Hand-write the `/api/transit` payload shape and check in
  sample responses. Everything downstream builds against these — and they
  stay useful afterwards, since the Train Tracker daily quota makes
  live-iterating on layout a bad idea anyway.
- **The whole BYOS recipe.** Liquid markup, layout, empty/late-night state,
  all iterated against fixtures through `npm run trmnl:serve`.
- **`transit-service.js` + `/api/transit`,** with the response parsers written
  against the documented XML/JSON shapes and unit-tested on fixtures.
- **Service alerts** — that API needs no key at all, so it can go live
  immediately.

When the keys land, it's dropping them into `server/.env` and swapping the
fixture source for the real fetch.

~~Still needed from Brendan: cross-streets, and whether he wants Loop-bound
only or both directions.~~ Resolved 2026-08-10: Broadway & Cornelia,
Loop-bound only. Baked into `server/transit-stops.js`.

## Handoff prompt (superseded)

Done as of 2026-08-10 — see `CHANGELOG.md`. The next-session handoff prompt
now lives in `CLAUDE.md`'s TRMNL section, since the open work (real BYOS
playlist content, and whether to redo `wild-swiss` for landscape) isn't
transit-specific anymore.
