#!/usr/bin/env node

const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');

/**
 * Flexible Dashboard Layout Engine for Kindle E-ink Display
 * Modular component system with grid-based positioning
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

        // Background
        if (this.config.backgroundColor !== 'transparent') {
            ctx.fillStyle = this.config.backgroundColor;
            ctx.fillRect(x, y, width, height);
        }

        // Border
        if (this.config.borderColor && this.config.borderWidth > 0) {
            ctx.strokeStyle = this.config.borderColor;
            ctx.lineWidth = this.config.borderWidth;
            ctx.strokeRect(x, y, width, height);
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
     * Abstract render method - must be implemented by subclasses
     */
    render(ctx, bounds) {
        throw new Error(`Component ${this.name} must implement render() method`);
    }
}

class ClockComponent extends ComponentBase {
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

    getTextX(contentBounds) {
        if (this.config.textAlign === 'left') return contentBounds.x;
        if (this.config.textAlign === 'right') return contentBounds.x + contentBounds.width;
        return contentBounds.x + contentBounds.width / 2;
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        const now = new Date();
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

    getTextX(contentBounds) {
        if (this.config.textAlign === 'left') return contentBounds.x;
        if (this.config.textAlign === 'right') return contentBounds.x + contentBounds.width;
        return contentBounds.x + contentBounds.width / 2;
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
    constructor(config = {}) {
        super('quote', {
            fontSize: 13,
            fontWeight: 'normal',
            textAlign: 'left',
            textColor: config.textColor || '#444444',
            ...config
        });
    }

    getQuote() {
        // Load quotes from external JSON file
        const quotesPath = path.join(__dirname, 'quotes.json');
        let quotes;
        try {
            quotes = JSON.parse(fs.readFileSync(quotesPath, 'utf8'));
        } catch (error) {
            return { text: "Add quotes to server/quotes.json", author: "", source: "" };
        }

        // Use day of year as seed so quote changes daily but is stable within the day
        const now = new Date();
        const start = new Date(now.getFullYear(), 0, 0);
        const dayOfYear = Math.floor((now - start) / (1000 * 60 * 60 * 24));
        return quotes[dayOfYear % quotes.length];
    }

    render(ctx, bounds) {
        this.drawContainer(ctx, bounds);
        const contentBounds = this.getContentBounds(bounds);

        const quote = this.getQuote();
        const originalSize = this.config.fontSize;
        const lineHeight = originalSize * 1.4;

        ctx.fillStyle = this.config.textColor;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';

        // Quote text (italic)
        ctx.font = `${this.config.fontWeight} italic ${originalSize}px ${this.config.fontFamily}`;
        const words = quote.text.split(' ');
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (ctx.measureText(testLine).width > contentBounds.width) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);

        let y = contentBounds.y;
        for (const line of lines) {
            ctx.fillText(`${lines.indexOf(line) === 0 ? '"' : ''}${line}${lines.indexOf(line) === lines.length - 1 ? '"' : ''}`, contentBounds.x, y);
            y += lineHeight;
        }

        // Attribution
        ctx.font = `${originalSize * 0.9}px ${this.config.fontFamily}`;
        const attribution = quote.source ? `— ${quote.author}, ${quote.source}` : `— ${quote.author}`;
        ctx.fillText(attribution, contentBounds.x, y);
    }
}

class StatusBarComponent extends ComponentBase {
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
            let icon = '█';
            if (level <= 10) icon = '▁';
            else if (level <= 25) icon = '▃';
            else if (level <= 50) icon = '▅';
            else if (level <= 75) icon = '▇';
            parts.push(`${icon} ${level}%`);
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
            timeZone: 'America/Chicago'
        });
        parts.push(`Updated ${timeStr}`);

        const line = parts.join('  ·  ');

        // Center the status bar
        ctx.textAlign = 'center';
        ctx.fillText(line, contentBounds.x + contentBounds.width / 2, contentBounds.y);
    }
}

class WeatherComponent extends ComponentBase {
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

    /**
     * Get weather symbol for e-ink display (text-based icons)
     */
    getWeatherSymbol(iconType) {
        // Basic Unicode symbols (no emoji) - renders on all canvas implementations
        const symbols = {
            'clear': '☀',
            'mostly-clear': '☀',
            'partly-cloudy': '☁',
            'cloudy': '☁',
            'fog': '☁',
            'drizzle': '☂',
            'freezing-drizzle': '❄',
            'rain': '☂',
            'heavy-rain': '☂',
            'freezing-rain': '❄',
            'snow': '❄',
            'heavy-snow': '❄',
            'showers': '☂',
            'heavy-showers': '☂',
            'snow-showers': '❄',
            'thunderstorm': '⚡',
            'thunderstorm-hail': '⚡',
            'unknown': '?'
        };

        return symbols[iconType] || symbols['unknown'];
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
                    let condition = day.condition;
                    while (ctx.measureText(condition).width > colWidth && condition.length > 3) {
                        condition = condition.slice(0, -4) + '...';
                    }
                    ctx.fillText(condition, colX, colY);
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

            // Draw Pokemon ID/name directly below sprite
            if (this.config.showNumber || this.config.showName) {
                this.setTextStyle(ctx);
                ctx.textAlign = 'center';

                // Position label right below sprite with minimal gap
                const labelY = spriteY + spriteHeight + labelGap;
                const labelX = contentBounds.x + contentBounds.width / 2;

                let labelText = '';
                if (this.config.showName && pokemon.name) {
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

class CalendarComponent extends ComponentBase {
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
        let name = event.name;
        while (ctx.measureText(name).width > availableWidth && name.length > 3) {
            name = name.slice(0, -4) + '...';
        }
        ctx.fillText(name, x, y);
        y += lineHeight * 1.1;

        return y;
    }
}

class DashboardEngine {
    constructor(config = {}) {
        this.width = config.width || 600;
        this.height = config.height || 800;
        this.backgroundColor = config.backgroundColor || '#FFFFFF';

        // Initialize grid system
        this.grid = new GridSystem(this.width, this.height, config.grid);

        // Component registry
        this.components = new Map();
        this.layout = [];

        // Register built-in components
        this.registerComponent('clock', ClockComponent);
        this.registerComponent('date', DateComponent);
        this.registerComponent('stats', StatsComponent);
        this.registerComponent('device-stats', DeviceStatsComponent);
        this.registerComponent('weather', WeatherComponent);
        this.registerComponent('title', TitleComponent);
        this.registerComponent('pokemon-sprite', PokemonSpriteComponent);
        this.registerComponent('calendar', CalendarComponent);
        this.registerComponent('status-bar', StatusBarComponent);
        this.registerComponent('quote', QuoteComponent);
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
    ClockComponent,
    DateComponent,
    StatsComponent,
    TitleComponent,
    PokemonSpriteComponent,
    CalendarComponent
};