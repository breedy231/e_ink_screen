# Authoring BYOS Recipes and Mashups

How to build and change TRMNL/LaraPaper recipes for this dashboard **without
fighting the admin UI**. `TRMNL_SETUP.md` covers installing and wiring BYOS;
this covers the day-to-day loop of writing a screen.

Written 2026-08-17 after a long session that produced the current
Zen Quotes | Weather Chicago | CTA Transit screen. Most of the time went into
things that are obvious in hindsight and invisible from the UI.

## The one rule: use the API, not the browser

LaraPaper's markup editors are **CodeMirror 6 with a hidden Livewire textarea
mirror**. Driving them programmatically does not work:

- Writing to `textarea[name=view_content]` and dispatching `input`/`change`
  then clicking Save → the reload shows the *original* markup. Livewire
  ignores the DOM write.
- `insertText` into `.cm-content` after select-all → also discarded. Clicking
  `.cm-content` leaves `document.activeElement` on the page wrapper
  (`min-h-screen bg-white …`), so keystrokes go nowhere.
- `$wire.get` / `$wire.set` → `$wire.get is not a function` on this build.

Clicking the markup **variant tabs** (Full / Half-Horizontal / Half-Vertical /
Quadrant) also swaps scaffold text into the editor. Harmless if you don't
save, alarming if you don't expect it.

Hand-typing in the real browser is fine. Automating it is not. Use the archive
API instead — it round-trips every field including all the per-size variants.

### Credentials

A Sanctum token lives in `~/.config/byos.env` (chmod 600, outside the repo):

```bash
BYOS_TOKEN="…"          # quote it — the token contains a literal `|`
BYOS_URL="http://localhost:4567"
```

The unquoted version fails as `command not found: <token-tail>` and every
request comes back `{"message":"Unauthenticated."}`. Tokens are shown once at
creation; only a hash is stored.

### The endpoints that matter

```
GET  /api/plugin_settings                        # list recipes (id, name, trmnlp_id)
POST /api/plugin_settings                        # create; assigns a fresh trmnlp_id (uuid v7)
GET  /api/plugin_settings/{trmnlp_id}/archive    # export zip
POST /api/plugin_settings/{trmnlp_id}/archive    # import zip (multipart, field name `file`)
```

Import is upsert-by-`trmnlp_id`: `PluginImportService` looks for an existing
plugin with that id and updates in place, otherwise creates one.

**Recipes created before this workflow have `trmnlp_id = null`** and therefore
cannot be updated by import at all — `/api/plugin_settings` returns
`"id": null` for every seeded demo recipe. That is why the Chicago weather and
the narrow CTA layout became **new** recipes (10 and 11) rather than edits to
2 and 9.

### Archive layout

```
cta/
  settings.yml
  full.liquid
  half_vertical.liquid
weather/
  settings.yml
  full.blade.php
  quadrant.blade.php
```

Zip the *files*, not the directory:

```bash
cd /tmp/byos-recipes/cta
zip -q -r ../cta.zip settings.yml full.liquid half_vertical.liquid
source ~/.config/byos.env
curl -s -X POST "$BYOS_URL/api/plugin_settings/$(cat .trmnlp_id)/archive" \
  -H "Authorization: Bearer $BYOS_TOKEN" -F "file=@../cta.zip"
```

`settings.yml` mirrors `PluginExportService::generateSettingsYaml`:

```yaml
name: CTA Transit
no_screen_padding: 'no'
dark_mode: 'no'
strategy: polling
polling_verb: get
polling_url: http://192.168.50.163:3000/api/transit
refresh_interval: 5
id: 01a01009-1725-7f8c-b504-16b46214267e   # must match the trmnlp_id you POST to
```

The recipe sources live in **`byos-recipes/`** in this repo and are the source
of truth; BYOS's sqlite DB is downstream of them. Each `settings.yml` carries
its own `trmnlp_id` as `id:`, so no side files are needed — see
`byos-recipes/README.md` for the one-liner that pushes a change.

Liquid (`.liquid`) and Blade (`.blade.php`) both work. Blade gets `$data` plus
Laravel helpers (`data_get`, `now()`); Liquid gets `data`. The seeded weather
recipes are Blade, the CTA one is Liquid.

## Mashup layouts: the half-width trap

**Symptom:** a recipe that looks fine full-screen renders as an unreadable
squeeze when it occupies half the screen in a mashup.

**Cause:** `Plugin.php:948` —

```php
'half_vertical' => $this->render_markup_half_vertical ?? $this->render_markup,
```

A missing size variant silently falls back to the full markup. Markup written
for 800px wide gets rendered into ~400px. Nothing errors; it just looks bad.

So: **any recipe used in a mashup needs a markup variant for the size it will
actually occupy.** The five slots are `full`, `half_horizontal`,
`half_vertical`, `quadrant`, `shared`.

### Which slot gets which size

`PlaylistItem::getLayoutSize()`, by layout and position:

| Layout  | pos 0           | pos 1           | pos 2           | pos 3      |
|---------|-----------------|-----------------|-----------------|------------|
| `1Lx1R` | half_vertical   | half_vertical   | —               | —          |
| `1Tx1B` | half_horizontal | half_horizontal | —               | —          |
| `2Lx1R` | quadrant        | quadrant        | half_vertical   | —          |
| `1Lx2R` | half_vertical   | quadrant        | quadrant        | —          |
| `2x2`   | quadrant        | quadrant        | quadrant        | quadrant   |

The current screen is `2Lx1R`: Zen Quotes and Weather stacked as quadrants on
the left, CTA as a tall half_vertical on the right. Hence CTA needs
`half_vertical.liquid` and Weather needs `quadrant.blade.php`.

### Position 0 is the recipe you start from

`resources/views/livewire/plugins/recipe.blade.php:418`:

```php
$pluginIds = array_merge([$this->plugin->id], array_map('intval', $this->mashup_plugins));
```

The recipe whose page you're on becomes **position 0**. There is no way to
reorder afterwards. To land CTA in the right-hand `half_vertical` slot of a
`2Lx1R`, you must open **Zen Quotes**' Add-to-Playlist modal and pick Weather
then CTA as slots 0 and 1 — not the other way around.

### There is no edit for an existing mashup item

The playlists page exposes only `togglePlaylistItemActive(n)` and
`deletePlaylistItem(n)` for a mashup. Changing which recipes it points at
means **create a new mashup, then delete the old item**. Both controls sit
inside a dropdown, so Playwright's visibility check fails; click via
`browser_evaluate` on `[wire\:click="deletePlaylistItem(10)"]`.

## Verifying a change

HTTP 200 from the import proves nothing. **Render and look at the PNG.**

The Pi serves a cached image, so a fetch right after a change returns the
*old* screen — and an unknown query param like `?nocache=1` does not bust it
(`getCacheKey()` normalizes the URL). Two caches stack:

- `local-dashboard-server.js` image cache — `CACHE_TTL_MS`
- `trmnl-service.js` screen cache — `TRMNL_CACHE_TTL_MS` (240000 on the Pi)

Practical check: poll until the byte size changes, then read the file.

```bash
curl -s -o /tmp/dash.png -w "%{size_download}\n" http://192.168.50.163:3000/dashboard
```

Same size = still cached, not "no change". Faster loops for iterating on
markup, without touching the device, are in `TRMNL_SETUP.md`
(`npm run trmnl:preview`, `--next` to force a playlist advance).

Rendering a recipe from the LaraPaper UI writes a PNG under
`/storage/…/images/generated`. Fetch it over the **LAN address**
(`http://192.168.50.204:4567/…`) — `localhost` returns HTML/404 for the same
path. Playwright screenshots are not a workaround here: the files never
appear on disk, `fetch` inside the page fails CORS, and `canvas.toDataURL`
throws `SecurityError: Tainted canvases`.

## Version reality (checked 2026-08-17)

The running image `ghcr.io/usetrmnl/larapaper:latest` is **0.39.0, built
2026-07-14** — and 0.39.0 *is* the newest published tag, so
`docker compose pull` is a no-op.

The local checkout at `~/services/byos_laravel` is newer (2026-08-08,
`e8e7ae5`) and contains a **built-in MCP server** (`routes/ai.php`, with
`CreateRecipeTool`, `UpdateRecipeMarkupTool`, `RenderRecipeTool`, …). That
code is **not in any published image**. Reading the checkout and assuming the
container has those features wastes real time — check the running image, not
the source tree.

`docker/prod/docker-compose.yml` now passes `TOGGLE_MCP=${TOGGLE_MCP:-false}`
and `docker/prod/.env` sets it true, ready for whenever an image ships with
`/mcp`. Until then the route 404s regardless. Rollback artifacts from that
attempt: image tag `larapaper-rollback:0.39.0`, DB backup
`~/byos-backups/byos-20260817-085956.sqlite`, config backups `*.bak-20260817`.

## Gotchas worth not rediscovering

- The seeded "Weather" recipe was **Vienna** (upstream demo defaults). Chicago
  coords are already in `server/config.js:39-40`; recipe 11 hardcodes them in
  its `polling_url` against api.met.no.
- Two recipes can share a display name — the plugin picker showed "CTA Transit"
  twice (ids 9 and 10). Select by id.
- A playlist can be toggled off entirely. "Main Rotation" is currently OFF and
  "test" is ON, so the device cycles only what's in "test".
- The TRMNL `.layout` class vertically centers content. For a tall narrow
  column, set `justify-content:flex-start; align-items:stretch; height:100%`
  or you get a centered block with dead space above and below.
- Long labels overflow a half_vertical column. `{{ stop.label | split: '/' |
  first | truncate: 18 }}` keeps "146 Inner Lake Shore/Michigan Express" inside
  the column.
