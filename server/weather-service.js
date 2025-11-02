#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * Weather Service Module using Open-Meteo API
 * Fetches weather data with caching and error handling
 */

class WeatherService {
    constructor(options = {}) {
        this.latitude = options.latitude || 41.8781; // Default: Chicago
        this.longitude = options.longitude || -87.6298;
        this.timezone = options.timezone || 'America/Chicago';
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'cache');
        this.cacheTimeout = options.cacheTimeout || 30 * 60 * 1000; // 30 minutes
        this.mockData = options.mockData || false;

        // Ensure cache directory exists
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }

        // WMO Weather interpretation codes
        this.weatherCodes = {
            0: { description: 'Clear sky', icon: 'clear' },
            1: { description: 'Mainly clear', icon: 'mostly-clear' },
            2: { description: 'Partly cloudy', icon: 'partly-cloudy' },
            3: { description: 'Overcast', icon: 'cloudy' },
            45: { description: 'Fog', icon: 'fog' },
            48: { description: 'Depositing rime fog', icon: 'fog' },
            51: { description: 'Light drizzle', icon: 'drizzle' },
            53: { description: 'Moderate drizzle', icon: 'drizzle' },
            55: { description: 'Dense drizzle', icon: 'drizzle' },
            56: { description: 'Light freezing drizzle', icon: 'freezing-drizzle' },
            57: { description: 'Dense freezing drizzle', icon: 'freezing-drizzle' },
            61: { description: 'Slight rain', icon: 'rain' },
            63: { description: 'Moderate rain', icon: 'rain' },
            65: { description: 'Heavy rain', icon: 'heavy-rain' },
            66: { description: 'Light freezing rain', icon: 'freezing-rain' },
            67: { description: 'Heavy freezing rain', icon: 'freezing-rain' },
            71: { description: 'Slight snow', icon: 'snow' },
            73: { description: 'Moderate snow', icon: 'snow' },
            75: { description: 'Heavy snow', icon: 'heavy-snow' },
            77: { description: 'Snow grains', icon: 'snow' },
            80: { description: 'Slight rain showers', icon: 'showers' },
            81: { description: 'Moderate rain showers', icon: 'showers' },
            82: { description: 'Violent rain showers', icon: 'heavy-showers' },
            85: { description: 'Slight snow showers', icon: 'snow-showers' },
            86: { description: 'Heavy snow showers', icon: 'snow-showers' },
            95: { description: 'Thunderstorm', icon: 'thunderstorm' },
            96: { description: 'Thunderstorm with slight hail', icon: 'thunderstorm-hail' },
            99: { description: 'Thunderstorm with heavy hail', icon: 'thunderstorm-hail' }
        };
    }

    /**
     * Get weather interpretation from WMO code
     */
    getWeatherInfo(weatherCode) {
        return this.weatherCodes[weatherCode] || {
            description: 'Unknown',
            icon: 'unknown'
        };
    }

    /**
     * Get cache file path for weather data
     */
    getCacheFilePath() {
        return path.join(this.cacheDir, 'weather_cache.json');
    }

    /**
     * Check if cached data is still valid
     */
    isCacheValid() {
        const cacheFile = this.getCacheFilePath();

        if (!fs.existsSync(cacheFile)) {
            return false;
        }

        try {
            const stats = fs.statSync(cacheFile);
            const age = Date.now() - stats.mtime.getTime();
            return age < this.cacheTimeout;
        } catch (error) {
            return false;
        }
    }

    /**
     * Load cached weather data
     */
    loadCachedData() {
        const cacheFile = this.getCacheFilePath();

        try {
            const data = fs.readFileSync(cacheFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return null;
        }
    }

    /**
     * Save weather data to cache
     */
    saveCachedData(data) {
        const cacheFile = this.getCacheFilePath();

        try {
            fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.warn('Failed to save weather cache:', error.message);
            return false;
        }
    }

    /**
     * Generate mock weather data for testing
     */
    getMockWeatherData() {
        const mockData = {
            current: {
                time: new Date().toISOString(),
                temperature_2m: 72.5,
                relative_humidity_2m: 65,
                weather_code: 2,
                wind_speed_10m: 8.5
            },
            daily: {
                time: [
                    new Date().toISOString().split('T')[0],
                    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().split('T')[0]
                ],
                weather_code: [2, 61, 1],
                temperature_2m_max: [77.2, 67.6, 79.3],
                temperature_2m_min: [65.1, 61.2, 67.5]
            },
            _source: 'mock',
            _timestamp: Date.now()
        };

        return Promise.resolve(mockData);
    }

    /**
     * Fetch weather data from Open-Meteo API
     */
    fetchWeatherData() {
        return new Promise((resolve, reject) => {
            const url = `https://api.open-meteo.com/v1/forecast?` +
                `latitude=${this.latitude}&` +
                `longitude=${this.longitude}&` +
                `current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&` +
                `daily=weather_code,temperature_2m_max,temperature_2m_min&` +
                `timezone=${encodeURIComponent(this.timezone)}&` +
                `temperature_unit=fahrenheit&` +
                `forecast_days=3`;

            https.get(url, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const weatherData = JSON.parse(data);
                        weatherData._source = 'api';
                        weatherData._timestamp = Date.now();
                        resolve(weatherData);
                    } catch (error) {
                        reject(new Error(`Failed to parse weather data: ${error.message}`));
                    }
                });
            }).on('error', (error) => {
                reject(new Error(`Failed to fetch weather data: ${error.message}`));
            });
        });
    }

    /**
     * Get weather data with caching
     */
    async getWeatherData() {
        // Use mock data if enabled
        if (this.mockData) {
            return this.getMockWeatherData();
        }

        // Check cache first
        if (this.isCacheValid()) {
            const cachedData = this.loadCachedData();
            if (cachedData) {
                cachedData._source = 'cache';
                return cachedData;
            }
        }

        try {
            // Fetch fresh data
            const weatherData = await this.fetchWeatherData();

            // Save to cache
            this.saveCachedData(weatherData);

            return weatherData;
        } catch (error) {
            console.warn(`Weather API error: ${error.message}`);

            // Try to return cached data even if expired
            const cachedData = this.loadCachedData();
            if (cachedData) {
                cachedData._source = 'cache_expired';
                return cachedData;
            }

            // Last resort: return mock data
            const mockData = await this.getMockWeatherData();
            mockData._source = 'mock_fallback';
            mockData._error = error.message;
            return mockData;
        }
    }

    /**
     * Format weather data for dashboard display
     */
    formatWeatherForDashboard(weatherData) {
        if (!weatherData || !weatherData.current) {
            return {
                current: {
                    temperature: 'N/A',
                    condition: 'Unknown',
                    humidity: 'N/A',
                    windSpeed: 'N/A',
                    icon: 'unknown'
                },
                forecast: [],
                source: 'error'
            };
        }

        const current = weatherData.current;
        const currentWeatherInfo = this.getWeatherInfo(current.weather_code);

        const formatted = {
            current: {
                temperature: `${Math.round(current.temperature_2m)}°F`,
                condition: currentWeatherInfo.description,
                humidity: `${current.relative_humidity_2m}%`,
                windSpeed: `${Math.round(current.wind_speed_10m)} km/h`,
                icon: currentWeatherInfo.icon
            },
            forecast: [],
            source: weatherData._source || 'unknown',
            lastUpdate: new Date(weatherData._timestamp || Date.now()).toLocaleTimeString()
        };

        // Format daily forecast
        if (weatherData.daily && weatherData.daily.time) {
            for (let i = 0; i < Math.min(3, weatherData.daily.time.length); i++) {
                const forecastWeatherInfo = this.getWeatherInfo(weatherData.daily.weather_code[i]);

                formatted.forecast.push({
                    date: new Date(weatherData.daily.time[i]).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric'
                    }),
                    condition: forecastWeatherInfo.description,
                    highTemp: `${Math.round(weatherData.daily.temperature_2m_max[i])}°`,
                    lowTemp: `${Math.round(weatherData.daily.temperature_2m_min[i])}°`,
                    icon: forecastWeatherInfo.icon
                });
            }
        }

        return formatted;
    }

    /**
     * Get formatted weather data for dashboard
     */
    async getFormattedWeather() {
        const weatherData = await this.getWeatherData();
        return this.formatWeatherForDashboard(weatherData);
    }
}

module.exports = WeatherService;