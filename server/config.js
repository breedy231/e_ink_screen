#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Central configuration — the single place environment-specific values live.
 *
 * Every value can be overridden via environment variables. On the Pi, the
 * systemd unit loads them from server/.env (EnvironmentFile=); locally,
 * export them in your shell. No dotenv dependency needed.
 */

function resolvePythonBin() {
    if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
    // pi/setup-auto-deploy.sh creates the venv at <repo>/venv;
    // test_env is the legacy dev-machine location.
    const candidates = [
        path.join(__dirname, '..', 'venv', 'bin', 'python3'),
        path.join(__dirname, '..', 'test_env', 'bin', 'python3')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return 'python3';
}

module.exports = {
    // HTTP server
    PORT: parseInt(process.env.PORT, 10) || 3000,
    // 0.0.0.0 so the Kindle can reach the server over the LAN;
    // set HOST=localhost to restrict to loopback.
    HOST: process.env.HOST || '0.0.0.0',
    DEFAULT_LAYOUT: process.env.DEFAULT_LAYOUT || 'wild-swiss',
    CACHE_TTL_MS: parseInt(process.env.CACHE_TTL_MS, 10) || 60000,

    // Location & time
    TIMEZONE: process.env.TIMEZONE || 'America/Chicago',
    LATITUDE: parseFloat(process.env.LATITUDE) || 41.8781,   // Chicago
    LONGITUDE: parseFloat(process.env.LONGITUDE) || -87.6298,

    // Staleness alert — must match kindle/config/dashboard.conf's
    // ACTIVE_HOURS_START/END or this will false-alarm at the edges of the day.
    STALE_THRESHOLD_MS: parseInt(process.env.STALE_THRESHOLD_MS, 10) || 45 * 60 * 1000,
    STALE_CHECK_INTERVAL_MS: parseInt(process.env.STALE_CHECK_INTERVAL_MS, 10) || 5 * 60 * 1000,
    ACTIVE_HOURS_START: parseInt(process.env.ACTIVE_HOURS_START, 10) || 7,
    ACTIVE_HOURS_END: parseInt(process.env.ACTIVE_HOURS_END, 10) || 22,

    // Display
    CANVAS_WIDTH: 600,
    CANVAS_HEIGHT: 800,

    // Secrets / integrations (no defaults — features disable when unset)
    CALENDAR_URL: process.env.CALENDAR_URL || null,
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || null,

    // Python for e-ink optimization scripts
    PYTHON_BIN: resolvePythonBin()
};
