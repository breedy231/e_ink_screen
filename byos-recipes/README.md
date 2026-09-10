# BYOS recipe sources

Markup and settings for the LaraPaper/BYOS recipes this dashboard actually
uses. These are the source of truth — BYOS's sqlite DB is downstream of them.

| Directory | Recipe (LaraPaper id) | Sizes provided |
|-----------|-----------------------|----------------|
| `cta/`     | CTA Transit (10)     | `full`, `half_vertical` |
| `weather/` | Weather Chicago (11) | `full`, `quadrant` |

The `id:` in each `settings.yml` is the recipe's `trmnlp_id` and must match
the URL you import to. To push a change:

```bash
cd byos-recipes/cta
zip -q -r /tmp/cta.zip settings.yml full.liquid half_vertical.liquid
source ~/.config/byos.env
curl -s -X POST "$BYOS_URL/api/plugin_settings/$(grep '^id:' settings.yml | cut -d' ' -f2)/archive" \
  -H "Authorization: Bearer $BYOS_TOKEN" -F "file=@/tmp/cta.zip"
```

Then verify by looking at a rendered PNG, not the HTTP status. See
`../BYOS_RECIPES.md` for the full workflow, the mashup size-slot table, and
the gotchas (missing size variants silently fall back to full-width markup;
the admin UI's markup editor cannot be automated).
