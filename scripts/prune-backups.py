#!/usr/bin/env python3
"""Tiered retention for BYOS DB backups.

Keeps:
  - Last 24 hourly snapshots (rolling 1-day window at fine granularity)
  - Latest snapshot from each of the last 14 distinct days
  - Latest snapshot from each of the last 8 distinct ISO weeks

Anything outside those three sets is deleted.

Expects filenames in the format written by scripts/backup-byos-db.sh:
  byos-YYYYMMDD-HHMMSS.sqlite

Called at the end of backup-byos-db.sh. Safe to run standalone:
  python3 scripts/prune-backups.py [dir]   # default: ~/byos-backups

Exit 0 on success; prints one line per pruned file to stdout.
"""
from __future__ import annotations

import os
import re
import sys
from datetime import datetime
from pathlib import Path

HOURLY_KEEP = 24
DAILY_KEEP = 14
WEEKLY_KEEP = 8

NAME_RE = re.compile(r"^byos-(\d{8})-(\d{6})\.sqlite$")


def main(argv: list[str]) -> int:
    if len(argv) > 1:
        backup_dir = Path(argv[1]).expanduser()
    else:
        backup_dir = Path(os.environ.get("BYOS_BACKUP_DIR", "~/byos-backups")).expanduser()

    if not backup_dir.is_dir():
        print(f"[prune-backups] no such directory: {backup_dir}", file=sys.stderr)
        return 0

    items: list[tuple[datetime, str]] = []
    for name in os.listdir(backup_dir):
        m = NAME_RE.match(name)
        if not m:
            continue
        try:
            dt = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")
        except ValueError:
            continue
        items.append((dt, name))

    if not items:
        return 0

    items.sort()  # chronological; newest last
    keep: set[str] = set()

    # 1. Last N snapshots by wall time.
    for _, name in items[-HOURLY_KEEP:]:
        keep.add(name)

    # 2. Latest per calendar day, newest N days.
    by_day: dict[object, str] = {}
    for dt, name in items:
        by_day[dt.date()] = name  # later writes overwrite, so value is latest-of-day
    for day in sorted(by_day.keys(), reverse=True)[:DAILY_KEEP]:
        keep.add(by_day[day])

    # 3. Latest per ISO week, newest N weeks.
    by_week: dict[tuple[int, int], str] = {}
    for dt, name in items:
        iso = dt.isocalendar()
        year = getattr(iso, "year", iso[0])
        week = getattr(iso, "week", iso[1])
        by_week[(year, week)] = name
    for wk in sorted(by_week.keys(), reverse=True)[:WEEKLY_KEEP]:
        keep.add(by_week[wk])

    # Only touches files matching NAME_RE, so anything a human drops in this
    # directory (a hand-labelled snapshot, a .corrupt file) is never removed.
    pruned = 0
    for _, name in items:
        if name in keep:
            continue
        path = backup_dir / name
        try:
            path.unlink()
            pruned += 1
            print(f"[prune-backups] pruned {name}")
        except OSError as e:
            print(f"[prune-backups] failed to remove {name}: {e}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
