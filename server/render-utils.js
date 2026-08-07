#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Shared rendering helpers used across dashboard components.
 * Single source of truth — do not copy these into component classes.
 */

/**
 * Round a Date down to the last N-minute boundary.
 * Shows the interval you're currently in, not the next one.
 * e.g. 3:40 with 15min interval => 3:30, 3:28 => 3:15
 */
function roundTimeToNearest(date, intervalMinutes = 15) {
    const ms = intervalMinutes * 60 * 1000;
    return new Date(Math.floor(date.getTime() / ms) * ms);
}

/**
 * Text-based weather symbols for e-ink (basic Unicode, no emoji —
 * renders on all canvas implementations).
 */
const WEATHER_SYMBOLS = {
    'clear': '☀', 'mostly-clear': '☀', 'partly-cloudy': '☁',
    'cloudy': '☁', 'fog': '☁', 'drizzle': '☂', 'rain': '☂',
    'heavy-rain': '☂', 'snow': '❄', 'heavy-snow': '❄',
    'freezing-rain': '❄', 'freezing-drizzle': '❄',
    'showers': '☂', 'heavy-showers': '☂', 'snow-showers': '❄',
    'thunderstorm': '⚡', 'thunderstorm-hail': '⚡', 'unknown': '?'
};

function getWeatherSymbol(iconType) {
    return WEATHER_SYMBOLS[iconType] || WEATHER_SYMBOLS['unknown'];
}

/**
 * Truncate text with an ellipsis so it fits maxWidth in the current ctx font.
 * Returns the text unchanged when it already fits.
 */
function truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    while (ctx.measureText(text + '...').width > maxWidth && text.length > 3) {
        text = text.slice(0, -1);
    }
    return text + '...';
}

/**
 * Word-wrap text to fit maxWidth in the current ctx font.
 * Returns an array of lines.
 */
function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
}

/**
 * Daily rotating quote from quotes.json — stable within a day,
 * changes at midnight (day-of-year index).
 */
function getDailyQuote(now = new Date()) {
    const quotesPath = path.join(__dirname, 'quotes.json');
    let quotes;
    try {
        quotes = JSON.parse(fs.readFileSync(quotesPath, 'utf8'));
    } catch (error) {
        return { text: 'Add quotes to server/quotes.json', author: '', source: '' };
    }
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now - start) / (1000 * 60 * 60 * 24));
    return quotes[dayOfYear % quotes.length];
}

/**
 * Battery bar icon for status displays (single source for the thresholds).
 */
function batteryIcon(level) {
    if (level <= 10) return '▁';
    if (level <= 25) return '▃';
    if (level <= 50) return '▅';
    if (level <= 75) return '▇';
    return '█';
}

module.exports = {
    roundTimeToNearest,
    getWeatherSymbol,
    truncateText,
    wrapText,
    getDailyQuote,
    batteryIcon
};
