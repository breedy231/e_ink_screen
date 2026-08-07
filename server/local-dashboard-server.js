#!/usr/bin/env node

const http = require('http');
const { URL } = require('url');
const config = require('./config');
const { generateDashboard, optimizeForEink, createServices } = require('./generate');
const { sendDiscordNotification } = require('./notify');
const { BatteryAlertState } = require('./battery-alert');
const { StalenessAlertState } = require('./staleness-alert');

/**
 * Local HTTP Server for Kindle Dashboard
 *
 * Thin HTTP layer: routing, caching, and battery notifications.
 * Dashboard generation lives in generate.js (shared with the CLI).
 */

class LocalDashboardServer {
    constructor(options = {}) {
        this.port = options.port || config.PORT;
        this.host = options.host || config.HOST;
        this.cacheEnabled = options.cache !== false;
        this.cacheTimeout = options.cacheTimeout || config.CACHE_TTL_MS;
        this.layout = options.layout || config.DEFAULT_LAYOUT;

        this.imageCache = new Map();
        this.batteryAlerts = new BatteryAlertState();
        this.stalenessAlert = new StalenessAlertState({
            thresholdMs: config.STALE_THRESHOLD_MS,
            activeHoursStart: config.ACTIVE_HOURS_START,
            activeHoursEnd: config.ACTIVE_HOURS_END,
            timezone: config.TIMEZONE
        });
        this.discordWebhookUrl = config.DISCORD_WEBHOOK_URL;

        // Long-lived services so weather/calendar caches persist across requests
        this.services = createServices({ mockData: false });
    }

    log(message, level = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level}] ${message}`);
    }

    checkBatteryAndNotify(batteryLevel, chargingStatus) {
        if (!this.discordWebhookUrl) return;

        // Bucketing, charging skip, and re-arm-on-recharge live in
        // BatteryAlertState so they can be tested without the render deps.
        const decision = this.batteryAlerts.evaluate(batteryLevel, chargingStatus);
        if (!decision.notify) return;

        const { level, critical, severity } = decision;
        const color = critical ? 0xED4245 : 0xFEE75C; // red or yellow

        this.log(`Battery ${severity.toLowerCase()}: ${level}% — sending Discord notification`, 'WARN');

        sendDiscordNotification(this.discordWebhookUrl, {
            title: `Kindle Battery ${severity}`,
            description: `Battery at **${level}%**. ${critical ? 'Charge immediately!' : 'Time to charge soon.'}`,
            color,
            fields: [
                { name: 'Battery', value: `${level}%`, inline: true },
                { name: 'Severity', value: severity, inline: true },
                { name: 'Time', value: new Date().toLocaleString('en-US', { timeZone: config.TIMEZONE }), inline: true }
            ]
        }).then(() => {
            this.log('Discord notification sent');
        }).catch((err) => {
            this.log(`Discord notification error: ${err.message}`, 'ERROR');
        });
    }

    /**
     * Runs on a timer (not per-request, since a dead Kindle stops sending
     * requests). Fires once when the Kindle goes quiet during active hours
     * and stays quiet past the threshold; re-arms on the next fetch.
     */
    checkStaleness() {
        if (!this.discordWebhookUrl) return;

        const decision = this.stalenessAlert.evaluate(Date.now());
        if (!decision.notify) return;

        this.log(`Kindle silent for ${decision.silentMinutes} min during active hours — sending Discord notification`, 'WARN');

        sendDiscordNotification(this.discordWebhookUrl, {
            title: 'Kindle Dashboard Silent',
            description: `No fetch from the Kindle in **${decision.silentMinutes} min** during active hours. It may be dead, crashed, or off WiFi.`,
            color: 0xED4245,
            fields: [
                { name: 'Silent for', value: `${decision.silentMinutes} min`, inline: true },
                { name: 'Time', value: new Date().toLocaleString('en-US', { timeZone: config.TIMEZONE }), inline: true }
            ]
        }).then(() => {
            this.log('Discord notification sent');
        }).catch((err) => {
            this.log(`Discord notification error: ${err.message}`, 'ERROR');
        });
    }

    /**
     * Cache key from the request URL, EXCLUDING per-request telemetry params.
     * The Kindle appends ?battery=N&charging=N&t=... to every fetch; including
     * them made every request a cache miss (and a fresh render + Python
     * subprocess). Only params that change the rendered image belong here.
     */
    getCacheKey(url) {
        const parsedUrl = new URL(url, `http://${this.host}:${this.port}`);
        const params = new URLSearchParams(parsedUrl.search);
        params.delete('battery');
        params.delete('charging');
        params.delete('t');
        params.sort();
        const search = params.toString();
        return `${parsedUrl.pathname}${search ? '?' + search : ''}`;
    }

    isCacheValid(cacheEntry) {
        if (!this.cacheEnabled || !cacheEntry) return false;
        return Date.now() - cacheEntry.timestamp < this.cacheTimeout;
    }

    /**
     * Generate an e-ink-optimized dashboard PNG buffer.
     * Generation + optimization live in generate.js (shared with the CLI).
     */
    async generateDashboardBuffer(layout, deviceStats = null, showGrid = false) {
        this.log(`Generating dashboard with layout: ${layout}`);

        const { canvas } = await generateDashboard(layout, {
            services: this.services,
            deviceStats,
            showGrid,
            log: (msg, level = 'INFO') => this.log(msg, level)
        });

        const imageBuffer = canvas.toBuffer('image/png', {
            compressionLevel: 9,
            filters: canvas.PNG_FILTER_NONE
        });

        this.log(`Dashboard generated: ${imageBuffer.length} bytes, applying e-ink optimization...`);
        const optimizedBuffer = await optimizeForEink(imageBuffer, (msg, level = 'INFO') => this.log(msg, level));
        this.log(`E-ink optimization complete: ${optimizedBuffer.length} bytes`);
        return optimizedBuffer;
    }

    async handleDashboardRequest(req, res, parsedUrl) {
        try {
            const cacheKey = this.getCacheKey(req.url);
            const cached = this.imageCache.get(cacheKey);

            // Any fetch at all proves the Kindle is alive, independent of
            // whether it sent battery telemetry.
            this.stalenessAlert.recordFetch(Date.now());

            // Check battery level from Kindle
            const batteryLevel = parsedUrl.searchParams.get('battery');
            const chargingStatus = parsedUrl.searchParams.get('charging');
            if (batteryLevel) {
                this.checkBatteryAndNotify(batteryLevel, chargingStatus);
            }

            // Construct deviceStats from query params
            const deviceStats = batteryLevel ? {
                battery: { level: batteryLevel, voltage: 'unknown' },
            } : null;

            let imageBuffer;

            // Check cache first
            if (this.isCacheValid(cached)) {
                this.log(`Serving cached dashboard for ${cacheKey}`);
                imageBuffer = cached.buffer;
            } else {
                // Get layout from query params or use default
                const queryParams = parsedUrl.searchParams;
                const layout = queryParams.get('layout') || this.layout;
                const showGrid = queryParams.get('grid') === 'true';

                // Generate new image
                imageBuffer = await this.generateDashboardBuffer(layout, deviceStats, showGrid);

                // Cache the result
                if (this.cacheEnabled) {
                    this.imageCache.set(cacheKey, {
                        buffer: imageBuffer,
                        timestamp: Date.now()
                    });
                    this.log(`Cached dashboard for ${cacheKey}`);
                }
            }

            // Set headers for PNG image
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': imageBuffer.length,
                'Cache-Control': `public, max-age=${Math.floor(this.cacheTimeout / 1000)}`,
                'X-Generated-By': 'Kindle Dashboard Server (Local)',
                'X-Optimized-For': 'E-ink Display'
            });

            res.end(imageBuffer);
            this.log(`Served dashboard image: ${imageBuffer.length} bytes`);

        } catch (error) {
            this.handleError(res, error, 'Failed to generate dashboard');
        }
    }

    handleHealthCheck(req, res) {
        const status = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: '2.0.0',
            layout: this.layout,
            cache: {
                enabled: this.cacheEnabled,
                entries: this.imageCache.size,
                timeout: this.cacheTimeout
            }
        };

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Generated-By': 'Kindle Dashboard Server'
        });

        res.end(JSON.stringify(status, null, 2));
        this.log('Health check requested');
    }

    handleApiInfo(req, res) {
        const info = {
            title: 'Kindle Dashboard Local Server',
            description: 'HTTP server for generating e-ink optimized dashboard images with weather and flexible layouts',
            version: '2.0.0',
            endpoints: {
                '/dashboard': {
                    method: 'GET',
                    description: 'Generate and serve dashboard PNG image',
                    parameters: {
                        layout: 'string - Layout name (weather, compact, minimal, device)'
                    },
                    example: '/dashboard?layout=weather'
                },
                '/health': {
                    method: 'GET',
                    description: 'Server health check and status'
                },
                '/api': {
                    method: 'GET',
                    description: 'API information and documentation'
                }
            },
            cache: {
                enabled: this.cacheEnabled,
                timeout_seconds: Math.floor(this.cacheTimeout / 1000)
            },
            default_layout: this.layout
        };

        res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Generated-By': 'Kindle Dashboard Server'
        });

        res.end(JSON.stringify(info, null, 2));
        this.log('API info requested');
    }

    handle404(req, res) {
        const message = `Not Found: ${req.url}`;
        res.writeHead(404, {
            'Content-Type': 'text/plain',
            'X-Generated-By': 'Kindle Dashboard Server'
        });
        res.end(message);
        this.log(`404 - ${req.url}`, 'WARN');
    }

    handleError(res, error, message = 'Internal Server Error') {
        this.log(`Error: ${message} - ${error.message}`, 'ERROR');

        if (!res.headersSent) {
            res.writeHead(500, {
                'Content-Type': 'application/json',
                'X-Generated-By': 'Kindle Dashboard Server'
            });

            res.end(JSON.stringify({
                error: message,
                details: error.message,
                timestamp: new Date().toISOString()
            }));
        }
    }

    async handleRequest(req, res) {
        try {
            const parsedUrl = new URL(req.url, `http://${this.host}:${this.port}`);
            const pathname = parsedUrl.pathname;

            this.log(`${req.method} ${req.url} - ${req.headers['user-agent'] || 'Unknown'}`);

            // Route requests
            switch (pathname) {
                case '/dashboard':
                case '/dashboard.png':
                    if (req.method === 'GET') {
                        await this.handleDashboardRequest(req, res, parsedUrl);
                    } else {
                        res.writeHead(405, { 'Allow': 'GET' });
                        res.end('Method Not Allowed');
                    }
                    break;

                case '/health':
                    if (req.method === 'GET') {
                        this.handleHealthCheck(req, res);
                    } else {
                        res.writeHead(405, { 'Allow': 'GET' });
                        res.end('Method Not Allowed');
                    }
                    break;

                case '/api':
                case '/':
                    if (req.method === 'GET') {
                        this.handleApiInfo(req, res);
                    } else {
                        res.writeHead(405, { 'Allow': 'GET' });
                        res.end('Method Not Allowed');
                    }
                    break;

                default:
                    this.handle404(req, res);
                    break;
            }
        } catch (error) {
            this.handleError(res, error, 'Request handling failed');
        }
    }

    cleanupCache() {
        const now = Date.now();
        for (const [key, entry] of this.imageCache.entries()) {
            if (now - entry.timestamp > this.cacheTimeout) {
                this.imageCache.delete(key);
            }
        }
    }

    start() {
        const server = http.createServer((req, res) => {
            this.handleRequest(req, res).catch(error => {
                this.handleError(res, error, 'Unhandled request error');
            });
        });

        // Set up cache cleanup interval
        if (this.cacheEnabled) {
            setInterval(() => this.cleanupCache(), this.cacheTimeout);
        }

        // Liveness check: the Kindle dying stops requests, so this has to
        // run on its own timer rather than piggyback on a handler.
        if (this.discordWebhookUrl) {
            setInterval(() => this.checkStaleness(), config.STALE_CHECK_INTERVAL_MS);
        }

        server.listen(this.port, this.host, () => {
            this.log(`🚀 Kindle Dashboard Local Server started`);
            this.log(`📊 Dashboard endpoint: http://${this.host}:${this.port}/dashboard`);
            this.log(`💚 Health check: http://${this.host}:${this.port}/health`);
            this.log(`📋 API info: http://${this.host}:${this.port}/api`);
            this.log(`🎨 Default layout: ${this.layout}`);
            this.log(`🗄️  Cache: ${this.cacheEnabled} (${this.cacheTimeout}ms TTL)`);
            if (this.discordWebhookUrl) {
                this.log(`🔋 Battery notifications enabled via Discord webhook`);
                this.log(`📡 Staleness alert enabled: threshold ${config.STALE_THRESHOLD_MS / 60000}min, active hours ${config.ACTIVE_HOURS_START}:00-${config.ACTIVE_HOURS_END}:00 ${config.TIMEZONE}`);
            } else {
                this.log(`🔋 Battery/staleness notifications disabled (set DISCORD_WEBHOOK_URL env var to enable)`);
            }
        });

        // Graceful shutdown
        process.on('SIGINT', () => {
            this.log('Received SIGINT, shutting down gracefully...');
            server.close(() => {
                this.log('Server closed');
                process.exit(0);
            });
        });

        return server;
    }
}

// CLI functionality
function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Kindle Dashboard Local Server (v2.0.0)

Usage:
  node local-dashboard-server.js [options]

Options (env vars in server/.env override the built-in defaults):
  --port <number>       Server port (default: PORT env or 3000)
  --host <string>       Server host (default: HOST env or 0.0.0.0)
  --layout <string>     Default layout (default: DEFAULT_LAYOUT env or wild-swiss)
  --no-cache            Disable image caching
  --cache-timeout <ms>  Cache timeout in ms (default: CACHE_TTL_MS env or 60000)
  --help, -h            Show this help

Layouts: run 'npm run generate -- --list' to see all available layouts

Examples:
  node local-dashboard-server.js
  node local-dashboard-server.js --layout weather --no-cache
  node local-dashboard-server.js --cache-timeout 30000

Endpoints:
  GET /dashboard                    # Generate dashboard with default layout
  GET /dashboard?layout=weather     # Generate with specific layout
  GET /health                       # Health check
  GET /api                          # API documentation
        `);
        return;
    }

    // Parse command line arguments
    const options = {};

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--port':
                options.port = parseInt(args[++i]) || config.PORT;
                break;
            case '--host':
                options.host = args[++i] || config.HOST;
                break;
            case '--layout':
                options.layout = args[++i] || config.DEFAULT_LAYOUT;
                break;
            case '--no-cache':
                options.cache = false;
                break;
            case '--cache-timeout':
                options.cacheTimeout = parseInt(args[++i]) || 60000;
                break;
        }
    }

    // Start server
    const server = new LocalDashboardServer(options);
    server.start();
}

// Export for use as module
module.exports = LocalDashboardServer;

// Run if called directly
if (require.main === module) {
    main();
}
