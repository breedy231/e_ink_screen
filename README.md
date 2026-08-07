# Kindle E-ink Dashboard

A low-power e-ink dashboard for a jailbroken Kindle Touch (4th Generation)
showing time, weather, calendar, a daily Pokemon, and device status.

A Raspberry Pi on the local network renders 600x800 grayscale PNGs; the
Kindle fetches one every 15 minutes and displays it with `eips`. No cloud
services involved.

## Features

- **Weather**: current conditions + forecast via Open-Meteo (no API key)
- **Calendar**: today/tomorrow events from a private iCloud calendar feed
- **Daily Pokemon**: context-aware pick (weather, calendar, holidays),
  e-ink-optimized sprite, no repeats until all 1025 have appeared
- **Device status**: battery level reported by the Kindle on each fetch,
  with Discord alerts when it runs low
- **Layout system**: JSON-defined grid layouts with reusable components
- **Battery-aware**: fetches only during active hours (7am–10pm CT);
  survives reboots via an upstart job

## Quick start

```bash
# Install and test the server
cd server && npm install && npm test

# Render a layout locally with mock data (no network needed)
node generate-flexible-dashboard.js wild-swiss --mock
node generate-flexible-dashboard.js --list

# Run the HTTP server
cp .env.example .env    # fill in CALENDAR_URL etc.
npm start               # then: curl localhost:3000/dashboard > dash.png
```

## Deployment

```bash
# Validate everything first (syntax, secrets, unit tests)
./scripts/validate.sh

# Server → Raspberry Pi (rsync + systemd restart)
./deploy-to-pi.sh

# Kindle scripts → device
export KINDLE_PASSWORD='...'
./deploy-kindle.sh --restart
```

One-time setup: `pi/setup-auto-deploy.sh` on the Pi (systemd service, Python
venv, auto-deploy timer); on the Kindle, install the upstart job
`/etc/upstart/dashboard.conf` pointing at `/mnt/us/dashboard/on-boot.sh`.

## Repository layout

```
├── server/            # Node.js render server + CLI (see server/config.js for env vars)
│   ├── layouts/       # JSON layout definitions
│   └── *.py           # Pillow-based e-ink optimizers (server/requirements.txt)
├── kindle/            # POSIX shell scripts that run on the device
│   └── config/        # dashboard.conf (server address, schedule)
├── pi/                # Raspberry Pi provisioning + auto-deploy
├── scripts/           # validate.sh — run before every deploy
└── hardware/          # device notes
```

## Documentation

- `CLAUDE.md` — architecture, shell-compatibility rules, how to add a component
- `PI_PRODUCTION_GUIDE.md` — operations runbook (services, logs, troubleshooting)
- `DASHBOARD_LAYOUTS.md` — layout/grid system reference
- `SECURITY_ROTATION.md` — credential rotation runbook
- `CHANGELOG.md` — project history
- `REVIEW_FINDINGS.md` — 2026-08 codebase review that shaped this structure
