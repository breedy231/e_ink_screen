#!/usr/bin/env node

const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const { format } = require('date-fns');
const config = require('./config');
const {
    roundTimeToNearest,
    getWeatherSymbol,
    truncateText,
    wrapText,
    getDailyQuote,
    batteryIcon
} = require('./render-utils');

/**
 * Flexible Dashboard Layout Engine for Kindle E-ink Display
 * Modular component system with grid-based positioning.
 *
 * Components declare their data dependencies via `static dataNeeds` and are
 * wired up once in COMPONENT_REGISTRY at the bottom of this file. Adding a
 * new component = new class with dataNeeds + one registry entry; layout
 * enrichment and service selection pick it up automatically.
 */

class GridSystem {
    constructor(width, height, options = {}) {
        this.width = width;
        this.height = height;
        this.rows = options.rows || 12;
        this.cols = options.cols || 8;
        this.margin = options.margin || 10;
        this.gap = options.gap || 5;

        // Calculate grid cell dimensions
        this.cellWidth = (this.width - (2 * this.margin) - ((this.cols - 1) * this.gap)) / this.cols;
        this.cellHeight = (this.height - (2 * this.margin) - ((this.rows - 1) * this.gap)) / this.rows;
    }

    /**
     * Convert grid coordinates to pixel coordinates
     */
    gridToPixels(row, col, rowSpan = 1, colSpan = 1) {
        const x = this.margin + (col * (this.cellWidth + this.gap));
        const y = this.margin + (row * (this.cellHeight + this.gap));
        const width = (colSpan * this.cellWidth) + ((colSpan - 1) * this.gap);
        const height = (rowSpan * this.cellHeight) + ((rowSpan - 1) * this.gap);

        return { x, y, width, height };
    }

    /**
     * Draw grid lines for debugging/testing
     */
    drawDebugGrid(ctx) {
        ctx.strokeStyle = '#E0E0E0';
        ctx.lineWidth = 0.5;

        // Vertical lines
        for (let col = 0; col <= this.cols; col++) {
            const x = this.margin + (col * (this.cellWidth + this.gap)) - (this.gap / 2);
            ctx.beginPath();
            ctx.moveTo(x, this.margin);
            ctx.lineTo(x, this.height - this.margin);
            ctx.stroke();
        }

        // Horizontal lines
        for (let row = 0; row <= this.rows; row++) {
            const y = this.margin + (row * (this.cellHeight + this.gap)) - (this.gap / 2);
            ctx.beginPath();
            ctx.moveTo(this.margin, y);
            ctx.lineTo(this.width - this.margin, y);
            ctx.stroke();
        }
    }
}

class ComponentBase {
    constructor(name, config = {}) {
        this.name = name;
        this.config = {
            backgroundColor: config.backgroundColor || 'transparent',
            textColor: config.textColor || '#000000',
            borderColor: config.borderColor || null,
            borderWidth: config.borderWidth || 0,
            padding: config.padding || 5,
            fontSize: config.fontSize || 16,
            fontFamily: config.fontFamily || 'sans-serif',
            fontWeight: config.fontWeight || 'normal',
            textAlign: config.textAlign || 'left',
            ...config
        };
    }

    /**
     * Draw component background and border
     */
    drawContainer(ctx, bounds) {
        const { x, y, width, height } = bounds;
        const radius = this.config.borderRadius || 0;

        if (radius > 0) {
            // Rounded rectangle path
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + width - radius, y);
            ctx.arcTo(x + width, y, x + width, y + radius, radius);
            ctx.lineTo(x + width, y + height - radius);
            ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
            ctx.lineTo(x + radius, y + height);
            ctx.arcTo(x, y + height, x, y + height - radius, radius);
            ctx.lineTo(x, y + radius);
            ctx.arcTo(x, y, x + radius, y, radius);
            ctx.closePath();

            if (this.config.backgroundColor !== 'transparent') {
                ctx.fillStyle = this.config.backgroundColor;
                ctx.fill();
            }
            if (this.config.borderColor && this.config.borderWidth > 0) {
                ctx.strokeStyle = this.config.borderColor;
                ctx.lineWidth = this.config.borderWidth;
                ctx.stroke();
            }
        } else {
            // Sharp rectangle (original)
            if (this.config.backgroundColor !== 'transparent') {
                ctx.fillStyle = this.config.backgroundColor;
                ctx.fillRect(x, y, width, height);
            }
            if (this.config.borderColor && this.config.borderWidth > 0) {
                ctx.strokeStyle = this.config.borderColor;
                ctx.lineWidth = this.config.borderWidth;
                ctx.strokeRect(x, y, width, height);
            }
        }
    }

    /**
     * Set text style based on component config
     */
    setTextStyle(ctx) {
        ctx.fillStyle = this.config.textColor;
        ctx.font = `${this.config.fontWeight} ${this.config.fontSize}px ${this.config.fontFamily}`;
        ctx.textAlign = this.config.textAlign;
        ctx.textBaseline = 'top';  // Use top baseline for more predictable positioning
    }

    /**
     * Get content bounds (accounting for padding)
     */
    getContentBounds(bounds) {
        const padding = this.config.padding;
        return {
            x: bounds.x + padding,
            y: bounds.y + padding,
            width: bounds.width - (2 * padding),
            height: bounds.height - (2 * padding)
        };
    }

    /**
     * X coordinate matching this component's textAlign setting
     */
    getTextX(contentBounds) {
        if (this.config.textAlign === 'left') return contentBounds.x;
        if (this.config.textAlign === 'right') return contentBounds.x + contentBounds.width;
        return contentBounds.x + contentBounds.width / 2;
    }

    /**
     * Abstract render method - must be implemented by subclasses
     */
    render(ctx, bounds) {
        throw new Error(`Component ${this.name} must implement render() method`);
    }
}

class ClockComponent extends ComponentBase {
    // Data this component needs injected (see enrichLayoutWithData)
    static dataNeeds = [];

    constructor(config = {}) {
        super('clock', {
            fontSize: 72,
            fontWeight: 'bold',
            textAlign: 'center',
            format: config.format || 'HH:mm',
            showSeconds: config.showSeconds || false,
            secondsSize: config.secondsSize || 0.5,
            ...config
        });
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        const now = roundTimeToNearest(new Date(), 15);
        const timeStr = format(now, this.config.format);

        this.setTextStyle(ctx);

        // Calculate centered positioning with top baseline
        const timeHeight = this.config.fontSize;
        const secondsHeight = this.config.showSeconds ? Math.round(timeHeight * this.config.secondsSize) : 0;
        const totalHeight = timeHeight + (this.config.showSeconds ? secondsHeight + 10 : 0);

        // Center the text block vertically
        const startY = contentBounds.y + (contentBounds.height - totalHeight) / 2;

        // Main time
        const textX = this.getTextX(contentBounds);
        ctx.fillText(timeStr, textX, startY);

        // Seconds if enabled
        if (this.config.showSeconds) {
            const secondsStr = format(now, 'ss');
            const originalSize = this.config.fontSize;

            ctx.font = `${this.config.fontWeight} ${Math.round(originalSize * this.config.secondsSize)}px ${this.config.fontFamily}`;
            const secondsY = startY + timeHeight + 10;
            ctx.fillText(secondsStr, textX, secondsY);
        }
    }
}

class DateComponent extends ComponentBase {
    // Data this component needs injected (see enrichLayoutWithData)
    static dataNeeds = [];

    constructor(config = {}) {
        super('date', {
            fontSize: 24,
            fontWeight: 'normal',
            textAlign: 'center',
            dayFormat: config.dayFormat || 'EEEE',
            dateFormat: config.dateFormat || 'MMMM do, yyyy',
            showDayOfYear: config.showDayOfYear || false,
            ...config
        });
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        const now = new Date();
        this.setTextStyle(ctx);

        const lineHeight = this.config.fontSize * 1.2;
        let currentY = contentBounds.y;
        const textX = this.getTextX(contentBounds);

        // Day of week (skip if empty)
        if (this.config.dayFormat) {
            const dayStr = format(now, this.config.dayFormat);
            ctx.fillText(dayStr, textX, currentY);
            currentY += lineHeight;
        }

        // Full date
        const dateStr = format(now, this.config.dateFormat);
        ctx.fillText(dateStr, textX, currentY);

        // Day of year if enabled
        if (this.config.showDayOfYear) {
            currentY += lineHeight;
            const dayOfYear = format(now, 'DDD');
            const weekOfYear = format(now, 'ww');
            const extraInfo = `Day ${dayOfYear} • Week ${weekOfYear}`;

            const originalSize = this.config.fontSize;
            ctx.font = `${this.config.fontWeight} ${Math.round(originalSize * 0.7)}px ${this.config.fontFamily}`;
            ctx.fillText(extraInfo, textX, currentY);
        }
    }
}

class StatsComponent extends ComponentBase {
    // Data this component needs injected (see enrichLayoutWithData)
    static dataNeeds = [];

    constructor(config = {}) {
        super('stats', {
            fontSize: 16,
            fontWeight: 'normal',
            textAlign: 'left',
            title: config.title || 'SYSTEM STATUS',
            titleSize: config.titleSize || 1.5,
            showGenerated: config.showGenerated !== false,
            showResolution: config.showResolution !== false,
            showTimezone: config.showTimezone !== false,
            customStats: config.customStats || [],
            ...config
        });
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        this.setTextStyle(ctx);

        let currentY = contentBounds.y;
        const lineHeight = this.config.fontSize * 1.3;

        // Title
        const originalSize = this.config.fontSize;
        ctx.font = `bold ${Math.round(originalSize * this.config.titleSize)}px ${this.config.fontFamily}`;
        ctx.fillText(this.config.title, contentBounds.x, currentY);

        // Reset font for stats
        ctx.font = `${this.config.fontWeight} ${originalSize}px ${this.config.fontFamily}`;
        currentY += Math.round(originalSize * this.config.titleSize) + 10;

        const now = new Date();
        const stats = [];

        if (this.config.showGenerated) {
            stats.push(`Generated: ${format(now, 'HH:mm:ss')}`);
        }

        if (this.config.showTimezone) {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop();
            stats.push(`Timezone: ${timezone}`);
        }

        if (this.config.showResolution) {
            stats.push(`Resolution: 600x800px`);
            stats.push(`Format: Grayscale PNG`);
        }

        // Add custom stats
        stats.push(...this.config.customStats);

        // Render stats
        stats.forEach(stat => {
            ctx.fillText(stat, contentBounds.x, currentY);
            currentY += lineHeight;
        });
    }
}

class DeviceStatsComponent extends ComponentBase {
    // Data this component needs injected (see enrichLayoutWithData)
    static dataNeeds = ['deviceStats'];

    constructor(config = {}) {
        super('device-stats', {
            fontSize: 16,
            fontWeight: 'normal',
            textAlign: 'left',
            title: config.title || 'DEVICE STATUS',
            titleSize: config.titleSize || 1.5,
            showBattery: config.showBattery !== false,
            showTemperature: config.showTemperature !== false,
            showWifi: config.showWifi !== false,
            showMemory: config.showMemory !== false,
            showUptime: config.showUptime !== false,
            showLastUpdate: config.showLastUpdate !== false,
            deviceStats: config.deviceStats || null, // Device stats data
            ...config
        });
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        this.setTextStyle(ctx);

        let currentY = contentBounds.y;
        const lineHeight = this.config.fontSize * 1.3;

        // Title (skip if titleSize is 0 or title is empty)
        const originalSize = this.config.fontSize;
        if (this.config.titleSize > 0 && this.config.title) {
            ctx.font = `bold ${Math.round(originalSize * this.config.titleSize)}px ${this.config.fontFamily}`;
            ctx.fillText(this.config.title, contentBounds.x, currentY);
            currentY += Math.round(originalSize * this.config.titleSize) + 10;
        }

        // Reset font for stats
        ctx.font = `${this.config.fontWeight} ${originalSize}px ${this.config.fontFamily}`;

        const stats = [];

        // If we have device stats data, use it
        if (this.config.deviceStats) {
            const deviceStats = this.config.deviceStats;

            // Battery information
            if (this.config.showBattery && deviceStats.battery) {
                if (deviceStats.battery.level !== 'unknown') {
                    stats.push(`Battery: ${deviceStats.battery.level}%`);
                }
                if (deviceStats.battery.voltage !== 'unknown') {
                    stats.push(`Voltage: ${deviceStats.battery.voltage}V`);
                }
            }

            // Temperature
            if (this.config.showTemperature && deviceStats.temperature && deviceStats.temperature !== 'unknown') {
                stats.push(`Temperature: ${deviceStats.temperature}°C`);
            }

            // System info
            if (deviceStats.system) {
                if (this.config.showUptime && deviceStats.system.uptime_hours !== 'unknown') {
                    stats.push(`Uptime: ${deviceStats.system.uptime_hours}h`);
                }
                if (this.config.showMemory && deviceStats.system.memory_usage_percent !== 'unknown') {
                    stats.push(`Memory: ${deviceStats.system.memory_usage_percent}%`);
                }
            }

            // WiFi info
            if (this.config.showWifi && deviceStats.wifi) {
                if (deviceStats.wifi.status !== 'unknown') {
                    let wifiText = `WiFi: ${deviceStats.wifi.status}`;
                    if (deviceStats.wifi.network && deviceStats.wifi.network !== 'unknown' && deviceStats.wifi.network !== 'none') {
                        wifiText += ` (${deviceStats.wifi.network})`;
                    }
                    stats.push(wifiText);
                }
            }

            // Last update
            if (this.config.showLastUpdate && deviceStats.dashboard && deviceStats.dashboard.last_update && deviceStats.dashboard.last_update !== 'unknown') {
                stats.push(`Updated: ${deviceStats.dashboard.last_update}`);
            }
        } else {
            // Fallback: show that stats are unavailable
            stats.push('Device stats unavailable');
            stats.push('Enable SSH or run locally');
        }

        // Render stats
        stats.forEach(stat => {
            ctx.fillText(stat, contentBounds.x, currentY);
            currentY += lineHeight;
        });
    }
}

class QuoteComponent extends ComponentBase {
    // Data this component needs injected (see enrichLayoutWithData)
    static dataNeeds = [];

    constructor(config = {}) {
        super('quote', {
            fontSize: 13,
            fontWeight: 'normal',
            textAlign: 'left',
            textColor: config.textColor || '#444444',
            ...config
        });
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        const quote = getDailyQuote();
        const originalSize = this.config.fontSize;
        const lineHeight = originalSize * 1.4;

        ctx.fillStyle = this.config.textColor;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';

        // Quote text (italic)
        ctx.font = `${this.config.fontWeight} italic ${originalSize}px ${this.config.fontFamily}`;
        const lines = wrapText(ctx, quote.text, contentBounds.width);

        let y = contentBounds.y;
        lines.forEach((line, i) => {
            const prefix = i === 0 ? '"' : '';
            const suffix = i === lines.length - 1 ? '"' : '';
            ctx.fillText(`${prefix}${line}${suffix}`, contentBounds.x, y);
            y += lineHeight;
        });

        // Attribution
        ctx.font = `${originalSize * 0.9}px ${this.config.fontFamily}`;
        const attribution = quote.source ? `— ${quote.author}, ${quote.source}` : `— ${quote.author}`;
        ctx.fillText(attribution, contentBounds.x, y);
    }
}

class StatusBarComponent extends ComponentBase {
    // Data this component needs injected (see enrichLayoutWithData)
    static dataNeeds = ['deviceStats'];

    constructor(config = {}) {
        super('status-bar', {
            fontSize: 11,
            fontWeight: 'normal',
            textAlign: 'left',
            textColor: config.textColor || '#888888',
            deviceStats: config.deviceStats || null,
            ...config
        });
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        const originalSize = this.config.fontSize;
        ctx.font = `${this.config.fontWeight} ${originalSize}px ${this.config.fontFamily}`;
        ctx.fillStyle = this.config.textColor;
        ctx.textBaseline = 'top';

        const parts = [];
        const ds = this.config.deviceStats;

        // Battery with level indicator
        if (ds && ds.battery && ds.battery.level !== 'unknown') {
            const level = parseInt(ds.battery.level);
            parts.push(`${batteryIcon(level)} ${level}%`);
        }

        // WiFi status
        if (ds && ds.wifi && ds.wifi.status !== 'unknown') {
            const connected = ds.wifi.status === 'connected';
            parts.push(connected ? 'WiFi ✓' : 'WiFi ✗');
        }

        // Generated timestamp
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: config.TIMEZONE
        });
        parts.push(`Updated ${timeStr}`);

        const line = parts.join('  ·  ');

        // Center the status bar
        ctx.textAlign = 'center';
        ctx.fillText(line, contentBounds.x + contentBounds.width / 2, contentBounds.y);
    }
}

class WeatherComponent extends ComponentBase {
    // Data this component needs injected (see enrichLayoutWithData)
    static dataNeeds = ['weather'];

    constructor(config = {}) {
        super('weather', {
            fontSize: 16,
            fontWeight: 'normal',
            textAlign: 'left',
            title: config.title || 'WEATHER',
            titleSize: config.titleSize || 1.5,
            showCurrent: config.showCurrent !== false,
            showForecast: config.showForecast !== false,
            showWind: config.showWind !== false,
            showHumidity: config.showHumidity !== false,
            forecastDays: config.forecastDays || 3,
            weatherData: config.weatherData || null,
            ...config
        });
    }

    getWeatherSymbol(iconType) {
        return getWeatherSymbol(iconType);
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        this.setTextStyle(ctx);

        let currentY = contentBounds.y;
        const lineHeight = this.config.fontSize * 1.3;

        // Title (skip if titleSize is 0 or title is empty)
        const originalSize = this.config.fontSize;
        if (this.config.titleSize > 0 && this.config.title) {
            ctx.font = `bold ${Math.round(originalSize * this.config.titleSize)}px ${this.config.fontFamily}`;
            ctx.fillText(this.config.title, contentBounds.x, currentY);
            currentY += Math.round(originalSize * this.config.titleSize) + 10;
        }

        // Reset font for weather info
        ctx.font = `${this.config.fontWeight} ${originalSize}px ${this.config.fontFamily}`;

        if (!this.config.weatherData) {
            ctx.fillText('Weather data unavailable', contentBounds.x, currentY);
            return;
        }

        const weather = this.config.weatherData;

        // Current weather
        if (this.config.showCurrent && weather.current) {
            const current = weather.current;

            if (this.config.inline) {
                // Inline mode: single horizontal line
                const weatherSymbol = this.getWeatherSymbol(current.icon);
                let parts = [`${weatherSymbol} ${current.temperature} ${current.condition}`];
                if (this.config.showWind && current.windSpeed) parts.push(`Wind ${current.windSpeed}`);
                if (this.config.showHumidity && current.humidity) parts.push(`Humidity ${current.humidity}`);
                const inlineText = parts.join(' · ');

                ctx.font = `${this.config.fontWeight} ${originalSize}px ${this.config.fontFamily}`;
                ctx.fillText(inlineText, contentBounds.x, currentY);
                currentY += lineHeight;
            } else {
                // Temperature and condition with weather symbol
                const heroSize = this.config.heroSize || 1.2;
                ctx.font = `bold ${Math.round(originalSize * heroSize)}px ${this.config.fontFamily}`;

                // Get weather symbol
                const weatherSymbol = this.getWeatherSymbol(current.icon);
                ctx.fillText(`${weatherSymbol} ${current.temperature}`, contentBounds.x, currentY);

                // Condition on same line
                const tempWidth = ctx.measureText(`${weatherSymbol} ${current.temperature}`).width;
                ctx.font = `${this.config.fontWeight} ${originalSize}px ${this.config.fontFamily}`;
                ctx.fillText(` ${current.condition}`, contentBounds.x + tempWidth + 5, currentY);

                currentY += lineHeight * 1.3;

                // Wind and humidity
                if (this.config.compactDetails && this.config.showWind && this.config.showHumidity && current.windSpeed && current.humidity) {
                    ctx.fillText(`Wind ${current.windSpeed} · Humidity ${current.humidity}`, contentBounds.x, currentY);
                    currentY += lineHeight;
                } else {
                    if (this.config.showWind && current.windSpeed) {
                        ctx.fillText(`Wind: ${current.windSpeed}`, contentBounds.x, currentY);
                        currentY += lineHeight;
                    }

                    if (this.config.showHumidity && current.humidity) {
                        ctx.fillText(`Humidity: ${current.humidity}`, contentBounds.x, currentY);
                        currentY += lineHeight;
                    }
                }

                currentY += 5; // Extra spacing
            }
        }

        // Forecast
        if (this.config.showForecast && weather.forecast && weather.forecast.length > 0) {
            const maxDays = Math.min(this.config.forecastDays, weather.forecast.length);

            if (this.config.forecastColumns) {
                // Horizontal column layout — one column per day
                const gap = 10;
                const colWidth = (contentBounds.width - gap * (maxDays - 1)) / maxDays;
                const forecastSize = this.config.forecastSize || 0.9;

                for (let i = 0; i < maxDays; i++) {
                    const day = weather.forecast[i];
                    const colX = contentBounds.x + i * (colWidth + gap);
                    let colY = currentY;

                    // Day name (bold)
                    const dayName = day.date.split(',')[0]; // "Tue"
                    ctx.font = `bold ${Math.round(originalSize * forecastSize)}px ${this.config.fontFamily}`;
                    ctx.fillText(dayName, colX, colY);
                    colY += lineHeight * 0.9;

                    // Temp + icon
                    const symbol = day.icon ? this.getWeatherSymbol(day.icon) : '';
                    ctx.font = `${this.config.fontWeight} ${Math.round(originalSize * forecastSize)}px ${this.config.fontFamily}`;
                    ctx.fillText(`${day.highTemp}/${day.lowTemp} ${symbol}`, colX, colY);
                    colY += lineHeight * 0.9;

                    // Condition
                    ctx.font = `${this.config.fontWeight} ${Math.round(originalSize * forecastSize * 0.85)}px ${this.config.fontFamily}`;
                    ctx.fillText(truncateText(ctx, day.condition, colWidth), colX, colY);
                }
            } else {
                // Vertical list layout (original)
                if (this.config.showForecastLabel !== false) {
                    ctx.font = `bold ${Math.round(originalSize * 1.1)}px ${this.config.fontFamily}`;
                    ctx.fillText('Forecast:', contentBounds.x, currentY);
                    currentY += lineHeight;
                }

                const forecastMultiplier = this.config.forecastSize || 0.9;
                ctx.font = `${this.config.fontWeight} ${Math.round(originalSize * forecastMultiplier)}px ${this.config.fontFamily}`;

                for (let i = 0; i < maxDays; i++) {
                    const day = weather.forecast[i];
                    const forecastSymbol = day.icon ? ` ${this.getWeatherSymbol(day.icon)}` : '';
                    const forecastText = `${day.date}: ${day.highTemp}/${day.lowTemp}${forecastSymbol} ${day.condition}`;
                    ctx.fillText(forecastText, contentBounds.x, currentY);
                    currentY += lineHeight * (this.config.forecastSize || 0.9);
                }
            }
        }

        // Source info (for debugging, hidden by default with showSource: false)
        if (weather.source && this.config.showSource !== false) {
            currentY += 5;
            ctx.font = `${this.config.fontWeight} ${Math.round(originalSize * 0.8)}px ${this.config.fontFamily}`;
            ctx.fillText(`Source: ${weather.source}`, contentBounds.x, currentY);
        }
    }
}

class TitleComponent extends ComponentBase {
    // Data this component needs injected (see enrichLayoutWithData)
    static dataNeeds = [];

    constructor(config = {}) {
        super('title', {
            fontSize: 32,
            fontWeight: 'bold',
            textAlign: 'center',
            text: config.text || 'E-INK DASHBOARD',
            ...config
        });
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        this.setTextStyle(ctx);

        // Center text vertically using top baseline
        const textY = contentBounds.y + (contentBounds.height - this.config.fontSize) / 2;
        ctx.fillText(this.config.text, contentBounds.x + contentBounds.width / 2, textY);
    }
}

class PokemonSpriteComponent extends ComponentBase {
    // Data this component needs injected (see enrichLayoutWithData)
    static dataNeeds = ['pokemon'];

    constructor(config = {}) {
        super('pokemon-sprite', {
            fontSize: 14,
            fontWeight: 'normal',
            textAlign: 'center',
            showNumber: config.showNumber !== false,
            showName: config.showName || false,
            pokemonData: config.pokemonData || null,
            spriteSize: config.spriteSize || 0.85, // 85% of available space
            ...config
        });
    }

    async render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        if (!this.config.pokemonData || !this.config.pokemonData.spritePath) {
            // No sprite available - show placeholder
            this.setTextStyle(ctx);
            ctx.textAlign = 'center';
            ctx.fillText('Pokemon', contentBounds.x + contentBounds.width / 2, contentBounds.y + contentBounds.height / 2);
            return;
        }

        const pokemon = this.config.pokemonData;

        try {
            // Load sprite image
            const image = await loadImage(pokemon.spritePath);

            // Calculate sprite dimensions (maintain aspect ratio)
            const maxSpriteSize = Math.min(contentBounds.width, contentBounds.height) * this.config.spriteSize;
            const aspectRatio = image.width / image.height;

            let spriteWidth, spriteHeight;
            if (aspectRatio > 1) {
                spriteWidth = maxSpriteSize;
                spriteHeight = maxSpriteSize / aspectRatio;
            } else {
                spriteHeight = maxSpriteSize;
                spriteWidth = maxSpriteSize * aspectRatio;
            }

            // Center sprite horizontally
            const spriteX = contentBounds.x + (contentBounds.width - spriteWidth) / 2;

            // Position sprite at top of content area, leave room for label below
            const labelGap = 3; // Minimal gap between sprite and label
            const labelHeight = this.config.showNumber || this.config.showName ? this.config.fontSize + labelGap : 0;
            const availableHeight = contentBounds.height - labelHeight;
            const spriteY = contentBounds.y + (availableHeight - spriteHeight) / 2;

            // Draw sprite
            ctx.drawImage(image, spriteX, spriteY, spriteWidth, spriteHeight);

            // Draw Pokemon name and number directly below sprite
            if (this.config.showNumber || this.config.showName) {
                this.setTextStyle(ctx);
                ctx.textAlign = 'center';

                // Position label right below sprite with minimal gap
                const labelY = spriteY + spriteHeight + labelGap;
                const labelX = contentBounds.x + contentBounds.width / 2;

                let labelText = '';
                if (this.config.showName && this.config.showNumber && pokemon.name) {
                    labelText = `#${pokemon.id} ${pokemon.name}`;
                } else if (this.config.showName && pokemon.name) {
                    labelText = pokemon.name;
                } else if (this.config.showNumber) {
                    labelText = `#${pokemon.id}`;
                }

                ctx.fillText(labelText, labelX, labelY);
            }
        } catch (error) {
            console.warn(`Failed to render Pokemon sprite: ${error.message}`);

            // Fallback: show text
            this.setTextStyle(ctx);
            ctx.textAlign = 'center';
            const textY = contentBounds.y + contentBounds.height / 2;
            ctx.fillText(`#${pokemon.id}`, contentBounds.x + contentBounds.width / 2, textY);
        }
    }
}

class TrmnlComponent extends ComponentBase {
    // Data this component needs injected (see enrichLayoutWithData)
    static dataNeeds = ['trmnl'];

    constructor(config = {}) {
        super('trmnl', {
            fontSize: 16,
            textAlign: 'center',
            trmnlData: config.trmnlData || null,
            rotation: config.rotation || null, // 'cw' | 'ccw' | 'none'; falls back to server config.TRMNL_ROTATION in render()
            ...config
        });
    }

    /**
     * TRMNL screens are landscape (e.g. 800x480); this canvas is portrait
     * (600x800). Rotate 90deg into portrait, then scale-to-fit so any
     * source resolution pillarboxes cleanly instead of assuming 800x480.
     *
     * 'none' skips the rotation and letterboxes the landscape screen upright
     * in the middle of the portrait canvas. That trades size for legibility:
     * an 800x480 screen lands at 600x360, using under half the display, but
     * it reads without tilting the Kindle. Rotating fills the screen at the
     * cost of the content being genuinely sideways — which is inherent to
     * landscape TRMNL markup on a portrait panel. Choosing a "portrait" BYOS
     * device model does not fix it: BYOS renders the markup landscape and
     * then rotates the bitmap (verified against amazon_kindle_7).
     */
    async render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        if (!this.config.trmnlData || !this.config.trmnlData.imagePath) {
            this.setTextStyle(ctx);
            ctx.textAlign = 'center';
            ctx.fillText('TRMNL unavailable', contentBounds.x + contentBounds.width / 2, contentBounds.y + contentBounds.height / 2);
            return;
        }

        try {
            const image = await loadImage(this.config.trmnlData.imagePath);

            const rotation = this.config.rotation || config.TRMNL_ROTATION;

            // Fit the footprint the image will actually occupy: unrotated
            // that's (width x height), rotated 90deg it's (height x width).
            const footprintWidth = rotation === 'none' ? image.width : image.height;
            const footprintHeight = rotation === 'none' ? image.height : image.width;
            const scale = Math.min(contentBounds.width / footprintWidth, contentBounds.height / footprintHeight);
            const drawWidth = image.width * scale;
            const drawHeight = image.height * scale;

            const centerX = contentBounds.x + contentBounds.width / 2;
            const centerY = contentBounds.y + contentBounds.height / 2;

            ctx.save();
            ctx.translate(centerX, centerY);
            if (rotation !== 'none') {
                ctx.rotate((rotation === 'ccw' ? -1 : 1) * Math.PI / 2);
            }
            ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
            ctx.restore();
        } catch (error) {
            console.warn(`Failed to render TRMNL screen: ${error.message}`);

            this.setTextStyle(ctx);
            ctx.textAlign = 'center';
            ctx.fillText('TRMNL render error', contentBounds.x + contentBounds.width / 2, contentBounds.y + contentBounds.height / 2);
        }
    }
}

class CalendarComponent extends ComponentBase {
    // Data this component needs injected (see enrichLayoutWithData)
    static dataNeeds = ['calendar'];

    constructor(config = {}) {
        super('calendar', {
            fontSize: 13,
            fontWeight: 'normal',
            textAlign: 'left',
            maxEventsPerDay: config.maxEventsPerDay || 4,
            showUpcoming: config.showUpcoming !== false,
            calendarData: config.calendarData || null,
            sectionHeaderSize: config.sectionHeaderSize || 1.1,
            columnGap: config.columnGap || 12,
            ...config
        });
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        this.setTextStyle(ctx);

        const originalSize = this.config.fontSize;
        const lineHeight = originalSize * 1.4;

        if (!this.config.calendarData) {
            ctx.fillText('Calendar unavailable', contentBounds.x, contentBounds.y);
            return;
        }

        const cal = this.config.calendarData;
        const gap = this.config.columnGap;
        const showUpcoming = this.config.showUpcoming !== false;
        const numCols = showUpcoming ? 3 : 2;
        const colWidth = (contentBounds.width - gap * (numCols - 1)) / numCols;

        const columns = [
            { title: 'TODAY', events: cal.today || [], x: contentBounds.x },
            { title: 'TOMORROW', events: cal.tomorrow || [], x: contentBounds.x + colWidth + gap }
        ];

        if (showUpcoming) {
            columns.push({ title: 'COMING UP', events: cal.upcoming || [], x: contentBounds.x + (colWidth + gap) * 2 });
        }

        for (const col of columns) {
            let y = contentBounds.y;
            const colMaxX = col.x + colWidth;

            // Section header
            ctx.font = `bold ${Math.round(originalSize * this.config.sectionHeaderSize)}px ${this.config.fontFamily}`;
            ctx.fillStyle = this.config.textColor;
            ctx.fillText(col.title, col.x, y);
            y += lineHeight * 1.1;

            ctx.font = `${this.config.fontWeight} ${originalSize}px ${this.config.fontFamily}`;

            if (col.events.length === 0) {
                ctx.fillStyle = '#888888';
                ctx.fillText('No events', col.x, y);
                ctx.fillStyle = this.config.textColor;
                continue;
            }

            const maxEvents = Math.min(this.config.maxEventsPerDay, col.events.length);
            for (let i = 0; i < maxEvents; i++) {
                y = this.renderEvent(ctx, col.events[i], col.x, y, colMaxX, originalSize);
            }

            if (col.events.length > maxEvents) {
                ctx.font = `${this.config.fontWeight} ${Math.round(originalSize * 0.85)}px ${this.config.fontFamily}`;
                ctx.fillStyle = '#888888';
                ctx.fillText(`+${col.events.length - maxEvents} more`, col.x, y);
                ctx.fillStyle = this.config.textColor;
            }
        }
    }

    renderEvent(ctx, event, x, y, maxX, fontSize) {
        const lineHeight = fontSize * 1.4;
        const availableWidth = maxX - x;

        // Time on its own line (bold)
        ctx.font = `bold ${fontSize}px ${this.config.fontFamily}`;
        ctx.fillStyle = this.config.textColor;
        let timeText = event.time;
        if (event.timeSuffix) {
            timeText += ` ${event.timeSuffix}`;
        }
        ctx.fillText(timeText, x, y);
        y += lineHeight * 0.9;

        // Event name below (normal, truncated if needed)
        ctx.font = `${this.config.fontWeight} ${fontSize}px ${this.config.fontFamily}`;
        ctx.fillText(truncateText(ctx, event.name, availableWidth), x, y);
        y += lineHeight * 1.1;

        return y;
    }
}

class SwissPosterComponent extends ComponentBase {
    // Data this component needs injected (see enrichLayoutWithData)
    static dataNeeds = ['weather', 'calendar', 'pokemon', 'deviceStats'];

    constructor(config = {}) {
        super('swiss-poster', {
            weatherData: config.weatherData || null,
            calendarData: config.calendarData || null,
            pokemonData: config.pokemonData || null,
            ...config
        });
    }

    async render(ctx, bounds) {
        const cb = this.getContentBounds(bounds);
        const w = cb.width;
        const h = cb.height;
        const x = cb.x;
        const y = cb.y;

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(x, y, w, h);

        const nowRaw = new Date();
        const now = roundTimeToNearest(nowRaw, 15);

        // === TOP ZONE: Thick rule + time + date ===
        ctx.fillStyle = '#000000';
        ctx.fillRect(x, y, w, 6);

        // Time — left-aligned with AM/PM inline (rounded to the 15-min boundary)
        ctx.font = 'bold 72px sans-serif';
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const timeText = format(now, 'h:mm');
        ctx.fillText(timeText, x, y + 16);
        const timeWidth = ctx.measureText(timeText).width;
        ctx.font = '24px sans-serif';
        ctx.fillText(format(now, 'a').toUpperCase(), x + timeWidth + 8, y + 52);

        // Date — right-aligned, stacked
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(format(now, 'EEEE'), x + w, y + 24);
        ctx.font = '16px sans-serif';
        ctx.fillText(format(now, 'MMMM do, yyyy'), x + w, y + 48);

        // === Thick rule ===
        const rule1 = y + 102;
        ctx.fillStyle = '#000000';
        ctx.fillRect(x, rule1, w, 4);

        // === WEATHER ZONE ===
        const temp = (this.config.weatherData && this.config.weatherData.current)
            ? this.config.weatherData.current.temperature || '--°'
            : '--°';

        ctx.font = 'bold 100px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(temp, x, rule1 + 10);

        // Vertical divider
        const divX = x + w * 0.5;
        ctx.fillRect(divX, rule1 + 8, 2, 105);

        // Condition + details right of divider
        const rightCol = divX + 14;
        if (this.config.weatherData && this.config.weatherData.current) {
            const cur = this.config.weatherData.current;
            ctx.font = 'bold 22px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText((cur.condition || '').toUpperCase(), rightCol, rule1 + 14);

            ctx.font = '15px sans-serif';
            let detailY = rule1 + 44;
            if (cur.windSpeed) { ctx.fillText(`Wind ${cur.windSpeed}`, rightCol, detailY); detailY += 20; }
            if (cur.humidity) { ctx.fillText(`Humidity ${cur.humidity}`, rightCol, detailY); detailY += 20; }
        }

        // === Thin rule ===
        const rule2 = rule1 + 120;
        ctx.fillRect(x, rule2, w, 1);

        // === FORECAST: Three ruled columns with weather symbols ===
        const fy = rule2 + 10;
        if (this.config.weatherData && this.config.weatherData.forecast) {
            const forecast = this.config.weatherData.forecast;
            const colW = w / 3;

            for (let i = 0; i < Math.min(3, forecast.length); i++) {
                const fx = x + i * colW;
                const pad = i > 0 ? 10 : 0;
                if (i > 0) {
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(fx, fy - 2, 1, 62);
                }
                const symbol = forecast[i].icon ? getWeatherSymbol(forecast[i].icon) : '';
                ctx.font = 'bold 15px sans-serif';
                ctx.fillStyle = '#000000';
                ctx.textAlign = 'left';
                ctx.fillText(forecast[i].date.split(',')[0].toUpperCase(), fx + pad, fy);
                ctx.font = '15px sans-serif';
                ctx.fillText(`${forecast[i].highTemp}/${forecast[i].lowTemp} ${symbol}`, fx + pad, fy + 20);
                ctx.font = '13px sans-serif';
                ctx.fillText(truncateText(ctx, forecast[i].condition, colW - pad - 8), fx + pad, fy + 40);
            }
        }

        // === Thick rule before calendar ===
        const rule3 = fy + 68;
        ctx.fillStyle = '#000000';
        ctx.fillRect(x, rule3, w, 4);

        // === CALENDAR ===
        const calY = rule3 + 12;
        let ty = calY;
        let ty2 = calY;
        if (this.config.calendarData) {
            const cal = this.config.calendarData;
            const halfW = w / 2;

            // Vertical divider — sized to content
            const maxEvents = Math.max((cal.today || []).length, (cal.tomorrow || []).length);
            const divHeight = Math.min(24 + maxEvents * 36, 200);
            ctx.fillRect(x + halfW - 1, calY, 1, divHeight);

            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('TODAY', x, calY);
            ctx.fillText('TOMORROW', x + halfW + 10, calY);

            ty = calY + 26;
            for (let i = 0; i < Math.min(4, (cal.today || []).length); i++) {
                const e = cal.today[i];
                ctx.font = 'bold 14px sans-serif';
                ctx.fillText(e.time, x, ty);
                ty += 17;
                ctx.font = '13px sans-serif';
                ctx.fillText(truncateText(ctx, e.name, halfW - 15), x, ty);
                ty += 19;
            }

            ty2 = calY + 26;
            for (let i = 0; i < Math.min(4, (cal.tomorrow || []).length); i++) {
                const e = cal.tomorrow[i];
                ctx.font = 'bold 14px sans-serif';
                ctx.fillText(e.time, x + halfW + 10, ty2);
                ty2 += 17;
                ctx.font = '13px sans-serif';
                ctx.fillText(truncateText(ctx, e.name, halfW - 15), x + halfW + 10, ty2);
                ty2 += 19;
            }
        }

        // === Thin rule + multi-line quote + status ===
        // Anchor quote right after calendar content ends
        const calEnd = Math.max(ty, ty2) + 16;
        // Thin rule before quote
        ctx.fillStyle = '#000000';
        ctx.fillRect(x, calEnd, w, 1);

        {
            const q = getDailyQuote(now);

            ctx.font = 'italic 14px sans-serif';
            ctx.fillStyle = '#555555';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';

            const quoteLines = wrapText(ctx, `"${q.text}"`, w);
            let qy = calEnd + 10;
            for (const line of quoteLines.slice(0, 3)) {
                ctx.fillText(line, x, qy);
                qy += 18;
            }
            ctx.font = '13px sans-serif';
            const attr = q.source ? `— ${q.author}, ${q.source}` : `— ${q.author}`;
            ctx.fillText(attr, x, qy);
        }

        // Pokemon sprite — large, in bottom whitespace, with name & number
        if (this.config.pokemonData && this.config.pokemonData.spritePath) {
            try {
                const image = await loadImage(this.config.pokemonData.spritePath);
                const spriteSize = 130;
                const spriteX = x + w - spriteSize - 10;
                const spriteY = y + h - spriteSize - 48;
                ctx.drawImage(image, spriteX, spriteY, spriteSize, spriteSize);

                // Name & number below sprite
                const pokemon = this.config.pokemonData;
                if (pokemon.name || pokemon.id) {
                    ctx.font = 'bold 15px sans-serif';
                    ctx.fillStyle = '#000000';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    const label = pokemon.name && pokemon.id
                        ? `#${pokemon.id} ${pokemon.name}`
                        : pokemon.name || `#${pokemon.id}`;
                    ctx.fillText(label, spriteX + spriteSize / 2, spriteY + spriteSize + 4);
                }
            } catch (e) { /* skip */ }
        }

        // Bottom rule + status at very bottom
        ctx.fillStyle = '#000000';
        ctx.fillRect(x, y + h - 22, w, 1);
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#AAAAAA';
        ctx.textBaseline = 'top';

        // Build status parts
        const statusParts = [];
        if (this.config.deviceStats && this.config.deviceStats.battery && this.config.deviceStats.battery.level !== 'unknown') {
            const level = parseInt(this.config.deviceStats.battery.level);
            statusParts.push(`${batteryIcon(level)} ${level}%`);
        }
        statusParts.push(`Updated ${format(nowRaw, 'h:mm a')}`);

        ctx.textAlign = 'center';
        ctx.fillText(statusParts.join('  ·  '), x + w / 2, y + h - 14);
    }
}

/**
 * Component registry — the single place a component type is wired up.
 * To add a component: write the class (with `static dataNeeds`), add one
 * entry here, and reference the type from a layout JSON. Enrichment and
 * data-service selection derive everything else from this table.
 */
const COMPONENT_REGISTRY = {
    'clock': ClockComponent,
    'date': DateComponent,
    'stats': StatsComponent,
    'device-stats': DeviceStatsComponent,
    'weather': WeatherComponent,
    'title': TitleComponent,
    'pokemon-sprite': PokemonSpriteComponent,
    'calendar': CalendarComponent,
    'swiss-poster': SwissPosterComponent,
    'status-bar': StatusBarComponent,
    'quote': QuoteComponent,
    'trmnl': TrmnlComponent
};

// Data need → the config key components receive it under
const DATA_CONFIG_KEYS = {
    weather: 'weatherData',
    pokemon: 'pokemonData',
    calendar: 'calendarData',
    deviceStats: 'deviceStats',
    trmnl: 'trmnlData'
};

/**
 * Union of data needs declared by the components a layout uses.
 * Returns a Set of need names ('weather', 'pokemon', 'calendar', 'deviceStats').
 */
function getLayoutDataNeeds(layoutConfig) {
    const needs = new Set();
    for (const item of layoutConfig.components || []) {
        const ComponentClass = COMPONENT_REGISTRY[item.type];
        if (!ComponentClass) continue;
        for (const need of ComponentClass.dataNeeds || []) {
            needs.add(need);
        }
    }
    return needs;
}

/**
 * Inject fetched data into each component's config according to its declared
 * dataNeeds. `data` is keyed by need name: { weather, pokemon, calendar, deviceStats }.
 * The single implementation shared by the HTTP server and the CLI generator.
 */
function enrichLayoutWithData(layoutConfig, data = {}) {
    const enrichedConfig = JSON.parse(JSON.stringify(layoutConfig));

    enrichedConfig.components = enrichedConfig.components.map(component => {
        const ComponentClass = COMPONENT_REGISTRY[component.type];
        const needs = (ComponentClass && ComponentClass.dataNeeds) || [];
        if (needs.length === 0) return component;

        const injected = {};
        for (const need of needs) {
            if (data[need] !== undefined && data[need] !== null) {
                injected[DATA_CONFIG_KEYS[need]] = data[need];
            }
        }

        return {
            ...component,
            config: { ...component.config, ...injected }
        };
    });

    return enrichedConfig;
}

class DashboardEngine {
    constructor(config = {}) {
        this.width = config.width || 600;
        this.height = config.height || 800;
        this.backgroundColor = config.backgroundColor || '#FFFFFF';

        // Initialize grid system
        this.grid = new GridSystem(this.width, this.height, config.grid);

        // Per-instance component map, seeded from the registry;
        // registerComponent() allows instance-local additions/overrides.
        this.components = new Map(Object.entries(COMPONENT_REGISTRY));
        this.layout = [];
    }

    /**
     * Register a component type
     */
    registerComponent(type, componentClass) {
        this.components.set(type, componentClass);
    }

    /**
     * Load layout configuration
     */
    loadLayout(layoutConfig) {
        this.layout = layoutConfig.components || [];
        this.layoutConfig = layoutConfig;

        // Update grid settings if provided
        if (layoutConfig.grid) {
            this.grid = new GridSystem(this.width, this.height, layoutConfig.grid);
        }
    }

    /**
     * Add component to layout
     */
    addComponent(type, position, config = {}) {
        this.layout.push({
            type,
            position,
            config
        });
    }

    /**
     * Create canvas and context
     */
    createCanvas() {
        const canvas = createCanvas(this.width, this.height);
        const ctx = canvas.getContext('2d');

        // E-ink optimizations
        ctx.antialias = 'gray';
        ctx.textDrawingMode = 'path';
        ctx.quality = 'best';
        ctx.textRenderingOptimization = 'optimizeQuality';

        return { canvas, ctx };
    }

    /**
     * Render complete dashboard
     */
    async render(options = {}) {
        const { canvas, ctx } = this.createCanvas();

        // Clear background
        ctx.fillStyle = this.backgroundColor;
        ctx.fillRect(0, 0, this.width, this.height);

        // Draw debug grid if requested
        if (options.showGrid) {
            this.grid.drawDebugGrid(ctx);
        }

        // Render all components (support async components)
        const renderPromises = this.layout.map(async item => {
            const ComponentClass = this.components.get(item.type);
            if (!ComponentClass) {
                console.warn(`Unknown component type: ${item.type}`);
                return;
            }

            const component = new ComponentClass(item.config);
            const bounds = this.grid.gridToPixels(
                item.position.row,
                item.position.col,
                item.position.rowSpan || 1,
                item.position.colSpan || 1
            );

            await component.render(ctx, bounds);
        });

        await Promise.all(renderPromises);

        // Draw separator lines if configured
        if (this.layoutConfig && this.layoutConfig.separators) {
            for (const sep of this.layoutConfig.separators) {
                ctx.strokeStyle = sep.color || '#CCCCCC';
                ctx.lineWidth = sep.width || 1;
                ctx.beginPath();
                const y = sep.row != null
                    ? this.grid.gridToPixels(sep.row, 0).y - this.grid.gap / 2
                    : sep.y;
                ctx.moveTo(this.grid.margin, y);
                ctx.lineTo(this.width - this.grid.margin, y);
                ctx.stroke();
            }
        }

        return canvas;
    }

    /**
     * Save dashboard to file
     */
    save(canvas, outputPath) {
        const buffer = canvas.toBuffer('image/png', {
            compressionLevel: 9,
            filters: canvas.PNG_FILTER_NONE
        });

        fs.writeFileSync(outputPath, buffer);
        return outputPath;
    }
}

module.exports = {
    DashboardEngine,
    GridSystem,
    ComponentBase,
    COMPONENT_REGISTRY,
    getLayoutDataNeeds,
    enrichLayoutWithData,
    ClockComponent,
    DateComponent,
    StatsComponent,
    DeviceStatsComponent,
    WeatherComponent,
    TitleComponent,
    PokemonSpriteComponent,
    CalendarComponent,
    SwissPosterComponent,
    StatusBarComponent,
    QuoteComponent
};