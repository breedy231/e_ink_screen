# Kindle Dashboard - Raspberry Pi Production Guide

**Status**: ✅ Production - Fully Operational
**Deployment Date**: November 1, 2025

## System Overview

- **Pi Server**: 192.168.50.163:3000
- **Kindle Device**: 192.168.50.104
- **Update Frequency**: Every 5 minutes (24/7)
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

# Check auto-update logs
tail -f /mnt/us/dashboard/logs/auto-update.log

# Check fetch logs
tail -f /mnt/us/dashboard/logs/fetch.log

# View current cron schedule
crontab -l

# Check sleep prevention status (should be 1 when dashboard is active)
/usr/bin/lipc-get-prop com.lab126.powerd preventScreenSaver
```

---

## Troubleshooting

### Issue: Dashboard not updating on Kindle

**Diagnosis:**
```bash
# On Kindle - Check if cron is running
ps aux | grep crond | grep -v grep

# Check if cron entry exists
crontab -l | grep fetch-dashboard

# Check recent auto-update logs for errors
tail -50 /mnt/us/dashboard/logs/auto-update.log
```

**Solution:**
```bash
# Restart crond
killall crond
sleep 5
ps aux | grep crond

# Re-add cron entry if missing
cat >> /etc/crontab/root << 'EOF'
*/5 * * * * /mnt/us/dashboard/fetch-dashboard.sh --config /mnt/us/dashboard/config/dashboard.conf >> /mnt/us/dashboard/logs/auto-update.log 2>&1
EOF
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
cd ~/dashboard-server/server
npm list canvas
~/dashboard-server/venv/bin/python3 -c "from PIL import Image; print('Pillow OK')"
```

### Issue: Weather data is stale

**Solution:**
```bash
# On Pi - Clear weather cache
ssh pi@192.168.50.163
rm -f ~/dashboard-server/server/cache/weather_cache.json

# Force fresh weather fetch
curl "http://localhost:3000/dashboard?refresh=true" -o /tmp/test.png
```

---

## Maintenance Tasks

### Update Dashboard Code

```bash
# From Mac - Deploy updated code to Pi
cd /Users/brendanreed/repos/e_ink_screen

rsync -av \
  --exclude 'node_modules' \
  --exclude 'test_env' \
  --exclude '*.log' \
  --exclude 'temp' \
  --exclude 'cache' \
  server/ \
  pi@192.168.50.163:~/dashboard-server/server/

# On Pi - Restart service
ssh pi@192.168.50.163
cd ~/dashboard-server/server
npm install  # Only if dependencies changed
sudo systemctl restart kindle-dashboard
```

### Update Kindle Scripts

```bash
# From Mac - Deploy updated scripts
cd /Users/brendanreed/repos/e_ink_screen

scp kindle/start.sh root@192.168.50.104:/mnt/us/dashboard/
scp kindle/stop.sh root@192.168.50.104:/mnt/us/dashboard/
scp kindle/fetch-dashboard.sh root@192.168.50.104:/mnt/us/dashboard/

# On Kindle - Set permissions
ssh root@192.168.50.104
chmod +x /mnt/us/dashboard/*.sh
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
grep "completed successfully" /mnt/us/dashboard/logs/auto-update.log | tail -20

# Check error count
grep ERROR /mnt/us/dashboard/logs/auto-update.log | tail -20
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
          │ Every 5 minutes
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
- **Location**: `~/dashboard-server/config.json`
- **Systemd**: `/etc/systemd/system/kindle-dashboard.service`
- **Server Code**: `~/dashboard-server/server/`
- **Python Venv**: `~/dashboard-server/venv/`

### Kindle Config
- **Main Config**: `/mnt/us/dashboard/config/dashboard.conf`
- **Cron File**: `/etc/crontab/root`
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
ssh pi@192.168.50.163 "tar czf ~/dashboard-backup-$(date +%Y%m%d).tar.gz ~/dashboard-server"
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
- [ ] Optimize cron schedule to active hours only (7am-10pm)
- [ ] Add Netlify cloud fallback for Pi downtime
- [ ] Implement dashboard themes/layouts selector
- [ ] Add task list integration (Todoist, etc.)

---

**Last Updated**: November 1, 2025
**Maintained By**: Project Owner
**Support**: See CLAUDE.md for detailed technical documentation
