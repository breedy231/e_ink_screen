# Kindle E-ink Dashboard

A low-power e-ink dashboard for jailbroken Kindle Touch (4th Generation) displaying time, weather, device stats, and more.

## Dashboard Features

- **Real-time Weather**: Current conditions, 3-day forecast, temperature in Fahrenheit
- **Device Statistics**: Battery level, temperature, WiFi status, memory usage, uptime
- **Multiple Layouts**: Weather-focused, compact, minimal, and device-centric views
- **Cloud Integration**: Serverless generation via Netlify Functions
- **KUAL Menu**: Easy dashboard control through Kindle's KUAL interface
- **Power Efficient**: Sleep/wake cycles optimized for battery life

## Quick Start

### Local Testing
```bash
# Generate weather dashboard locally
node generate-flexible-dashboard.js weather --test

# Deploy to Kindle and test
./generate-and-test.sh --deploy

# Generate specific layouts
node generate-flexible-dashboard.js compact
node generate-flexible-dashboard.js minimal
node generate-flexible-dashboard.js device
```

### Cloud Deployment
```bash
# Deploy to Netlify
netlify deploy --prod

# Configure Kindle for cloud updates
scp kindle/config/cloud-config.conf root@kindle:/mnt/us/dashboard/config/
scp kindle/fetch-dashboard-cloud.sh root@kindle:/mnt/us/dashboard/
ssh root@kindle "/mnt/us/dashboard/setup-cloud-cron.sh"
```

### KUAL Integration
```bash
# Deploy KUAL extension for dashboard control
./deploy-kual.sh
```

## Hardware Requirements

- Jailbroken Kindle Touch (4th Generation)
- KUAL installed for menu integration
- SSH access configured
- WiFi connectivity

## Dashboard Layouts

- **weather**: Weather-focused with 3-day forecast
- **compact**: Dense layout with all information
- **minimal**: Clean, simple time/date display
- **device**: Device statistics and system monitoring

## Testing & Deployment

### Pre-Deployment Testing (Required)
**Always run tests before deploying changes to Kindle:**

```bash
# Run comprehensive validation suite
./pre-deployment-validation.sh
```

All tests must pass (✓ ALL VALIDATIONS PASSED) before deployment.

### Individual Test Scripts
```bash
# Test cron schedule logic and timezone coverage
./test-schedule-logic.sh

# Test WiFi keep-alive implementation
./test-wifi-commands.sh

# Test shell script syntax (POSIX compatibility)
sh -n kindle/*.sh
```

### Deployment
```bash
# Deploy e-ink schedule fix to Kindle
./fix-eink-schedule.sh
```

**Why Testing Matters**: The automated test suite has already caught and prevented production bugs (e.g., timezone coverage issue that would have caused updates to fail during CST). Always run tests before deploying!

For detailed testing documentation, see the "Automated Testing Suite" section in `CLAUDE.md`.

## Technical Details

- **Display**: 800x600px grayscale PNG optimized for e-ink
- **Updates**: 5-minute intervals during active hours (7am-10pm Central Time)
- **WiFi**: Keeps alive during dashboard mode for reliable updates when unplugged
- **Weather**: Open-Meteo API with 30-minute caching
- **Time Zone**: Central Time (America/Chicago)
- **Authentication**: Token-based security for cloud endpoint

## File Structure

```
├── server/                 # Dashboard generation engine
├── kindle/                 # Kindle-side scripts
├── KUAL/                   # KUAL menu extension
├── netlify/functions/      # Cloud deployment
└── cache/                  # Weather and data caching
```

For detailed setup and development instructions, see `CLAUDE.md`.