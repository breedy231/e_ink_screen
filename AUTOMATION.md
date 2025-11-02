# Dashboard Automation Guide

This guide covers all automation options for keeping your Kindle dashboard updated.

## Quick Start

### Local Development (Auto-update every 5 minutes)
```bash
# Basic auto-update (regenerates weather dashboard every 5 minutes)
./watch-and-update.sh

# Custom interval (10 minutes)
./watch-and-update.sh -i 600

# Auto-deploy to Kindle after each generation
./watch-and-update.sh -d

# Different layout
./watch-and-update.sh -l compact
```

### Production (Kindle auto-fetches from cloud)
Already configured! Your Kindle fetches from Netlify every 15 minutes (7am-10pm).

---

## Automation Options

### 1. Local Auto-Update (Development)

**Script:** `watch-and-update.sh`

**Use when:** Developing/testing locally, want to see changes automatically

**Features:**
- Regenerates dashboard at configurable intervals
- Optional auto-deployment to Kindle
- Optional local preview
- Logs all updates

**Examples:**
```bash
# Update every 5 minutes (default)
./watch-and-update.sh

# Update every 10 minutes with compact layout
./watch-and-update.sh -i 600 -l compact

# Update and auto-deploy to Kindle every 5 minutes
./watch-and-update.sh -d

# Update every 2 minutes and show in local viewer
./watch-and-update.sh -i 120 -t

# Verbose logging
./watch-and-update.sh -v
```

**Stop watching:** Press `Ctrl+C`

### 2. System Cron (Local Machine)

**Use when:** Want persistent background updates on your local machine

**Setup:**
```bash
# Edit crontab
crontab -e

# Add entry for every 10 minutes
*/10 * * * * cd /path/to/e_ink_screen && ./watch-and-update.sh -i 0

# Or use node directly
*/5 * * * * cd /path/to/e_ink_screen && node server/generate-flexible-dashboard.js weather
```

**Intervals:**
- `*/5 * * * *` - Every 5 minutes
- `*/10 * * * *` - Every 10 minutes
- `0 * * * *` - Every hour
- `0 */2 * * *` - Every 2 hours

### 3. Kindle-Side Cron (Production)

**Status:** ✅ Already configured!

**Script:** `kindle/setup-cloud-cron.sh`

**Current schedule:** Every 15 minutes, 7am-10pm

**To modify:**
```bash
# SSH to Kindle
ssh root@kindle

# Edit schedule in config
vi /mnt/us/dashboard/config/cloud-config.conf

# Re-run setup
/mnt/us/dashboard/setup-cloud-cron.sh
```

**View current cron jobs:**
```bash
ssh root@kindle "crontab -l"
```

### 4. GitHub Actions (Cloud Trigger)

**Use when:** Want cloud-based scheduling without server

**Setup:** Create `.github/workflows/update-dashboard.yml`:
```yaml
name: Update Kindle Dashboard

on:
  schedule:
    # Run every 10 minutes
    - cron: '*/10 * * * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: cd server && npm install

      - name: Generate dashboard
        run: node server/generate-flexible-dashboard.js weather

      - name: Upload to artifact (optional)
        uses: actions/upload-artifact@v3
        with:
          name: dashboard
          path: test-images/dashboard-*.png
```

**Note:** This generates images but doesn't auto-deploy. Use with Netlify deployment for best results.

### 5. Netlify Scheduled Functions

**Status:** ✅ Already set up!

**How it works:**
1. Netlify hosts your dashboard generation function
2. Kindle fetches from Netlify every 15 minutes via cron
3. Function includes 5-minute cache for efficiency

**Endpoint:** `https://your-site.netlify.app/dashboard?token=TOKEN&layout=weather`

**Cache behavior:**
- 5-minute in-memory cache on function
- CDN edge caching for faster global delivery
- Force refresh with `?refresh=true`

---

## Comparison

| Method | Where Runs | Update Trigger | Best For | Power Usage |
|--------|-----------|----------------|----------|-------------|
| **watch-and-update.sh** | Local machine | Time-based (configurable) | Development/testing | N/A (dev machine) |
| **Local cron** | Local machine | Cron schedule | Persistent local updates | N/A (dev machine) |
| **Kindle cron** | Kindle device | Cron schedule | Production use | Low (sleep between) |
| **GitHub Actions** | GitHub cloud | Cron schedule | Cloud automation | N/A (cloud) |
| **Netlify + Kindle** | Cloud + Kindle | Kindle-initiated | Production (current) | Low (efficient) |

---

## Recommended Setups

### Development Workflow
```bash
# Terminal 1: Watch mode with auto-deploy
./watch-and-update.sh -i 300 -d -v

# Terminal 2: Monitor logs
tail -f logs/watch-update.log
```

### Production Setup (Current)
```
✅ Already configured!

1. Netlify Function generates dashboard on-demand
2. Kindle cron fetches every 15 minutes (7am-10pm)
3. 5-minute cache reduces API calls
4. Automatic sleep/wake for power efficiency
```

### Testing/Development
```bash
# Quick iterations (2-minute updates with preview)
./watch-and-update.sh -i 120 -t -v

# Stop with Ctrl+C when done
```

---

## Monitoring & Logs

### Local watch script logs
```bash
tail -f logs/watch-update.log
```

### Kindle dashboard logs
```bash
ssh root@kindle "tail -f /mnt/us/dashboard/logs/dashboard.log"
```

### Kindle cron logs
```bash
ssh root@kindle "cat /mnt/us/dashboard/logs/cron-setup.log"
```

### Check Kindle cron status
```bash
ssh root@kindle "crontab -l | grep dashboard"
```

---

## Troubleshooting

### watch-and-update.sh not running
```bash
# Make executable
chmod +x watch-and-update.sh

# Check syntax
sh -n watch-and-update.sh

# Run with verbose logging
./watch-and-update.sh -v
```

### Kindle not updating
```bash
# Check cron is running
ssh root@kindle "pgrep crond"

# View current schedule
ssh root@kindle "crontab -l"

# Test manual fetch
ssh root@kindle "/mnt/us/dashboard/fetch-dashboard-cloud.sh --force"
```

### High API usage (weather)
Weather API is cached for 30 minutes. Each dashboard generation uses cache when available.

**To check cache:**
```bash
ls -lh cache/weather_cache.json
cat cache/weather_cache.json | jq '.expires_at'
```

---

## Next Steps

### Add More Data Sources
1. Edit layout configuration in `server/layouts/*.json`
2. Add new components to `server/dashboard-engine.js`
3. Restart watch script to see updates

### Customize Update Schedule
```bash
# Local: Adjust interval
./watch-and-update.sh -i 600  # 10 minutes

# Kindle: Edit config
ssh root@kindle "vi /mnt/us/dashboard/config/cloud-config.conf"
```

### Battery Optimization
Current setup already optimized:
- 15-minute intervals during active hours (7am-10pm)
- Sleep prevention only during updates
- Framework stopped in dashboard mode
- No updates during night (10pm-7am)

**To extend battery further:**
```bash
# Increase interval to 30 minutes
ssh root@kindle "vi /mnt/us/dashboard/config/cloud-config.conf"
# Change: UPDATE_SCHEDULE="*/30 7-22 * * *"
```
