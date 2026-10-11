#!/bin/bash
# Put the Clock recipe (byos-recipes/clock) on the Morning Board in place of
# Zen, and enable alias rendering so `npm run trmnl:preview -- --plugin Clock`
# works. Import the recipe first (see byos-recipes/README.md).
#
# Idempotent. Snapshots the DB first.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLOCK_TRMNLP_ID="$(grep '^id:' "$SCRIPT_DIR/../byos-recipes/clock/settings.yml" | cut -d' ' -f2)"

echo "== snapshot DB first"
"$SCRIPT_DIR/backup-byos-db.sh"

echo "== wire Clock into the Morning Board"
docker exec prod-app-1 php -r '
$pdo = new PDO("sqlite:/var/www/html/database/storage/database.sqlite");
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$zenId = 3;

$q = $pdo->prepare("SELECT id FROM plugins WHERE trmnlp_id = ?");
$q->execute([$argv[1]]);
$clockId = (int) $q->fetchColumn();
if (!$clockId) { fwrite(STDERR, "Clock recipe not imported yet\n"); exit(1); }
echo "Clock is plugin $clockId\n";

$pdo->prepare("UPDATE plugins SET alias = 1 WHERE id = ?")->execute([$clockId]);
echo "alias enabled\n";

$rows = $pdo->query("SELECT id, mashup FROM playlist_items WHERE mashup LIKE \"%Morning Board%\"")->fetchAll(PDO::FETCH_ASSOC);
foreach ($rows as $r) {
    $m = json_decode($r["mashup"], true);
    // 2x2 slots render row-major: TL, TR, BL, BR. Zen sits TR.
    $m["plugin_ids"] = array_map(fn ($id) => $id === $zenId ? $clockId : $id, $m["plugin_ids"]);
    $pdo->prepare("UPDATE playlist_items SET mashup = ?, updated_at = ? WHERE id = ?")
        ->execute([json_encode($m), gmdate("Y-m-d H:i:s"), $r["id"]]);
    echo "item {$r["id"]}: " . json_encode($m["plugin_ids"]) . "\n";
}
' "$CLOCK_TRMNLP_ID"
echo "== done"
