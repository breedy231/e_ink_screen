# Kindle Dashboard Project

## Project Overview
**Goal**: Create a low-power e-ink dashboard for Kindle Touch (4th Generation) displaying time, date, device stats, weather, tasks, and news with configurable updates.

**Approach**: Server-side image generation + Kindle fetch/display pattern (following kindle-dash architecture)
- Generate dashboard images as grayscale PNGs server-side
- Kindle periodically fetches and displays images via HTTP
- Power-efficient sleep/wake cycles using RTC

## Hardware Specifications
- **Device**: Kindle Touch (4th Generation) - Jailbroken with KUAL and SSH
- **Display**: 6" diagonal E-ink, 600x800px (portrait) / 800x600px (landscape)
- **Technology**: 16-level grayscale, NO alpha channel support
- **Connectivity**: Wi-Fi 802.11b/g/n
- **Storage**: ~3GB available

## Key Technical Constraints

### E-ink Display Requirements
- **Images**: Grayscale PNG only, NO alpha channel
- **Resolution**: 800x600px (landscape preferred for dashboard layout)
- **Contrast**: High contrast required (pure black on white)
- **Avoid**: Gradients, animations, complex graphics
- **Refresh**: Full refresh occasionally to prevent ghosting

### Power Management
- Device sleeps between updates for battery efficiency
- Use RTC wake: `/sys/devices/platform/mxc_rtc.0/wakeup_enable`
- Disable framework during dashboard mode: `/etc/init.d/framework stop`

## Current Status: [KD-006] Flexible Dashboard Layout System ✅ COMPLETED

**Acceptance Criteria**: ✅ All Complete
- [x] Create a modular layout system for dashboard content areas
- [x] Grid-based layout with reusable components (clock, date, stats)
- [x] Configuration for component placement
- [x] Test different layouts
- [x] Optimize for e-ink readability

**Delivered Features**:
- **Modular Component System**: Clock, Date, Stats, Title components with configurable styling
- **Grid-Based Layout Engine**: Flexible positioning with configurable rows, columns, margins
- **4 Pre-built Layouts**: Default, Compact, Minimal, Split layouts optimized for different use cases
- **Configuration System**: JSON-based layout definitions for easy customization
- **Backward Compatibility**: V2 generator maintains compatibility with existing pipeline
- **E-ink Optimizations**: High contrast rendering, crisp fonts, optimized PNG output

**Usage**:
```bash
# Generate specific layouts
node generate-flexible-dashboard.js compact
node generate-flexible-dashboard.js minimal --test

# List and inspect layouts
node generate-flexible-dashboard.js --list
node generate-flexible-dashboard.js --info split

# Generate all layouts for comparison
node generate-flexible-dashboard.js --all --test
```

## Current Status: [KD-007] Device Statistics Module ✅ COMPLETED

**Acceptance Criteria**: ✅ All Complete
- [x] Integrate Kindle device statistics into dashboard
- [x] Read battery level (gasgauge-info -c)
- [x] Get WiFi status and network name
- [x] Display last update timestamp
- [x] Show device temperature if available
- [x] Format stats in dashboard-friendly way

**Delivered Features**:
- **Device Statistics Collection**: POSIX-compatible shell script for Kindle device stats
- **Live Data Integration**: SSH-based fetching of real-time device metrics
- **Battery Monitoring**: Level (78%) and voltage (4.1V) display
- **Temperature Monitoring**: Fahrenheit to Celsius conversion (26°C)
- **Network Status**: WiFi connection state and network name detection
- **System Metrics**: Memory usage (82%) and uptime tracking
- **DeviceStatsComponent**: New dashboard component for device monitoring
- **Device Layout**: Specialized layout optimized for device status display
- **Error Handling**: Graceful fallbacks when hardware info unavailable
- **Multiple Output Formats**: JSON, CSV, and human-readable formats

**Device Statistics Displayed**:
- Battery: 78% charge, 4.1V voltage
- Temperature: 26°C (auto-converted from Fahrenheit)
- Memory Usage: 82%
- WiFi Status: Connected to network name
- System Uptime: Hours since last reboot
- Dashboard Last Update: Timestamp of last refresh

**Usage**:
```bash
# Generate device dashboard with live stats
node generate-flexible-dashboard.js device

# Test device stats script on Kindle
ssh root@kindle "/mnt/us/dashboard/get-device-stats.sh --format human"

# Deploy complete dashboard with device stats
./generate-and-test.sh --deploy

# Generate with mock data for testing
node generate-flexible-dashboard.js device --mock
```

**Files Added/Modified**:
- `kindle/get-device-stats.sh` - Device statistics collection script
- `server/device-stats.js` - Device stats fetching module
- `server/dashboard-engine.js` - Added DeviceStatsComponent
- `server/layouts/device.json` - Device-focused layout configuration
- `generate-and-test.sh` - Updated to use device layout and deploy stats script

## Current Status: [KD-008] Weather API Integration ✅ COMPLETED

**Acceptance Criteria**: ✅ All Complete
- [x] Add weather information to dashboard using external API
- [x] Select and integrate weather API (Open-Meteo)
- [x] Design weather display component
- [x] Handle API errors gracefully
- [x] Cache weather data
- [x] Add weather icons optimized for e-ink

**Delivered Features**:
- **Open-Meteo API Integration**: No API key required, free for non-commercial use
- **Real-time Weather Data**: Current conditions and 3-day forecast
- **Temperature Display**: Fahrenheit format (74°F) for US users
- **12-Hour Clock Format**: AM/PM display instead of military time
- **Weather Caching**: 30-minute cache with graceful expiration handling
- **Error Handling**: Multi-level fallback (API → Cache → Mock data)
- **Weather Symbols**: Text-based icons optimized for e-ink (☀ ⛅ ☁ 🌧 ❄ ⛈)
- **WeatherComponent**: Dashboard component for comprehensive weather display
- **Weather Layout**: Specialized layout focused on weather information
- **Central Time Zone**: America/Chicago timezone for weather and clock

**Weather Data Displayed**:
- Current Temperature: 74°F (Fahrenheit format)
- Weather Condition: "Overcast" with weather symbols
- Wind Speed: 8 km/h
- Humidity: 65%
- 3-Day Forecast: Daily high/low temperatures (76°/65°F)
- Weather Icons: ⛅ Visual weather representation
- Data Source: API/cache/mock indicator
- Last Update: Timestamp of weather data retrieval

**Usage**:
```bash
# Generate weather dashboard with live data
node generate-flexible-dashboard.js weather

# Generate with mock data for testing
node generate-flexible-dashboard.js weather --mock

# Deploy complete weather dashboard
./generate-and-test.sh --deploy

# Test weather service directly
node -e "const w = require('./weather-service.js'); new w().getFormattedWeather().then(console.log);"

# Clear weather cache for fresh data
rm -f cache/weather_cache.json
```

**Configuration Options**:
- **Temperature Unit**: Fahrenheit (configurable via API parameter)
- **Location**: Default Chicago (41.8781, -87.6298) - customizable
- **Timezone**: America/Chicago (Central Time)
- **Cache Duration**: 30 minutes
- **Forecast Days**: 3 days
- **Clock Format**: 12-hour (h:mm a) with AM/PM

**Files Added/Modified**:
- `server/weather-service.js` - Weather API integration module
- `server/dashboard-engine.js` - Added WeatherComponent with symbols
- `server/layouts/weather.json` - Weather-focused dashboard layout
- `server/generate-flexible-dashboard.js` - Weather data integration
- `generate-and-test.sh` - Updated to use weather layout by default

## Current Status: [KD-009] KUAL Integration Menu ✅ COMPLETED

**Acceptance Criteria**: ✅ All Complete
- [x] Add KUAL menu items for dashboard control
- [x] Create KUAL extension structure
- [x] Add Start Dashboard menu item
- [x] Add Stop Dashboard menu item
- [x] Add Update Now option
- [x] Test all menu functions

**Delivered Features**:
- **KUAL Extension Structure**: Complete extension with config.xml and menu.json
- **Dashboard Control Menu**: 5 menu items for full dashboard management
- **Start/Stop Controls**: Launch and terminate dashboard service
- **Update Now**: Force immediate dashboard refresh
- **Status Display**: Show running status, battery, WiFi, last update time
- **Log Viewer**: Display recent dashboard logs for troubleshooting
- **Automated Deployment**: Script with proper SSH authentication
- **E-ink Optimized Output**: Status and logs displayed on Kindle screen

**KUAL Menu Items**:
1. **Start Dashboard** - Launches dashboard service (`/mnt/us/dashboard/start.sh`)
2. **Stop Dashboard** - Stops dashboard service (`/mnt/us/dashboard/stop.sh`)
3. **Update Now** - Forces dashboard refresh (`/mnt/us/dashboard/fetch-dashboard.sh`)
4. **Dashboard Status** - Shows system status with battery/WiFi info
5. **Show Logs** - Displays recent log entries on e-ink screen

**Usage**:
```bash
# Deploy KUAL extension to Kindle
./deploy-kual.sh

# Manual verification on Kindle
ssh root@kindle "ls -la /mnt/us/extensions/kindle-dash/"

# Test menu functions
# 1. Look for "Kindle Dashboard" in KUAL menu
# 2. Test each menu item
# 3. Verify dashboard control functions work
```

**Files Added/Modified**:
- `KUAL/kindle-dash/config.xml` - KUAL extension configuration
- `KUAL/kindle-dash/menu.json` - Menu structure with dashboard controls
- `kindle/status.sh` - Dashboard status checker with device info
- `kindle/show-logs.sh` - Log viewer optimized for e-ink display
- `deploy-kual.sh` - Automated KUAL extension deployment

**Installation Notes**:
- Extension installed to `/mnt/us/extensions/kindle-dash/`
- Uses same authentication method as existing deployment scripts
- Proper permissions set automatically (755 for directories, 644 for files)
- Works with existing dashboard scripts and logging system

## Current Status: [KD-010] Netlify/Cloud Deployment ✅ COMPLETED

**Acceptance Criteria**: ✅ All Complete
- [x] Prepare dashboard generation for cloud deployment
- [x] Convert to Netlify Function or API route
- [x] Implement proper caching strategy
- [x] Add authentication/security
- [x] Test remote access from Kindle
- [x] Document deployment process

**Delivered Features**:
- **Serverless Dashboard Generation**: Netlify Function for cloud-based image generation
- **Token-Based Authentication**: Secure API access with environment variable configuration
- **Multi-Level Caching**: 5-minute in-memory cache + CDN edge caching
- **Automated Kindle Integration**: Cron-based scheduling for regular updates
- **Location Customization**: Per-request weather location override
- **Layout Support**: All existing layouts (weather, compact, minimal, device)
- **Error Handling**: Graceful fallbacks and comprehensive logging
- **CORS Support**: Cross-origin requests for web integration

**Cloud Architecture**:
- **Netlify Functions**: Serverless dashboard generation endpoint
- **Canvas Rendering**: Server-side PNG generation optimized for e-ink
- **Weather API Integration**: Real-time weather data via Open-Meteo
- **Automatic Deployment**: Git-based deployment with zero-downtime updates
- **Global CDN**: Fast worldwide access with edge caching
- **Environment Security**: Token-based auth with secure environment variables

**Kindle Automation**:
- **Cloud Fetch Script**: POSIX-compatible fetching from cloud endpoint
- **Automatic Scheduling**: Cron-based updates every 15 minutes (7am-10pm)
- **Network Resilience**: Retry logic with timeout handling
- **Configuration Management**: File-based settings with override support
- **Comprehensive Logging**: Detailed operation logs for troubleshooting

**API Endpoint**: `GET /dashboard?token=TOKEN&layout=weather`

**Parameters**:
- `token` (required) - Authentication token
- `layout` (optional) - Dashboard layout (weather, compact, minimal, device)
- `refresh` (optional) - Force cache refresh (true/false)
- `lat`/`lon` (optional) - Custom weather location
- `tz` (optional) - Timezone override

**Usage**:
```bash
# Deploy to Netlify
netlify login
netlify deploy --prod

# Configure Kindle
scp kindle/config/cloud-config.conf root@kindle:/mnt/us/dashboard/config/
scp kindle/fetch-dashboard-cloud.sh root@kindle:/mnt/us/dashboard/
ssh root@kindle "/mnt/us/dashboard/setup-cloud-cron.sh"

# Test cloud endpoint
curl "https://your-site.netlify.app/dashboard?token=your-token&layout=weather"
```

**Files Added/Modified**:
- `netlify.toml` - Netlify deployment configuration
- `netlify/functions/dashboard.js` - Main serverless function
- `package.json` - Cloud deployment dependencies
- `public/index.html` - Service documentation page
- `kindle/fetch-dashboard-cloud.sh` - Cloud-based fetch script
- `kindle/setup-cloud-cron.sh` - Automated scheduling setup
- `kindle/config/cloud-config.conf` - Cloud endpoint configuration
- `DEPLOYMENT.md` - Comprehensive deployment guide

**Deployment Benefits**:
- **Zero Server Maintenance**: Serverless architecture
- **Global Availability**: 99.9% uptime via Netlify CDN
- **Cost Effective**: Free tier supports ~3,000 requests/month
- **Automatic Scaling**: Handles traffic spikes seamlessly
- **Git Integration**: Deploy via git push
- **HTTPS by Default**: Secure API endpoint
- **Real-time Monitoring**: Built-in Netlify analytics

**Next Priority**: [KD-012] Local Auto-Update System

## Current Status: [KD-012] Local Auto-Update System ✅ COMPLETED

**Acceptance Criteria**: ✅ All Complete
- [x] Implement Kindle-side cron for automatic dashboard updates
- [x] Configure local server for network-wide access
- [x] Create setup scripts for easy deployment
- [x] Support configurable update intervals
- [x] Test 5-minute update cycles

**Delivered Features**:
- **Kindle-Side Cron Scheduler**: Automated dashboard fetching via cron every 5 minutes (7am-10pm)
- **Local Server Helper**: Easy-to-use script for starting local development server
- **Network Auto-Detection**: Automatically configures correct Mac IP address
- **Flexible Scheduling**: Support for any cron schedule (5min, 10min, hourly, custom, active hours)
- **Configuration Management**: Auto-updates dashboard.conf with local server settings
- **Comprehensive Logging**: Separate logs for cron setup and auto-updates
- **Zero-Downtime Updates**: Server can be restarted without affecting Kindle cron
- **Battery-Conscious**: Default schedule limits updates to active hours (7am-10pm)

**Usage**:
```bash
# On Mac: Start local server (one-time per session)
./start-local-server.sh

# On Kindle: Setup auto-updates (one-time setup)
ssh root@192.168.50.104
/mnt/us/dashboard/setup-local-cron.sh

# Monitor auto-updates on Kindle
tail -f /mnt/us/dashboard/logs/auto-update.log

# Stop auto-updates
ssh root@192.168.50.104
crontab -l | grep -v fetch-dashboard | crontab -

# Custom update interval (10 minutes instead of 5)
/mnt/us/dashboard/setup-local-cron.sh -i "*/10 * * * *"
```

**Network Configuration**:
- **Mac IP**: 192.168.50.200 (auto-detected)
- **Kindle IP**: 192.168.50.104
- **Server Port**: 3000
- **Update Interval**: Every 5 minutes, 7am-10pm Central Time (default)
- **Timezone**: Central Time (CDT/CST) - uses dual cron entries for UTC conversion

**Files Added**:
- `start-local-server.sh` - Helper script to start local server with proper config
- `kindle/setup-local-cron.sh` - Cron setup script for Kindle-side automation
- `server/local-dashboard-server.js` - New server using DashboardEngine + e-ink optimization
- `LOCAL_AUTO_UPDATE_GUIDE.md` - Complete setup and usage guide
- `LOCAL_AUTO_UPDATE_TROUBLESHOOTING.md` - Debugging guide with solutions
- Auto-updates `kindle/config/dashboard.conf` with local server IP

**Critical Technical Details**:
1. **Busybox Compatibility**: Kindle's wget requires short options (`-q -O`) not long (`--quiet --output-document`)
2. **E-ink Optimization Required**: Server must run `optimize-for-eink.py` to apply autocontrast enhancement
3. **Virtual Environment Python**: Optimization script needs Pillow from `test_env/bin/python3`
4. **Pipeline Parity**: Local server matches `generate-and-test.sh` workflow exactly (DashboardEngine → PNG → Python optimization)

**How It Works**:
1. **Mac**: Runs HTTP server on 192.168.50.200:3000
2. **Server**: Generates fresh dashboards with 1-minute cache
3. **Kindle**: Cron job executes every 5 minutes
4. **Fetch**: Kindle downloads latest dashboard via HTTP
5. **Display**: Dashboard updates on e-ink screen with full refresh

**Advantages Over Cloud**:
- 🚀 **Faster**: No internet latency, local network only
- 💰 **Zero Cost**: No cloud service fees
- 🔧 **Live Development**: Instant testing of layout changes
- 🔒 **Privacy**: All data stays on local network
- 📊 **Real Device Stats**: Can include live Kindle statistics

**Next Priority**: [KD-013] Calendar Integration or Cloud Auto-Update (15min → 5min)

## Current Status: [KD-011] Sleep Prevention Implementation ✅ COMPLETED

**Acceptance Criteria**: ✅ All Complete
- [x] Investigate Kindle sleep timeout behavior (5-minute default)
- [x] Research Kindle jailbreak sleep prevention methods
- [x] Implement sleep prevention in dashboard scripts
- [x] Fix shell compatibility issues for Kindle's basic shell
- [x] Test sleep prevention on actual Kindle device

**Delivered Features**:
- **Sleep Prevention**: Dashboard stays visible indefinitely using `lipc-set-prop com.lab126.powerd preventScreenSaver 1`
- **Automatic Sleep Restoration**: Normal sleep behavior restored when dashboard mode exits
- **Shell Compatibility Fixes**: Fixed bash-specific syntax for Kindle's ash/dash shell
- **Integration Points**: Sleep prevention integrated into start.sh, stop.sh, and fetch-dashboard.sh
- **Proper Execution Order**: Sleep prevention occurs after framework stop for reliability

**Implementation Details**:
- **Start Dashboard**: Disables screensaver after stopping framework
- **Stop Dashboard**: Re-enables screensaver before starting framework
- **During Updates**: Temporarily prevents sleep during fetch/display operations
- **Error Handling**: Graceful fallbacks when lipc-set-prop not available

**Key Commands**:
```bash
# Disable screensaver (prevent sleep)
lipc-set-prop com.lab126.powerd preventScreenSaver 1

# Enable screensaver (restore normal sleep)
lipc-set-prop com.lab126.powerd preventScreenSaver 0
```

**Critical Bugfix Resolved**:
- **Issue**: `((attempt++))` syntax error on Kindle's basic shell
- **Solution**: Changed to `attempt=$((attempt + 1))` for POSIX compatibility
- **Root Cause**: Kindle uses ash/dash shell, not bash - no support for C-style increment operators

**Files Modified**:
- `kindle/start.sh` - Added `prevent_screen_sleep()` function
- `kindle/stop.sh` - Added `restore_screen_sleep()` function
- `kindle/fetch-dashboard.sh` - Added sleep prevention during updates, fixed arithmetic syntax
- `CLAUDE.md` - Enhanced shell compatibility documentation

**Testing Results**:
- ✅ Dashboard remains visible indefinitely (no 5-minute timeout)
- ✅ Sleep behavior properly restored when dashboard mode exits
- ✅ No shell syntax errors on Kindle device
- ✅ Compatible with Kindle Touch 4th Generation jailbreak environment

## Current Status: [KD-013] Raspberry Pi Production Deployment ✅ COMPLETED

**Acceptance Criteria**: ✅ All Complete
- [x] Deploy dashboard server to Raspberry Pi
- [x] Configure systemd service for auto-start
- [x] Update Kindle to fetch from Pi server
- [x] Set up automatic cron-based updates
- [x] Fix sleep prevention for persistent display
- [x] Test service survives reboot

**Delivered Features**:
- **Production Server**: Raspberry Pi running at 192.168.50.163:3000
- **Systemd Service**: `kindle-dashboard.service` with auto-start on boot
- **24/7 Auto-Updates**: Cron job updating every 5 minutes
- **Sleep Prevention**: Fixed lipc-set-prop path for Kindle Touch compatibility
- **Framework Control**: Upstart-compatible start/stop scripts
- **E-ink Optimization**: Server-side PNG optimization (26KB optimized images)
- **Reboot Resilience**: Service survives Pi reboot and auto-starts

**Production Configuration**:
- **Pi Server IP**: 192.168.50.163:3000
- **Kindle IP**: 192.168.50.104
- **Update Interval**: Every 5 minutes (24/7)
- **Cache Duration**: 60 seconds server-side, 30 minutes weather cache
- **Layout**: Weather dashboard with current conditions and 3-day forecast
- **Timezone**: America/Chicago (Central Time)

**System Architecture**:
```
┌─────────────────┐         HTTP GET          ┌──────────────────┐
│  Kindle Touch   │ ───────────────────────> │  Raspberry Pi    │
│  192.168.50.104 │  /dashboard (26KB PNG)   │  192.168.50.163  │
│                 │ <─────────────────────── │                  │
│  - Cron: */5    │                          │  - Node.js       │
│  - eips display │                          │  - Canvas + PIL  │
│  - Sleep: OFF   │                          │  - systemd       │
└─────────────────┘                          └──────────────────┘
```

**Service Management**:
```bash
# Pi server control
ssh pi@192.168.50.163
sudo systemctl status kindle-dashboard    # Check status
sudo systemctl restart kindle-dashboard   # Restart service
sudo journalctl -u kindle-dashboard -f    # View logs

# Kindle dashboard control
ssh root@192.168.50.104
/mnt/us/dashboard/start.sh                # Enter dashboard mode
/mnt/us/dashboard/stop.sh                 # Exit dashboard mode
/mnt/us/dashboard/fetch-dashboard.sh      # Manual update
```

**Critical Fixes Applied**:
1. **Config Format**: Changed from `SERVER_URL` to `SERVER_HOST`/`SERVER_PORT` format
2. **Cron Location**: Dashboard cron added to `/etc/crontab/root` (where crond actually reads)
3. **lipc-set-prop Path**: Use `/usr/bin/lipc-set-prop` instead of `command -v` check
4. **Framework Control**: Use `/sbin/stop framework` (upstart) instead of `/etc/init.d/framework`
5. **Sleep Prevention**: Enable `preventScreenSaver 1` after framework stop

**Files Modified**:
- `PI_DEPLOYMENT_PLAN.md` - Corrected config format and added cron setup step
- `kindle/config/dashboard.conf` - Updated default IP to 192.168.50.163
- `kindle/start.sh` - Fixed lipc-set-prop and framework paths
- `kindle/stop.sh` - Fixed lipc-set-prop and framework paths

**Deployment Date**: November 1, 2025
**Status**: ✅ Production - Fully Operational

## Current Status: [KD-014] E-ink Update Schedule Fix & Testing Suite ✅ COMPLETED

**Acceptance Criteria**: ✅ All Complete
- [x] Identify and fix 24/7 update schedule issue
- [x] Resolve WiFi disconnection when unplugged
- [x] Implement automated testing suite
- [x] Validate all changes before deployment
- [x] Document testing procedures

**Problem Identified**:
1. **24/7 Updates Draining Battery**: Dashboard updating every 5 minutes around the clock (288 updates/day)
2. **Updates Stop When Unplugged**: WiFi enters power-saving mode, disconnecting network and blocking cron jobs

**Solutions Delivered**:

### 1. Limited Update Schedule (7am-10pm Central Time)
- **Cron Entry 1**: `*/5 12-23 * * *` (12:00-23:59 UTC)
- **Cron Entry 2**: `*/5 0-4 * * *` (00:00-04:59 UTC)
- **Coverage**: Properly handles both CDT (UTC-5) and CST (UTC-6)
- **Daily Updates**: 204 (down from 288 = **29% reduction**)
- **Battery Impact**: Significant reduction in processing/network activity

### 2. WiFi Keep-Alive Implementation
- **Added**: `keep_wifi_alive()` function in `start.sh`
- **Uses**: `lipc-set-prop com.lab126.powerd keepAliveWirelessRadio 1`
- **Backup**: Driver-level power management disable via `iwconfig`
- **Restoration**: `restore_wifi_power_management()` in `stop.sh` returns WiFi to normal
- **Result**: Updates work reliably even when unplugged from power

### 3. Automated Testing Suite
**Created comprehensive test suite to prevent bugs:**

#### Test Scripts:
1. **`pre-deployment-validation.sh`** - Master test suite (10 test categories)
   - File existence and syntax validation
   - Configuration value verification
   - Function presence and execution flow
   - WiFi command correctness and symmetry
   - POSIX shell compatibility checks
   - Documentation completeness

2. **`test-schedule-logic.sh`** - Cron schedule validator
   - Validates 7am-10pm Central Time coverage
   - Tests both CDT and CST timezone handling
   - Calculates daily update frequency
   - Caught timezone bug (original 0-3 UTC missed 10pm CST)

3. **`test-wifi-commands.sh`** - WiFi logic validator
   - Validates keep-alive enable/disable symmetry
   - Checks function calls in execution flow
   - Verifies POSIX compatibility

#### Testing Results:
- ✅ **Bug Caught**: Tests revealed original schedule used `0-3 UTC` which missed 10pm during CST (4am UTC)
- ✅ **Bug Fixed**: Updated to `0-4 UTC` ensuring full coverage year-round
- ✅ **All Tests Pass**: Complete validation suite passes with zero failures
- ✅ **POSIX Verified**: All Kindle scripts confirmed compatible with ash/dash shell

**Files Added**:
- `fix-eink-schedule.sh` - Automated deployment script with backup/verification
- `test-schedule-logic.sh` - Schedule validation tests
- `test-wifi-commands.sh` - WiFi logic tests
- `pre-deployment-validation.sh` - Comprehensive pre-deployment test suite
- `EINK_SCHEDULE_FIX_README.md` - Complete documentation with testing procedures

**Files Modified**:
- `kindle/start.sh` - Added `keep_wifi_alive()` function
- `kindle/stop.sh` - Added `restore_wifi_power_management()` function
- `kindle/setup-local-cron.sh` - Fixed schedule to `0-4 UTC`, updated to Pi server IP
- `CLAUDE.md` - Added comprehensive testing documentation

**Testing Best Practices Established**:
- **Pre-Deployment**: Always run `./pre-deployment-validation.sh` before deploying
- **POSIX Compliance**: All Kindle scripts validated with `sh -n script.sh`
- **Schedule Changes**: Validate with `./test-schedule-logic.sh`
- **WiFi Changes**: Validate with `./test-wifi-commands.sh`
- **Documentation**: Update CLAUDE.md with all changes

**Production Impact**:
- **Battery Life**: 29% fewer updates = significant battery improvement
- **Reliability**: WiFi stays connected when unplugged
- **Timezone Handling**: Works correctly during DST transitions
- **Quality Assurance**: Testing suite prevents regression bugs

**Deployment Date**: November 6, 2025
**Status**: ✅ Tested & Ready for Deployment

**Deployment Command**: `./fix-eink-schedule.sh`

## Shell Compatibility Rules for Kindle Development

### CRITICAL: Kindle uses basic shell (ash/dash), NOT bash
All scripts must be POSIX-compatible. Avoid bash-specific features:

#### ❌ NEVER USE (bash-specific):
```bash
# Arrays
local arr=("item1" "item2")
for item in "${arr[@]}"; do

# Advanced test syntax
if [[ condition ]]; then

# Bash source arrays
${BASH_SOURCE[0]}

# Advanced set options
set -euo pipefail

# C-style loops
for ((i=1; i<=10; i++)); do

# Arithmetic increment operators
((var++))  # Will cause syntax error
((++var))  # Will cause syntax error

# Process substitution
while read line; do ... done < <(command)

# String comparison with ==
if [[ "$var" == "value" ]]; then

# Source command
source file.conf
```

#### ✅ ALWAYS USE (POSIX-compatible):
```bash
# Simple string variables with space-separated loops
for item in item1 item2 item3; do

# Basic test syntax
if [ condition ]; then

# Script directory detection
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Basic set options only
set -e

# While loops with counters
i=1
while [ $i -le 10 ]; do
    # ... code ...
    i=$((i + 1))
done

# Simple file globbing
for file in /path/*.png; do
    [ -f "$file" ] || continue
    # ... code ...
done

# String comparison with =
if [ "$var" = "value" ]; then

# Dot sourcing
. file.conf
```

### Testing Shell Compatibility
Always test scripts with basic shell before deployment:
```bash
# Test syntax
sh -n script.sh

# Test on all Kindle scripts
for script in kindle/*.sh; do
    sh -n "$script" && echo "✓ OK" || echo "✗ ERROR"
done
```

### Common Compatibility Issues & Solutions
**Arithmetic Operations**:
```bash
# ❌ ERROR: bash-specific increment
((attempt++))

# ✅ CORRECT: POSIX arithmetic
attempt=$((attempt + 1))

# ❌ ERROR: bash-specific decrement
((i--))

# ✅ CORRECT: POSIX arithmetic
i=$((i - 1))
```

**Sleep Prevention Commands**:
```bash
# Disable screensaver (must run after framework stop)
lipc-set-prop com.lab126.powerd preventScreenSaver 1

# Re-enable screensaver (run before framework start)
lipc-set-prop com.lab126.powerd preventScreenSaver 0
```

**Deployment Verification**:
```bash
# Always verify syntax before deployment
sh -n kindle/fetch-dashboard.sh
sh -n kindle/start.sh
sh -n kindle/stop.sh

# Deploy and test on actual device
./generate-and-test.sh --deploy
ssh root@kindle "/mnt/us/dashboard/start.sh"
```

## Essential Kindle Commands
```bash
# Display image (partial refresh)
/usr/sbin/eips -g /path/to/image.png

# Display image (full refresh - prevents ghosting)
/usr/sbin/eips -f -g /path/to/image.png

# Battery level and voltage
gasgauge-info -c      # Battery percentage
gasgauge-info -v      # Battery voltage (mV)
gasgauge-info -k      # Battery temperature (Fahrenheit)

# Device statistics (comprehensive)
/mnt/us/dashboard/get-device-stats.sh --format human
/mnt/us/dashboard/get-device-stats.sh --format json
/mnt/us/dashboard/get-device-stats.sh --format csv

# Weather data testing (server-side)
node -e "const w = require('./weather-service.js'); new w().getFormattedWeather().then(console.log);"
rm -f cache/weather_cache.json  # Clear weather cache

# WiFi status
iwconfig             # Show wireless interface info

# Stop framework (required for dashboard mode)
/etc/init.d/framework stop

# Sleep prevention (dashboard mode)
lipc-set-prop com.lab126.powerd preventScreenSaver 1  # Disable screensaver
lipc-set-prop com.lab126.powerd preventScreenSaver 0  # Enable screensaver

# Network connectivity test
ping -c 1 1.1.1.1
```

## Project Structure
```
/
├── server/                 # Server-side dashboard generation
│   ├── generate-dashboard.js
│   ├── server.js
│   └── templates/
├── kindle/                 # Kindle-side scripts
│   ├── fetch-dashboard.sh
│   ├── start.sh
│   ├── stop.sh
│   └── config/
├── KUAL/                   # KUAL extension
│   └── kindle-dash/
│       ├── config.xml
│       └── menu.json
└── test-images/           # Test images for validation
```

## Kindle File Paths
- **Dashboard location**: `/mnt/us/dashboard/`
- **KUAL extensions**: `/mnt/us/extensions/`
- **Log files**: `/mnt/us/dashboard/logs/`
- **Config files**: `/mnt/us/dashboard/config/`

## Development Workflow

### Testing on Kindle
1. Generate/modify image or script locally
2. For weather dashboard: `./generate-and-test.sh --deploy` (full pipeline with weather + device stats)
3. For specific layouts: `node generate-flexible-dashboard.js [layout] --test`
4. For manual testing: Transfer via SCP: `scp file.png kindle:/mnt/us/dashboard/`
5. SSH to Kindle: `ssh root@kindle`
6. Test device stats: `/mnt/us/dashboard/get-device-stats.sh --format human`
7. Test display: `/usr/sbin/eips -g /mnt/us/dashboard/file.png`
8. Verify result on e-ink screen

### Weather Data Troubleshooting
- Clear cache: `rm -f cache/weather_cache.json`
- Test API: `node -e "const w = require('./weather-service.js'); new w().getFormattedWeather().then(console.log);"`
- Check timezone: Weather uses America/Chicago (Central Time)
- Temperature format: Fahrenheit by default (74°F not 24°C)

### Image Requirements Checklist
- [ ] 800x600 pixels (landscape)
- [ ] Grayscale PNG (no alpha)
- [ ] High contrast (black on white)
- [ ] Clean fonts, no antialiasing artifacts
- [ ] Test on actual e-ink display

## Automated Testing Suite

### Overview
The project includes comprehensive automated tests to validate changes before deployment. **Always run these tests before deploying to Kindle or merging code.**

### Test Scripts

#### 1. Pre-Deployment Validation (Primary Test Suite)
**File**: `pre-deployment-validation.sh`
**Purpose**: Comprehensive validation of all changes before deployment

**Run before every deployment or merge:**
```bash
./pre-deployment-validation.sh
```

**What it tests:**
- ✅ Required files exist
- ✅ Shell script syntax (POSIX compatibility)
- ✅ Configuration values (server IPs, schedules)
- ✅ Function presence and calls
- ✅ WiFi command correctness
- ✅ POSIX shell compatibility (no bash-isms)
- ✅ Documentation completeness
- ✅ Deployment script structure
- ✅ Cron schedule logic
- ✅ WiFi keep-alive implementation

**Expected output:** All tests must pass (green checkmarks) before deployment.

#### 2. Schedule Logic Validator
**File**: `test-schedule-logic.sh`
**Purpose**: Validates cron schedule mathematics and timezone coverage

```bash
./test-schedule-logic.sh
```

**What it validates:**
- 7am-10pm Central Time coverage in both CDT and CST
- Proper handling of UTC timezone conversion
- Daily update frequency calculations
- No gaps or overlaps in schedule

#### 3. WiFi Command Validator
**File**: `test-wifi-commands.sh`
**Purpose**: Validates WiFi keep-alive implementation

```bash
./test-wifi-commands.sh
```

**What it validates:**
- `keep_wifi_alive()` function exists and is called
- `restore_wifi_power_management()` function exists and is called
- Command symmetry (enable/disable pairs match)
- POSIX compatibility (no bash-specific syntax)
- Execution order is correct

### Pre-Deployment Checklist

**Before deploying ANY changes to Kindle:**

1. **Run automated tests:**
   ```bash
   ./pre-deployment-validation.sh
   ```
   - Must show "✓ ALL VALIDATIONS PASSED"
   - Review any warnings or failures
   - Fix issues before proceeding

2. **Check shell syntax:**
   ```bash
   sh -n kindle/*.sh
   ```
   - All Kindle scripts must pass POSIX syntax check

3. **Review git status:**
   ```bash
   git status
   git diff
   ```
   - Understand what's changing
   - No unintended modifications

4. **Test on Kindle (if possible):**
   - Deploy to test environment first
   - Verify functionality manually
   - Check logs for errors

5. **Document changes:**
   - Update CLAUDE.md with new features
   - Update README if user-facing changes
   - Include testing results in commit message

### Continuous Testing Best Practices

**When modifying Kindle scripts:**
- Test POSIX compatibility: `sh -n script.sh`
- No bash-specific features (see Shell Compatibility Rules section)
- Run full validation suite before commit

**When modifying cron schedules:**
- Run `./test-schedule-logic.sh` to verify timezone coverage
- Validate daily update counts match expectations
- Test both CDT and CST scenarios

**When modifying WiFi/power management:**
- Run `./test-wifi-commands.sh` to verify symmetry
- Ensure enable/disable commands are balanced
- Test on actual hardware (WiFi behavior is hardware-dependent)

**When adding new features:**
- Add tests to validation suite if applicable
- Update pre-deployment checklist if needed
- Document testing process in feature PR

### Test Failure Response

**If validation tests fail:**
1. **Read the error messages** - Tests provide specific details about failures
2. **Fix the root cause** - Don't skip or disable tests
3. **Re-run validation** - Ensure fix resolves the issue
4. **Update tests if needed** - If requirements changed, update test expectations
5. **Document the fix** - Explain what was wrong and how it was fixed

**Common test failures:**
- Syntax errors: Check shell compatibility (bash vs POSIX)
- Missing functions: Function defined but not called in main()
- Config mismatches: Server IPs, schedules don't match expected values
- POSIX violations: Using `[[`, `source`, `++` operators, etc.

### Adding New Tests

When adding functionality that could break existing behavior:

1. **Create a test script** (follow naming: `test-<feature>.sh`)
2. **Add to validation suite** (`pre-deployment-validation.sh`)
3. **Document in CLAUDE.md** (this section)
4. **Include in CI/CD** (if applicable)

**Test script template:**
```bash
#!/bin/bash
# Test: <Feature Name>
# Purpose: <What this validates>

set -e

# Run tests
# Report pass/fail
# Exit with appropriate code (0 = pass, 1 = fail)
```

## Reference Implementation Notes
From kindle-dash project:
- Uses headless Chrome (Puppeteer) for image generation
- Cron-style scheduling: `"2,32 8-17 * * MON-FRI"`
- WiFi connectivity validation before fetch
- RTC sleep/wake for power efficiency
- Partial vs full refresh management

## Dependencies & Tools
- **Server-side**: Node.js + Puppeteer OR Python + Pillow
- **Kindle-side**: Shell scripts, existing tools (wget/curl, eips)
- **Image processing**: PNG optimization for e-ink
- **Deployment**: Consider Netlify Functions for v1+

## Current Focus Areas
1. **Environment Validation**: Ensure Kindle setup works correctly
2. **Basic Display**: Get simple image showing on screen
3. **Image Generation Pipeline**: Server-side dashboard creation
4. **Fetch Mechanism**: Automated updates from server

## Future Integration Points
- Weather API (OpenWeatherMap)
- Calendar integration (Google Calendar, CalDAV)
- Task management (Todoist, etc.)
- News feeds (RSS)
- Device statistics monitoring

## Testing Strategy

### Automated Testing (Required)
- **Always run** `./pre-deployment-validation.sh` before deploying changes
- Tests must pass before merging code or deploying to Kindle
- Fix any test failures before proceeding - don't skip tests

### Hardware Testing (Recommended)
- Always test visual changes on actual Kindle hardware
- Monitor battery consumption patterns
- Validate network connectivity handling
- Test different refresh intervals
- Verify WiFi behavior when unplugged from power

### Integration Testing
- Test full update cycle (server → network → Kindle → display)
- Verify cron jobs run at expected times
- Monitor logs for errors: `/mnt/us/dashboard/logs/`
- Check dashboard refreshes properly during active hours

---

**Important**: E-ink displays behave very differently from regular screens. Always validate visual changes on the actual Kindle device, not just in browser/emulator.

**Testing First**: Run automated tests (`./pre-deployment-validation.sh`) before every deployment to catch bugs early. The test suite has already caught and prevented production bugs!