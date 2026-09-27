#!/bin/bash
# One-shot BYOS setup for the 2026-09 morning/evening playlist split.
#
# Idempotent: skips anything that already exists. Snapshots the DB first.
#
#   - Enables alias rendering (the preview loop's --plugin route) on all six
#     real recipes: CTA Transit (10), Weather Chicago (11), Todoist Today (12),
#     Calendar (13), Fitness (14), RSS Digest (15).
#   - Creates two scheduled playlists on device 1:
#       Morning        06:00-11:00  2x2 Morning Board (CTA|Zen / Weather|Fitness), Fitness, Todoist
#       Day & Evening  11:00-22:00  2x2 Day Board (Calendar|Weather / Tasks|CTA), RSS, Zen quote
#   - Deactivates the old "Main Rotation" and "test" playlists.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "== snapshot DB first"
"$SCRIPT_DIR/backup-byos-db.sh"

echo "== apply playlist setup"
docker exec prod-app-1 php -r '
$pdo = new PDO("sqlite:/var/www/html/database/storage/database.sqlite");
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$now = gmdate("Y-m-d H:i:s");
// 2x2 slots render row-major: pos0 TL, pos1 TR, pos2 BL, pos3 BR.
$morningBoard = json_encode([
    "mashup_layout" => "2x2",
    "mashup_name" => "Morning Board",
    "plugin_ids" => [10, 3, 11, 14],   // CTA TL, Zen TR, Weather BL, Fitness BR
]);
$dayBoard = json_encode([
    "mashup_layout" => "2x2",
    "mashup_name" => "Day Board",
    "plugin_ids" => [13, 11, 12, 10],  // Calendar TL, Weather TR, Tasks BL, CTA BR
]);

$pdo->exec("UPDATE plugins SET alias = 1 WHERE id IN (10,11,12,13,14,15)");
echo "aliases enabled\n";

function playlistId(PDO $pdo, string $name, string $from, string $until, string $now): int {
    $q = $pdo->prepare("SELECT id FROM playlists WHERE name = ?");
    $q->execute([$name]);
    if ($id = $q->fetchColumn()) { echo "$name exists (id $id)\n"; return (int) $id; }
    $ins = $pdo->prepare("INSERT INTO playlists (device_id, name, is_active, active_from, active_until, created_at, updated_at) VALUES (1, ?, 1, ?, ?, ?, ?)");
    $ins->execute([$name, $from, $until, $now, $now]);
    $id = (int) $pdo->lastInsertId();
    echo "created $name (id $id)\n";
    return $id;
}

function addItem(PDO $pdo, int $playlistId, int $order, ?int $pluginId, ?string $mashup, string $now): void {
    $q = $pdo->prepare("SELECT COUNT(*) FROM playlist_items WHERE playlist_id = ? AND \"order\" = ?");
    $q->execute([$playlistId, $order]);
    if ($q->fetchColumn() > 0) { echo "  item $order exists\n"; return; }
    $ins = $pdo->prepare("INSERT INTO playlist_items (playlist_id, plugin_id, \"order\", is_active, mashup, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)");
    $ins->execute([$playlistId, $pluginId, $order, $mashup, $now, $now]);
    echo "  item $order added\n";
}

$morning = playlistId($pdo, "Morning", "06:00", "11:00", $now);
addItem($pdo, $morning, 1, 10, $morningBoard, $now);   // 2x2 CTA/Zen/Weather/Fitness
addItem($pdo, $morning, 2, 14, null,          $now);   // Fitness
addItem($pdo, $morning, 3, 12, null,          $now);   // Todoist

$evening = playlistId($pdo, "Day & Evening", "11:00", "22:00", $now);
addItem($pdo, $evening, 1, 13, $dayBoard, $now);       // 2x2 Calendar/Weather/Tasks/CTA
addItem($pdo, $evening, 3, 15, null,      $now);       // RSS
addItem($pdo, $evening, 4, 3,  null,      $now);       // Zen quote fullscreen

$pdo->exec("UPDATE playlists SET is_active = 0 WHERE name IN (\"Main Rotation\", \"test\")");
echo "old playlists deactivated\n";

foreach ($pdo->query("SELECT id, name, is_active, active_from, active_until FROM playlists") as $r) {
    echo "playlist {$r["id"]} {$r["name"]} active={$r["is_active"]} {$r["active_from"]}-{$r["active_until"]}\n";
}
'
echo "== done"
