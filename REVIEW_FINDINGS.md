# Codebase Review — August 2026

A lead-engineer review of the repository focused on maintainability and
extensibility, conducted to set up the next phase of work (tasks and news
components) for long-term success. This document records what was found, what
was changed, and what was deliberately deferred.

## TL;DR

The system worked in production, but the repo had accumulated three
generations of architecture (cron era → local server era → Pi/loop era)
without ever deleting the previous one. Roughly **40% of the shell code was
dead or broken**, the test suite validated the retired architecture and would
have *failed* if dead code were correctly removed, two secrets were committed
since the initial commit, and six real bugs lurked in the production Kindle
scripts — including one that blanked the display exactly when the server was
down. The server code had a working core (component/layout engine, resilient
data services) wrapped in duplication: two divergent render pipelines and a
1,949-line engine file with 5 unused component classes.

All of this was remediated in six phases (one commit each) on this branch.

## Findings and fixes

### 1. Committed secrets (critical)

The Kindle root password appeared in 4 tracked files and a private iCloud
calendar URL (embedding an auth token) in 1 — both since the initial commit,
so both live in git history. Ironically, the old CLAUDE.md claimed the
password was "stored in memory file only (never commit to repo)".

**Fixed**: all credentials now come from environment variables
(`KINDLE_PASSWORD`, `CALENDAR_URL`), with `server/.env.example` as the
template and loud failures when a needed credential is missing. A
secret-pattern gate in `scripts/validate.sh` prevents reintroduction.
**Operator action still required** — rotate both credentials
(see `SECURITY_ROTATION.md`; scrubbing HEAD does not un-leak history).

### 2. Production bugs in the Kindle scripts (critical)

1. `fetch-dashboard.sh` — malformed `[ -f "$img" && ... ]` is a syntax error
   under `set -e`: the last-resort fallback loop **died instead of showing a
   stale image**, i.e. the display blanked precisely when the server was
   unreachable.
2. `on-boot.sh` launched the loop directly, bypassing `start.sh`'s WiFi
   keep-alive — so after every reboot the radio slept on battery and updates
   silently stopped. (Two entire test scripts existed to "verify" the
   keep-alive; both only grepped `start.sh` for strings and could never
   catch this.) Boot now delegates to `start.sh`.
3. Sourcing `dashboard.conf` mid-script clobbered the loop's `LOG_FILE`
   variable — loop logs landed in `fetch.log` with two writers fighting over
   rotation. Same class of bug: config values also clobbered `--host`/`--log`
   CLI flags. Both fixed (renamed variable; CLI > config > default).
4. `[ "$url" = *"?"* ]` never matches in POSIX sh — `--force` produced
   malformed `?grid=true?t=...` URLs. Replaced with the `case` idiom.
5. A missing config fell back to `192.168.1.100` — a subnet from two network
   generations ago — silently fetching from a dead IP. Now a loud fatal.
6. Scripts gated on `-x` and were committed mode 644 — but `/mnt/us` is
   vfat, where exec bits don't survive anyway. A fresh deploy silently
   degraded to a one-shot fetch (dashboard displayed once, never updated).
   All inter-script invocation is now `sh "$script"` + `-f` gates; shebangs
   corrected from `#!/bin/bash` (bash doesn't exist on the device).

### 3. Dead and broken code (~2,300 lines deleted)

- `deploy-to-kindle.sh` (494 lines): broken **since the initial commit** —
  deployed three files that never existed in the repo, and omitted the two
  scripts production actually runs. Its replacement (`deploy-kindle.sh`,
  ~110 lines) ships exactly the live set.
- `deploy-kual.sh` + KUAL docs: the KUAL extension was documented as
  "✅ COMPLETED" but **never committed** — `git log --all -- KUAL` is empty.
  `kindle/status.sh`/`show-logs.sh` existed solely to back those phantom
  menu items (and read log paths nothing writes).
- Cron-era system: `setup-local-cron.sh`, `fix-eink-schedule.sh` + its
  README. Running them today would fight the loop with duplicate fetches.
- `start-local-server.sh`: hard-exited on a file deleted months ago.
- Server: duplicate Pokemon DB builder, 5 component classes referenced by no
  layout (~600 lines), an unreferenced layout, `device-stats.js` (production
  stats arrive as query params), the Netlify root `package.json` fossil.

### 4. Test suite anchored the wrong architecture

1,055 lines of "tests" were string-greps asserting that cron-era code still
existed — deleting dead code correctly made the gate *fail*, and the live
loop scripts were entirely outside its coverage. The one real unit test
wasn't runnable via `npm test` (package.json pointed at a deleted file), and
the lockfile was missing `node-ical` (clean `npm ci` produced a server that
crashed on require).

**Fixed**: suite replaced by `scripts/validate.sh` (POSIX syntax on every
Kindle script, bash/node syntax elsewhere, secret scan, git exec-bit check,
`npm test`), package.json scripts corrected, lockfile regenerated,
33 unit tests green.

### 5. Server architecture debt

- **Two divergent pipelines**: the HTTP server and the CLI each had their own
  copy of layout loading, service selection, and `enrichLayoutWithData` —
  already drifted (server refused deviceStats into status-bar; CLI injected
  it). Adding a component meant ~6 edits in 3 files; forgetting one rendered
  blank with no error.
- **No config layer**: `America/Chicago` hardcoded 12×, Chicago coordinates
  6×, three inconsistent generations of IPs across shell scripts. The
  production server accepted no overrides at all — relocation meant editing
  source. Meanwhile the systemd unit's `EnvironmentFile=` plumbing sat unused.
- **Cache defeated by design**: the cache key included the Kindle's
  `battery=N` query param, so every fetch was a miss — a full render plus a
  Python subprocess every 15 minutes for a 60-second cache that never hit.
- **Venv mismatch**: the Pi provisioner creates `venv/`; the code looked for
  `test_env/` (the original dev machine's), so e-ink optimization silently
  depended on system-wide Pillow. No `requirements.txt` declared it.
- Small but real: duplicate `'garden'` object key in pokemon-selector (second
  silently won), weather fetch ignored HTTP status codes and had no timeout
  (a hung socket stalled rendering forever), `module.exports` omitted the
  four components production actually uses.

**Fixed**: `server/config.js` (env-driven), `server/generate.js` (single
pipeline), registry-driven enrichment via `static dataNeeds` (adding a
component is now a class + one registry entry + layout JSON),
`server/render-utils.js` (deduped helpers: weather symbols ×3, truncation
×5, quote loader ×3, battery thresholds ×2), cache key strips telemetry
params (verified: second fetch is a hit), `requirements.txt` + venv path
alignment, and the small bugs above. Visual parity verified by pixel-diffing
all 10 layouts against pre-refactor baselines (≤0.15%, all attributable to
the rendered clock time).

### 6. Documentation described a system that didn't exist

README and AUTOMATION.md presented the abandoned Netlify deploy as
"Production (current)". CLAUDE.md was 915 lines of append-only task log with
nine simultaneous "Current Status" sections, a project-structure diagram
where none of the listed server files existed, a 5-minute update interval
(actual: 15), and the false password claim. **Fixed**: CLAUDE.md rewritten
(~180 lines, current architecture + rules), history moved to `CHANGELOG.md`,
README rewritten, AUTOMATION.md and SERVER_SETUP.md deleted (live content
folded into `PI_PRODUCTION_GUIDE.md`), layouts doc updated.

## Deliberately deferred (and why)

- **Splitting `dashboard-engine.js` into a `components/` directory** — after
  deleting dead components and deduping it's ~1,350 lines, tolerable for a
  single-contributor project. The extensibility win came from the registry,
  not file count. Revisit after tasks/news components land.
- **Rewriting `SwissPosterComponent` onto the grid system** — it's the
  production layout, hand-positioned but working and contained.
- **Framework adoption** (express, TypeScript, test runner, Docker) — hobby
  scale; plain `http`, node asserts, and systemd are adequate and deployed.
- **Git history rewrite** — operator decision; rotation makes the leaked
  values worthless. Commands documented in `SECURITY_ROTATION.md`.
- **Pixel-snapshot regression tests** — renders are time-dependent; would
  need mock-clock plumbing first. The CLI `--mock` render + eyeball is cheap
  and sufficient today.
- **KUAL menu** — mooted by the upstart/loop architecture; deleted from docs
  rather than built.

## Next phase: tasks and news components

The refactor makes each of these a two-file change plus wiring:

1. `server/tasks-service.js` (Todoist REST, `TODOIST_TOKEN` via config,
   cached like calendar-service) + a `TasksComponent` with
   `static dataNeeds = ['tasks']`, one `COMPONENT_REGISTRY` entry, one
   `DATA_CONFIG_KEYS` entry, one fetch branch in `generate.js`, and a layout
   edit.
2. Same shape for `server/news-service.js` (RSS).

That predicted file count is the acceptance test for this refactor.

## Operator checklist (do these, in order)

1. **Rotate the Kindle root password and regenerate the iCloud calendar
   URL** — both are in git history on GitHub (`SECURITY_ROTATION.md`).
2. Populate `server/.env` on the Pi (`CALENDAR_URL`, `DISCORD_WEBHOOK_URL`)
   and `KINDLE_PASSWORD` in your dev shell.
3. Before deploying the server changes: check how the live Pi service binds
   (`ss -tlnp | grep 3000`). The new default is `0.0.0.0`; if the current
   working unit differs, set `HOST` in `.env` accordingly.
4. Deploy: `./deploy-to-pi.sh`, then `npm install` runs via the deploy
   script; verify with `curl http://192.168.50.163:3000/health`.
5. Deploy Kindle scripts: `KINDLE_PASSWORD=... ./deploy-kindle.sh --restart`;
   verify `/etc/upstart/dashboard.conf` execs `sh /mnt/us/dashboard/on-boot.sh`;
   reboot-test the Kindle.
6. Optional: run the documented `git filter-repo` history rewrite.
