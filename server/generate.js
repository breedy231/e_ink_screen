#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const { DashboardEngine, getLayoutDataNeeds, enrichLayoutWithData } = require('./dashboard-engine');
const WeatherService = require('./weather-service');
const PokemonService = require('./pokemon-service');
const CalendarService = require('./calendar-service');
const TrmnlService = require('./trmnl-service');

/**
 * Unified dashboard generation pipeline — the single implementation shared
 * by the HTTP server (local-dashboard-server.js) and the CLI generator
 * (generate-flexible-dashboard.js). Layout loading, data-service
 * orchestration, enrichment, and rendering all live here; keeping two copies
 * of this logic is how the server and CLI drifted apart in the past.
 */

const LAYOUTS_DIR = path.join(__dirname, 'layouts');

function getAvailableLayouts() {
    try {
        return fs.readdirSync(LAYOUTS_DIR)
            .filter(file => file.endsWith('.json'))
            .map(file => path.basename(file, '.json'));
    } catch (error) {
        console.warn('Could not read layouts directory:', error.message);
        return [];
    }
}

function loadLayout(layoutName) {
    const layoutPath = path.join(LAYOUTS_DIR, `${layoutName}.json`);
    if (!fs.existsSync(layoutPath)) {
        throw new Error(`Layout file not found: ${layoutPath}`);
    }
    try {
        return JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to parse layout file ${layoutName}: ${error.message}`);
    }
}

/**
 * Build the default service set. Callers may pass their own long-lived
 * instances (the HTTP server does, to share caches across requests).
 */
function createServices(options = {}) {
    const mockData = options.mockData || false;
    return {
        weather: new WeatherService({
            latitude: config.LATITUDE,
            longitude: config.LONGITUDE,
            timezone: config.TIMEZONE,
            mockData
        }),
        pokemon: new PokemonService({ mockData }),
        calendar: new CalendarService({
            calendarUrl: config.CALENDAR_URL,
            timezone: config.TIMEZONE,
            mockData
        }),
        trmnl: new TrmnlService({
            baseUrl: config.TRMNL_BASE_URL,
            deviceMac: config.TRMNL_DEVICE_MAC,
            apiKey: config.TRMNL_API_KEY,
            cacheTimeout: config.TRMNL_CACHE_TTL_MS,
            mockData
        })
    };
}

/**
 * Generate a dashboard canvas for a layout.
 *
 * Only the data the layout's components declare (via static dataNeeds) is
 * fetched. Data failures degrade gracefully: the component renders its
 * "unavailable" state rather than failing the whole dashboard.
 *
 * @param {string} layoutName  Layout JSON basename (e.g. 'wild-swiss')
 * @param {object} opts
 *   services:    { weather, pokemon, calendar } service instances (optional)
 *   deviceStats: device stats object from the caller (server: query params)
 *   mockData:    build mock services when none are passed
 *   showGrid:    render the debug grid
 *   log:         logger fn (message, level) — defaults to console
 * @returns {Promise<{canvas, layoutConfig, data}>}
 */
async function generateDashboard(layoutName, opts = {}) {
    const log = opts.log || ((msg) => console.log(msg));
    const services = opts.services || createServices({ mockData: opts.mockData });

    const layoutConfig = loadLayout(layoutName);
    const needs = getLayoutDataNeeds(layoutConfig);
    const data = { deviceStats: opts.deviceStats || null };

    if (needs.has('weather')) {
        try {
            data.weather = await services.weather.getFormattedWeather();
            log(`Weather: ${data.weather.source || 'unknown'} source`);
        } catch (error) {
            log(`Failed to get weather data: ${error.message}`, 'WARN');
            data.weather = null;
        }
    }

    if (needs.has('calendar')) {
        try {
            data.calendar = await services.calendar.getFormattedCalendar();
            log(`Calendar: ${data.calendar.today.length} today, ${data.calendar.tomorrow.length} tomorrow (${data.calendar.source})`);
        } catch (error) {
            log(`Failed to get calendar data: ${error.message}`, 'WARN');
            data.calendar = null;
        }
    }

    if (needs.has('pokemon')) {
        try {
            // Weather + calendar context drives contextual selection
            data.pokemon = await services.pokemon.getFormattedPokemon({
                weatherData: data.weather || null,
                calendarData: data.calendar || null
            });
            log(`Pokemon: #${data.pokemon.id} ${data.pokemon.name} (${data.pokemon.source}, reason: ${data.pokemon.reason})`);
        } catch (error) {
            log(`Failed to get Pokemon data: ${error.message}`, 'WARN');
            data.pokemon = null;
        }
    }

    if (needs.has('trmnl')) {
        try {
            data.trmnl = await services.trmnl.getFormattedTrmnl();
            log(`TRMNL: ${data.trmnl ? data.trmnl.source : 'unavailable'}`);
        } catch (error) {
            log(`Failed to get TRMNL screen: ${error.message}`, 'WARN');
            data.trmnl = null;
        }
    }

    const engine = new DashboardEngine({
        width: config.CANVAS_WIDTH,
        height: config.CANVAS_HEIGHT,
        backgroundColor: '#FFFFFF'
    });

    engine.loadLayout(enrichLayoutWithData(layoutConfig, data));
    const canvas = await engine.render({ showGrid: opts.showGrid || false });

    return { canvas, layoutConfig, data };
}

/**
 * Run the Python e-ink optimizer (grayscale + autocontrast) over a PNG
 * buffer. Resolves with the original buffer if optimization fails —
 * a slightly-less-crisp dashboard beats no dashboard.
 */
function optimizeForEink(imageBuffer, log = console.log) {
    return new Promise((resolve) => {
        const tempDir = path.join(__dirname, '..', 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const tempInput = path.join(tempDir, `dashboard_${stamp}.png`);
        const tempOutput = path.join(tempDir, `dashboard_${stamp}_optimized.png`);

        const cleanup = () => {
            try {
                if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
            } catch (e) { /* best effort */ }
        };

        try {
            fs.writeFileSync(tempInput, imageBuffer);

            const pythonScript = path.join(__dirname, 'optimize-for-eink.py');
            const python = spawn(config.PYTHON_BIN, [pythonScript, tempInput, '-o', tempOutput]);

            let stderr = '';
            python.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

            python.on('close', (code) => {
                if (code === 0 && fs.existsSync(tempOutput)) {
                    const optimizedBuffer = fs.readFileSync(tempOutput);
                    cleanup();
                    resolve(optimizedBuffer);
                } else {
                    cleanup();
                    log(`E-ink optimization failed (code ${code}), using original image`, 'WARN');
                    if (stderr) log(`Python error: ${stderr}`, 'DEBUG');
                    resolve(imageBuffer);
                }
            });

            python.on('error', (error) => {
                cleanup();
                log(`Python spawn error (${config.PYTHON_BIN}): ${error.message}`, 'ERROR');
                resolve(imageBuffer);
            });
        } catch (error) {
            cleanup();
            log(`E-ink optimization error: ${error.message}`, 'ERROR');
            resolve(imageBuffer);
        }
    });
}

module.exports = {
    generateDashboard,
    optimizeForEink,
    createServices,
    getAvailableLayouts,
    loadLayout
};
