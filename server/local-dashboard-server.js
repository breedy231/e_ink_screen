#!/usr/bin/env node

const http = require('http');
const { DashboardEngine } = require('./dashboard-engine');
const WeatherService = require('./weather-service');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

/**
 * Local HTTP Server for Kindle Dashboard
 * Uses the same dashboard engine as generate-and-test.sh
 * Generates proper weather dashboards with flexible layouts
 */

class LocalDashboardServer {
    constructor(options = {}) {
        this.port = options.port || 3000;
        this.host = options.host || 'localhost';
        this.cacheEnabled = options.cache !== false;
        this.cacheTimeout = options.cacheTimeout || 60000; // 1 minute default
        this.layout = options.layout || 'weather';

        this.imageCache = new Map();
        this.weatherService = new WeatherService({
            latitude: 41.8781,
            longitude: -87.6298,
            timezone: 'America/Chicago',
            mockData: false
        });
    }

    log(message, level = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level}] ${message}`);
    }

    getCacheKey(url) {
        const parsedUrl = new URL(url, `http://${this.host}:${this.port}`);
        return `${parsedUrl.pathname}${parsedUrl.search}`;
    }

    isCacheValid(cacheEntry) {
        if (!this.cacheEnabled || !cacheEntry) return false;
        return Date.now() - cacheEntry.timestamp < this.cacheTimeout;
    }

    /**
     * Optimize image for e-ink using Python script
     */
    async optimizeForEink(imageBuffer) {
        return new Promise((resolve, reject) => {
            // Create temp files
            const tempDir = path.join(__dirname, '..', 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const tempInput = path.join(tempDir, `dashboard_${Date.now()}.png`);
            const tempOutput = path.join(tempDir, `dashboard_${Date.now()}_optimized.png`);

            try {
                // Write buffer to temp file
                fs.writeFileSync(tempInput, imageBuffer);

                // Run Python optimization script using virtual environment
                const pythonScript = path.join(__dirname, 'optimize-for-eink.py');
                const venvPython = path.join(__dirname, '..', 'test_env', 'bin', 'python3');

                // Use venv python if available, fallback to system python3
                const pythonBinary = fs.existsSync(venvPython) ? venvPython : 'python3';

                const python = spawn(pythonBinary, [pythonScript, tempInput, '-o', tempOutput]);

                let stderr = '';

                python.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                python.on('close', (code) => {
                    try {
                        if (code === 0 && fs.existsSync(tempOutput)) {
                            // Read optimized image
                            const optimizedBuffer = fs.readFileSync(tempOutput);

                            // Cleanup temp files
                            fs.unlinkSync(tempInput);
                            fs.unlinkSync(tempOutput);

                            resolve(optimizedBuffer);
                        } else {
                            // Cleanup and return original if optimization fails
                            fs.unlinkSync(tempInput);
                            if (fs.existsSync(tempOutput)) {
                                fs.unlinkSync(tempOutput);
                            }

                            this.log(`E-ink optimization failed (code ${code}), using original image`, 'WARN');
                            this.log(`Python error: ${stderr}`, 'DEBUG');
                            resolve(imageBuffer);
                        }
                    } catch (cleanupError) {
                        this.log(`Cleanup error: ${cleanupError.message}`, 'ERROR');
                        resolve(imageBuffer);
                    }
                });

                python.on('error', (error) => {
                    this.log(`Python spawn error: ${error.message}`, 'ERROR');
                    // Cleanup and return original
                    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                    resolve(imageBuffer);
                });

            } catch (error) {
                this.log(`E-ink optimization error: ${error.message}`, 'ERROR');
                // Cleanup on error
                if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                resolve(imageBuffer);
            }
        });
    }

    /**
     * Enrich layout configuration with data
     */
    enrichLayoutWithData(layoutConfig, weatherData, timeData) {
        const enrichedConfig = JSON.parse(JSON.stringify(layoutConfig));

        enrichedConfig.components = enrichedConfig.components.map(component => {
            // Inject weather data into weather components
            if (component.type === 'weather' && weatherData) {
                return {
                    ...component,
                    config: {
                        ...component.config,
                        weatherData: weatherData
                    }
                };
            }

            // Inject time data into clock/date components if needed
            if (component.type === 'clock' || component.type === 'date') {
                // Clock and date components use current time automatically
                return component;
            }

            return component;
        });

        return enrichedConfig;
    }

    /**
     * Generate dashboard image buffer using DashboardEngine
     */
    async generateDashboardBuffer(layout = 'weather') {
        try {
            this.log(`Generating dashboard with layout: ${layout}`);

            // Load layout configuration
            const layoutPath = path.join(__dirname, 'layouts', `${layout}.json`);
            let layoutConfig;

            try {
                const layoutData = fs.readFileSync(layoutPath, 'utf8');
                layoutConfig = JSON.parse(layoutData);
            } catch (error) {
                this.log(`Layout ${layout} not found, using weather layout`, 'WARN');
                const weatherLayoutPath = path.join(__dirname, 'layouts', 'weather.json');
                const weatherLayoutData = fs.readFileSync(weatherLayoutPath, 'utf8');
                layoutConfig = JSON.parse(weatherLayoutData);
            }

            // Get weather data
            const weather = await this.weatherService.getFormattedWeather();

            // Get current time data
            const now = new Date();
            const timeData = {
                time: now.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                    timeZone: 'America/Chicago'
                }),
                date: now.toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'America/Chicago'
                }),
                timestamp: now.toISOString()
            };

            // Create dashboard engine
            const engine = new DashboardEngine({
                width: 600,
                height: 800,
                backgroundColor: '#FFFFFF'
            });

            // Enrich layout with data
            const enrichedConfig = this.enrichLayoutWithData(layoutConfig, weather, timeData);

            // Load layout and render
            engine.loadLayout(enrichedConfig);
            const canvas = engine.render({
                showGrid: false
            });

            // Convert to buffer
            const imageBuffer = canvas.toBuffer('image/png', {
                compressionLevel: 9,
                filters: canvas.PNG_FILTER_NONE
            });

            this.log(`Dashboard generated: ${imageBuffer.length} bytes, applying e-ink optimization...`);

            // Apply e-ink optimization using Python script
            const optimizedBuffer = await this.optimizeForEink(imageBuffer);

            this.log(`E-ink optimization complete: ${optimizedBuffer.length} bytes`);
            return optimizedBuffer;

        } catch (error) {
            this.log(`Error generating dashboard: ${error.message}`, 'ERROR');
            this.log(`Stack: ${error.stack}`, 'DEBUG');
            throw error;
        }
    }

    async handleDashboardRequest(req, res, parsedUrl) {
        try {
            const cacheKey = this.getCacheKey(req.url);
            const cached = this.imageCache.get(cacheKey);

            let imageBuffer;

            // Check cache first
            if (this.isCacheValid(cached)) {
                this.log(`Serving cached dashboard for ${cacheKey}`);
                imageBuffer = cached.buffer;
            } else {
                // Get layout from query params or use default
                const queryParams = parsedUrl.searchParams;
                const layout = queryParams.get('layout') || this.layout;

                // Generate new image
                imageBuffer = await this.generateDashboardBuffer(layout);

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

        server.listen(this.port, this.host, () => {
            this.log(`🚀 Kindle Dashboard Local Server started`);
            this.log(`📊 Dashboard endpoint: http://${this.host}:${this.port}/dashboard`);
            this.log(`💚 Health check: http://${this.host}:${this.port}/health`);
            this.log(`📋 API info: http://${this.host}:${this.port}/api`);
            this.log(`🎨 Default layout: ${this.layout}`);
            this.log(`🗄️  Cache: ${this.cacheEnabled} (${this.cacheTimeout}ms TTL)`);
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

Options:
  --port <number>       Server port (default: 3000)
  --host <string>       Server host (default: localhost)
  --layout <string>     Default layout (default: weather)
  --no-cache            Disable image caching
  --cache-timeout <ms>  Cache timeout in milliseconds (default: 60000)
  --help, -h            Show this help

Layouts:
  weather    Weather-focused dashboard (default)
  compact    Compact layout with less spacing
  minimal    Minimal information display
  device     Device statistics focused

Examples:
  node local-dashboard-server.js --host 0.0.0.0 --port 3000
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
                options.port = parseInt(args[++i]) || 3000;
                break;
            case '--host':
                options.host = args[++i] || 'localhost';
                break;
            case '--layout':
                options.layout = args[++i] || 'weather';
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
