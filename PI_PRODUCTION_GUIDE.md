# Kindle Dashboard - Raspberry Pi Production Guide

**Status**: ✅ Production - Fully Operational
**Deployment Date**: November 1, 2025

## System Overview

- **Pi Server**: 192.168.50.163:3000
- **Kindle Device**: 192.168.50.104
- **Update Frequency**: Every 15 minutes, 7am-10pm Central (dashboard-loop.sh)
- **Service**: `kindle-dashboard.service` (systemd)

---

## Quick Commands

### Pi Server Management

```bash
# SSH to Pi
ssh pi@192.168.50.163

# Check service status
sudo systemctl status kindle-dashboard

# Restart service
sudo systemctl restart kindle-dashboard

# View live logs
sudo journalctl -u kindle-dashboard -f

# View recent logs (last 50 lines)
sudo journalctl -u kindle-dashboard -n 50

# Test health endpoint
curl http://localhost:3000/health

# Check server resources
htop  # Press F4, type "node" to filter
```

### Kindle Dashboard Control

```bash
# SSH to Kindle
ssh root@192.168.50.104

# Enter dashboard mode (stops framework, enables sleep prevention)
/mnt/us/dashboard/start.sh

# Exit dashboard mode (restarts framework, disables sleep prevention)
/mnt/us/dashboard/stop.sh

# Manual dashboard update
/mnt/us/dashboard/fetch-dashboard.sh --verbose

# Check loop logs (the persistent updater)
tail -f /mnt/us/dashboard/logs/dashboard-loop.log

# Check fetch logs
tail -f /mnt/us/dashboard/logs/fetch.log

# Check the loop is running
cat /mnt/us/dashboard/dashboard-loop.pid && ps | grep dashboard-loop | grep -v grep

# Check sleep prevention status (should be 1 when dashboard is active)
/usr/bin/lipc-get-prop com.lab126.powerd preventScreenSaver
```

---

## Troubleshooting

### Issue: Dashboard not updating on Kindle

**Diagnosis:**
```bash
# On Kindle - Check the loop is alive
ps | grep dashboard-loop | grep -v grep
cat /mnt/us/dashboard/dashboard-loop.pid

# Check recent loop logs for errors
tail -50 /mnt/us/dashboard/logs/dashboard-loop.log

# Outside active hours (7am-10pm CT by default)? The loop skips fetches
# on purpose - check ACTIVE_HOURS_* in config/dashboard.conf.
```

**Solution:**
```bash
# Restart dashboard mode (kills stale loop, stops framework, relaunches)
sh /mnt/us/dashboard/stop.sh
sh /mnt/us/dashboard/start.sh

# Or reboot - the upstart job /etc/upstart/dashboard.conf relaunches on boot
```

### Issue: Kindle goes to sleep

**Diagnosis:**
```bash
# Check sleep prevention status
/usr/bin/lipc-get-prop com.lab126.powerd preventScreenSaver
# Should return: 1

# Check if framework is stopped
ps aux | grep framework | grep -v grep
# Should return: nothing (framework stopped)
```

**Solution:**
```bash
# Re-enable sleep prevention
/usr/bin/lipc-set-prop com.lab126.powerd preventScreenSaver 1

# Stop framework
/sbin/stop framework

# Verify
/usr/bin/lipc-get-prop com.lab126.powerd preventScreenSaver
```

### Issue: Pi server not responding

**Diagnosis:**
```bash
# From Mac - Test connectivity
ping -c 3 192.168.50.163
curl http://192.168.50.163:3000/health

# On Pi - Check service status
ssh pi@192.168.50.163
sudo systemctl status kindle-dashboard
```

**Solution:**
```bash
# Restart service
sudo systemctl restart kindle-dashboard

# Check logs for errors
sudo journalctl -u kindle-dashboard -n 100

# If service won't start, check dependencies
cd ~/e_ink_screen/server
npm list canvas
~/e_ink_screen/venv/bin/python3 -c "from PIL import Image; print('Pillow OK')"
```

### Issue: Weather data is stale

**Solution:**
```bash
# On Pi - Clear weather cache
ssh pi@192.168.50.163
rm -f ~/e_ink_screen/server/cache/weather_cache.json

# Force fresh weather fetch
curl "http://localhost:3000/dashboard?refresh=true" -o /tmp/test.png
```

---

## Maintenance Tasks

### Update Dashboard Code

```bash
# From Mac - Deploy updated code to Pi
cd /path/to/e_ink_screen

./deploy-to-pi.sh   # rsync + npm install + systemd restart
```

Production deploys are manual rsync via `deploy-to-pi.sh`, not a git checkout on
the Pi. `pi/setup-auto-deploy.sh` exists to set up a `kindle-dashboard-updater.timer`
that git-pulls and restarts automatically, but it has never been run on this Pi —
treat any mention of that timer elsewhere as aspirational, not live, until it is.

### Update Kindle Scripts

```bash
# From Mac - Deploy updated scripts
cd /path/to/e_ink_screen

export KINDLE_PASSWORD='...'
./deploy-kindle.sh --restart   # ships the full live script set
```

### Monitor System Health (24-hour check)

```bash
# On Pi - Check service uptime and stability
sudo systemctl status kindle-dashboard

# Check for service restarts (should be 0)
sudo journalctl -u kindle-dashboard --since "24 hours ago" | grep -i restart

# Check error count
sudo journalctl -u kindle-dashboard --since "24 hours ago" | grep -i error | wc -l

# On Kindle - Check successful updates
ssh root@192.168.50.104
grep "Update successful" /mnt/us/dashboard/logs/dashboard-loop.log | tail -20

# Check error count
grep -i error /mnt/us/dashboard/logs/dashboard-loop.log | tail -20
```

---

## System Architecture

```
┌─────────────────────────┐
│   Raspberry Pi Server   │
│   192.168.50.163:3000   │
│                         │
│  ┌──────────────────┐   │
│  │  Node.js Server  │   │
│  │  (systemd)       │   │
│  └────────┬─────────┘   │
│           │             │
│  ┌────────▼─────────┐   │
│  │ Dashboard Engine │   │
│  │ (Canvas + PIL)   │   │
│  └────────┬─────────┘   │
│           │             │
│  ┌────────▼─────────┐   │
│  │ Weather Service  │   │
│  │ (30min cache)    │   │
│  └──────────────────┘   │
└─────────┬───────────────┘
          │ HTTP (26KB PNG)
          │ Every 15 minutes
          │
┌─────────▼───────────────┐
│   Kindle Touch Device   │
│   192.168.50.104        │
│                         │
│  ┌──────────────────┐   │
│  │   Cron (*/5)     │   │
│  └────────┬─────────┘   │
│           │             │
│  ┌────────▼─────────┐   │
│  │ fetch-dashboard  │   │
│  │ (wget → eips)    │   │
│  └────────┬─────────┘   │
│           │             │
│  ┌────────▼─────────┐   │
│  │  E-ink Display   │   │
│  │  (800x600)       │   │
│  └──────────────────┘   │
└─────────────────────────┘
```

---

## Configuration Files

### Pi Server Config
- **Env file**: `~/dashboard-server/.env` (loaded by systemd EnvironmentFile — verified 2026-08-07)
- **Systemd**: `/etc/systemd/system/kindle-dashboard.service`
- **Server Code**: `~/dashboard-server/server/` (plain rsynced files, not a git checkout)
- **Python Venv**: `~/dashboard-server/venv/`
- **TRMNL keys** (optional, off by default): `TRMNL_MODE`, `TRMNL_BASE_URL`,
  `TRMNL_DEVICE_MAC`, `TRMNL_API_KEY`, `TRMNL_CACHE_TTL_MS`, `TRMNL_ROTATION`,
  `TRMNL_SLOT_MINUTES` — see `TRMNL_SETUP.md` for the full setup runbook.

### Kindle Config
- **Main Config**: `/mnt/us/dashboard/config/dashboard.conf`
- **Boot job**: `/etc/upstart/dashboard.conf` (execs on-boot.sh)
- **Scripts**: `/mnt/us/dashboard/*.sh`
- **Logs**: `/mnt/us/dashboard/logs/`

---

## Performance Metrics

### Expected Values
- **Pi CPU Usage**: <5% idle, <30% during generation
- **Pi Memory**: ~80-150MB
- **Dashboard Generation**: <2 seconds
- **Image Size**: ~26KB (optimized PNG)
- **Network Latency**: <100ms (local network)
- **Kindle Update Time**: ~5 seconds total

### Monitoring Commands
```bash
# On Pi - Check generation time
sudo journalctl -u kindle-dashboard -n 100 | grep "Served dashboard"

# On Pi - Check resource usage
top -b -n 1 | grep node

# From Mac - Test response time
time curl -o /dev/null http://192.168.50.163:3000/dashboard
```

---

## Backup and Recovery

### Backup Important Files

```bash
# From Mac - Backup Pi configuration
ssh pi@192.168.50.163 "tar czf ~/dashboard-backup-$(date +%Y%m%d).tar.gz ~/dashboard-server/.env ~/dashboard-server/cache"
scp pi@192.168.50.163:~/dashboard-backup-*.tar.gz ~/backups/

# Backup Kindle configuration
ssh root@192.168.50.104 "tar czf /tmp/kindle-dashboard-backup.tar.gz /mnt/us/dashboard"
scp root@192.168.50.104:/tmp/kindle-dashboard-backup.tar.gz ~/backups/
```

### Restore from Backup

```bash
# Restore Pi server
scp ~/backups/dashboard-backup-*.tar.gz pi@192.168.50.163:~/
ssh pi@192.168.50.163
tar xzf dashboard-backup-*.tar.gz
sudo systemctl restart kindle-dashboard

# Restore Kindle files
scp ~/backups/kindle-dashboard-backup.tar.gz root@192.168.50.104:/tmp/
ssh root@192.168.50.104
cd /
tar xzf /tmp/kindle-dashboard-backup.tar.gz
```

---

## Next Steps / Future Enhancements

- [ ] Add battery level monitoring to dashboard display
- [ ] Implement calendar integration (Google Calendar)
- [ ] Add RSS news feed widget
- [ ] Create weather alerts/notifications
- [ ] Implement dashboard themes/layouts selector
- [ ] Add task list integration (Todoist, etc.)

---

**Last Updated**: November 1, 2025
**Maintained By**: Project Owner
**Support**: See CLAUDE.md for detailed technical documentation
