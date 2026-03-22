#!/usr/bin/env node

const { DashboardEngine } = require('./dashboard-engine');
const DeviceStats = require('./device-stats');
const WeatherService = require('./weather-service');
const PokemonService = require('./pokemon-service');
const CalendarService = require('./calendar-service');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

/**
 * Flexible Dashboard Generator using the new layout engine
 */

class FlexibleDashboardGenerator {
    constructor(options = {}) {
        this.layoutsDir = path.join(__dirname, 'layouts');
        this.outputDir = path.join(__dirname, '..', 'test-images');

        // Device statistics configuration
        this.deviceStats = new DeviceStats({
            kindleHost: options.kindleHost || 'kindle',
            kindleUser: options.kindleUser || 'root',
            mockData: options.mockData || false,
            useSSH: options.useSSH !== false
        });

        // Weather service configuration
        this.weatherService = new WeatherService({
            latitude: options.latitude || 41.8781, // Default: Chicago
            longitude: options.longitude || -87.6298,
            timezone: options.timezone || 'America/Chicago',
            mockData: options.mockData || false
        });

        // Pokemon service configuration
        this.pokemonService = new PokemonService({
            mockData: options.mockData || false
        });

        // Calendar service configuration
        this.calendarService = new CalendarService({
            timezone: options.timezone || 'America/Chicago',
            mockData: options.mockData || false
        });

        // Ensure output directory exists
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * Get list of available layouts
     */
    getAvailableLayouts() {
        try {
            const files = fs.readdirSync(this.layoutsDir)
                .filter(file => file.endsWith('.json'))
                .map(file => path.basename(file, '.json'));
            return files;
        } catch (error) {
            console.warn('Could not read layouts directory:', error.message);
            return [];
        }
    }

    /**
     * Load layout configuration from file
     */
    loadLayout(layoutName) {
        const layoutPath = path.join(this.layoutsDir, `${layoutName}.json`);

        if (!fs.existsSync(layoutPath)) {
            throw new Error(`Layout file not found: ${layoutPath}`);
        }

        try {
            const layoutData = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
            return layoutData;
        } catch (error) {
            throw new Error(`Failed to parse layout file ${layoutName}: ${error.message}`);
        }
    }

    /**
     * Generate dashboard with specified layout
     */
    async generateDashboard(layoutName = 'default', options = {}) {
        console.log(`🖼️  Generating dashboard with '${layoutName}' layout...`);

        // Load layout configuration
        const layoutConfig = this.loadLayout(layoutName);
        console.log(`📐 Layout: ${layoutConfig.name}`);
        console.log(`📝 ${layoutConfig.description}`);

        // Fetch device statistics if we have device-stats components
        let deviceStatsData = null;
        const hasDeviceStatsComponent = layoutConfig.components.some(comp => comp.type === 'device-stats' || comp.type === 'status-bar');

        if (hasDeviceStatsComponent) {
            console.log(`📊 Fetching device statistics...`);
            try {
                deviceStatsData = await this.deviceStats.getStats();
                console.log(`✅ Device stats source: ${deviceStatsData._source || 'unknown'}`);
            } catch (error) {
                console.warn(`⚠️  Failed to fetch device stats: ${error.message}`);
                deviceStatsData = null;
            }
        }

        // Fetch weather data if we have weather components
        let weatherData = null;
        const fullCanvasTypes = ['watch-face', 'brutalist', 'swiss-poster'];
        const hasWeatherComponent = layoutConfig.components.some(comp =>
            comp.type === 'weather' || comp.type === 'hero-weather' || comp.type === 'weather-illustration' || fullCanvasTypes.includes(comp.type));

        if (hasWeatherComponent) {
            console.log(`🌤️  Fetching weather data...`);
            try {
                weatherData = await this.weatherService.getFormattedWeather();
                console.log(`✅ Weather data source: ${weatherData.source || 'unknown'}`);
            } catch (error) {
                console.warn(`⚠️  Failed to fetch weather data: ${error.message}`);
                weatherData = null;
            }
        }

        // Fetch calendar data if we have calendar components
        let calendarData = null;
        const hasCalendarComponent = layoutConfig.components.some(comp => comp.type === 'calendar' || fullCanvasTypes.includes(comp.type));

        if (hasCalendarComponent) {
            console.log(`📅 Fetching calendar data...`);
            try {
                calendarData = await this.calendarService.getFormattedCalendar();
                console.log(`✅ Calendar: ${calendarData.today.length} today, ${calendarData.tomorrow.length} tomorrow (${calendarData.source})`);
            } catch (error) {
                console.warn(`⚠️  Failed to fetch calendar data: ${error.message}`);
                calendarData = null;
            }
        }

        // Fetch Pokemon data if we have pokemon-sprite components
        // Pass weather + calendar context for contextual selection
        let pokemonData = null;
        const hasPokemonComponent = layoutConfig.components.some(comp => comp.type === 'pokemon-sprite' || fullCanvasTypes.includes(comp.type));

        if (hasPokemonComponent) {
            console.log(`🎮 Fetching today's Pokemon...`);
            try {
                pokemonData = await this.pokemonService.getFormattedPokemon({
                    weatherData: weatherData,
                    calendarData: calendarData
                });
                console.log(`✅ Pokemon: #${pokemonData.id} ${pokemonData.name} (${pokemonData.source}, reason: ${pokemonData.reason})`);
            } catch (error) {
                console.warn(`⚠️  Failed to fetch Pokemon data: ${error.message}`);
                pokemonData = null;
            }
        }

        // Create dashboard engine (use layout dimensions if specified, else portrait default)
        const layoutWidth = (layoutConfig.dimensions && layoutConfig.dimensions.width) || 600;
        const layoutHeight = (layoutConfig.dimensions && layoutConfig.dimensions.height) || 800;
        const engine = new DashboardEngine({
            width: layoutWidth,
            height: layoutHeight,
            backgroundColor: '#FFFFFF'
        });

        // Load layout and inject device stats, weather data, and pokemon data
        const enrichedLayoutConfig = this.enrichLayoutWithData(layoutConfig, deviceStatsData, weatherData, pokemonData, calendarData);
        engine.loadLayout(enrichedLayoutConfig);

        // Render dashboard
        const canvas = await engine.render({
            showGrid: options.showGrid || false
        });

        return { canvas, layoutConfig, deviceStatsData, weatherData, pokemonData, calendarData };
    }

    /**
     * Enrich layout configuration with data (device stats, weather, and pokemon)
     */
    enrichLayoutWithData(layoutConfig, deviceStatsData, weatherData, pokemonData, calendarData) {
        const enrichedConfig = JSON.parse(JSON.stringify(layoutConfig)); // Deep clone

        enrichedConfig.components = enrichedConfig.components.map(component => {
            if (component.type === 'device-stats') {
                return {
                    ...component,
                    config: {
                        ...component.config,
                        deviceStats: deviceStatsData
                    }
                };
            }
            if (component.type === 'status-bar') {
                return {
                    ...component,
                    config: {
                        ...component.config,
                        deviceStats: deviceStatsData
                    }
                };
            }
            if (component.type === 'weather' || component.type === 'hero-weather' || component.type === 'weather-illustration') {
                return {
                    ...component,
                    config: {
                        ...component.config,
                        weatherData: weatherData
                    }
                };
            }
            if (component.type === 'pokemon-sprite') {
                return {
                    ...component,
                    config: {
                        ...component.config,
                        pokemonData: pokemonData
                    }
                };
            }
            if (component.type === 'calendar') {
                return {
                    ...component,
                    config: {
                        ...component.config,
                        calendarData: calendarData
                    }
                };
            }
            // Full-canvas components that need all data
            if (component.type === 'watch-face' || component.type === 'brutalist' || component.type === 'swiss-poster') {
                return {
                    ...component,
                    config: {
                        ...component.config,
                        weatherData: weatherData,
                        calendarData: calendarData,
                        pokemonData: pokemonData,
                        deviceStats: deviceStatsData
                    }
                };
            }
            return component;
        });

        return enrichedConfig;
    }

    /**
     * Save dashboard to file
     */
    saveDashboard(canvas, layoutName, options = {}) {
        const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
        let filename;

        if (options.test) {
            filename = `dashboard_${layoutName}_${timestamp}.png`;
        } else {
            filename = `dashboard_${layoutName}.png`;
        }

        const outputPath = path.join(this.outputDir, filename);

        console.log(`💾 Saving dashboard to: ${outputPath}`);

        const buffer = canvas.toBuffer('image/png', {
            compressionLevel: 9,
            filters: canvas.PNG_FILTER_NONE
        });

        fs.writeFileSync(outputPath, buffer);

        const orientation = canvas.width > canvas.height ? 'Landscape' : 'Portrait';
        console.log(`✅ Dashboard saved successfully!`);
        console.log(`📏 Size: ${canvas.width}x${canvas.height}px (${orientation})`);
        console.log(`📦 File size: ${(buffer.length / 1024).toFixed(1)}KB`);

        return outputPath;
    }

    /**
     * Generate all available layouts for testing
     */
    async generateAllLayouts(options = {}) {
        const layouts = this.getAvailableLayouts();
        console.log(`🎨 Generating ${layouts.length} layout variations...`);

        const results = [];

        for (const layoutName of layouts) {
            try {
                console.log(`\n--- Processing ${layoutName} layout ---`);
                const { canvas, layoutConfig } = await this.generateDashboard(layoutName, options);
                const outputPath = this.saveDashboard(canvas, layoutName, { test: true });

                results.push({
                    layout: layoutName,
                    config: layoutConfig,
                    outputPath,
                    success: true
                });
            } catch (error) {
                console.error(`❌ Failed to generate ${layoutName}: ${error.message}`);
                results.push({
                    layout: layoutName,
                    error: error.message,
                    success: false
                });
            }
        }

        return results;
    }

    /**
     * Show layout information
     */
    showLayoutInfo(layoutName = null) {
        if (layoutName) {
            try {
                const layoutConfig = this.loadLayout(layoutName);
                console.log(`\n📐 Layout: ${layoutConfig.name}`);
                console.log(`📝 Description: ${layoutConfig.description}`);
                console.log(`🔧 Grid: ${layoutConfig.grid.rows}×${layoutConfig.grid.cols} (margin: ${layoutConfig.grid.margin}px, gap: ${layoutConfig.grid.gap}px)`);
                console.log(`📦 Components: ${layoutConfig.components.length}`);

                layoutConfig.components.forEach((component, index) => {
                    const pos = component.position;
                    console.log(`  ${index + 1}. ${component.type} - Row ${pos.row}, Col ${pos.col} (${pos.rowSpan || 1}×${pos.colSpan || 1})`);
                });
            } catch (error) {
                console.error(`❌ Error loading layout '${layoutName}': ${error.message}`);
            }
        } else {
            const layouts = this.getAvailableLayouts();
            console.log(`\n📐 Available Layouts (${layouts.length}):`);

            layouts.forEach(layoutName => {
                try {
                    const layoutConfig = this.loadLayout(layoutName);
                    console.log(`  • ${layoutName}: ${layoutConfig.name} - ${layoutConfig.description}`);
                } catch (error) {
                    console.log(`  • ${layoutName}: [Error loading]`);
                }
            });
        }
    }
}

// CLI functionality
async function main() {
    const args = process.argv.slice(2);
    const generator = new FlexibleDashboardGenerator({
        mockData: args.includes('--mock')
    });

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Flexible Kindle Dashboard Generator

Usage:
  node generate-flexible-dashboard.js [options] [layout]

Arguments:
  layout              Layout name (default: 'default')

Options:
  --list              List available layouts
  --info [layout]     Show layout information
  --all               Generate all layouts
  --grid              Show debug grid
  --test              Add timestamp to filename
  --mock              Use mock device data (no SSH)
  --help, -h          Show this help

Examples:
  node generate-flexible-dashboard.js                    # Generate default layout
  node generate-flexible-dashboard.js compact            # Generate compact layout
  node generate-flexible-dashboard.js device --mock      # Generate device layout with mock data
  node generate-flexible-dashboard.js --list             # List available layouts
  node generate-flexible-dashboard.js --info split       # Show split layout info
  node generate-flexible-dashboard.js --all --test       # Generate all layouts with timestamps
  node generate-flexible-dashboard.js minimal --grid     # Generate minimal layout with debug grid
        `);
        return;
    }

    if (args.includes('--list')) {
        generator.showLayoutInfo();
        return;
    }

    if (args.includes('--info')) {
        const infoIndex = args.indexOf('--info');
        const layoutName = args[infoIndex + 1];
        generator.showLayoutInfo(layoutName);
        return;
    }

    if (args.includes('--all')) {
        const options = {
            showGrid: args.includes('--grid')
        };

        console.log('🎨 Generating all available layouts...');
        const results = await generator.generateAllLayouts(options);

        console.log('\n📊 Generation Summary:');
        results.forEach(result => {
            if (result.success) {
                console.log(`✅ ${result.layout}: ${result.outputPath}`);
            } else {
                console.log(`❌ ${result.layout}: ${result.error}`);
            }
        });
        return;
    }

    // Generate single layout
    const layoutName = args.find(arg => !arg.startsWith('--')) || 'default';
    const options = {
        showGrid: args.includes('--grid'),
        test: args.includes('--test')
    };

    try {
        const { canvas } = await generator.generateDashboard(layoutName, options);
        generator.saveDashboard(canvas, layoutName, options);
    } catch (error) {
        console.error(`❌ Generation failed: ${error.message}`);
        process.exit(1);
    }
}

// Export for use as module
module.exports = FlexibleDashboardGenerator;

// Run if called directly
if (require.main === module) {
    main();
}