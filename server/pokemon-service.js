#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);
const PokemonSelector = require('./pokemon-selector');

/**
 * Pokemon Sprite Service Module
 * Fetches daily Pokemon sprites with contextual selection, caching, and e-ink optimization.
 *
 * Now supports all 1025 Pokemon with context-aware selection based on
 * weather, calendar events, and holidays. No Pokemon repeats until all
 * have been shown.
 */

class PokemonService {
    constructor(options = {}) {
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'cache', 'pokemon');
        this.mockData = options.mockData || false;
        this.maxPokemonId = options.maxPokemonId || 1025; // All Pokemon
        this.spriteType = options.spriteType || 'pixel'; // 'pixel' for retro sprites, 'artwork' for high-res
        this.optimizerScript = options.optimizerScript || path.join(__dirname, 'optimize-sprite-for-eink.py');
        const venvPython = path.join(__dirname, '..', 'test_env', 'bin', 'python3');
        this.pythonPath = options.pythonPath || (fs.existsSync(venvPython) ? venvPython : '/usr/bin/python3');

        // Initialize contextual selector
        this.selector = new PokemonSelector({
            dataFile: options.dataFile || path.join(__dirname, 'pokemon-data.json'),
            historyFile: options.historyFile || path.join(__dirname, '..', 'cache', 'pokemon-history.json'),
            timezone: options.timezone || 'America/Chicago'
        });

        // Ensure cache directory exists
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Get Pokemon name from the database
     */
    getPokemonName(pokemonId) {
        const pokemon = this.selector.getPokemonById(pokemonId);
        return pokemon ? pokemon.name : `Pokemon #${pokemonId}`;
    }

    /**
     * Select today's Pokemon based on context (weather, calendar, holidays)
     * Falls back to date-based selection if no database available
     */
    selectDailyPokemon(options = {}) {
        try {
            return this.selector.selectPokemon(options);
        } catch (error) {
            console.warn(`Context selection failed, using fallback: ${error.message}`);
            return this._fallbackSelection();
        }
    }

    /**
     * Fallback: simple date-based selection (used if pokemon-data.json missing)
     */
    _fallbackSelection(date = new Date()) {
        const dayOfYear = Math.floor(
            (date - new Date(date.getFullYear(), 0, 0)) / 86400000
        );
        const year = date.getFullYear();
        const seed = year * 1000 + dayOfYear;
        const pokemonId = (seed % this.maxPokemonId) + 1;

        return {
            id: pokemonId,
            name: this.getPokemonName(pokemonId),
            types: [],
            reason: 'fallback',
            source: 'fallback'
        };
    }

    /**
     * Get sprite file paths
     */
    getSpritePaths(pokemonId) {
        return {
            raw: path.join(this.cacheDir, `pokemon_${pokemonId}_raw.png`),
            optimized: path.join(this.cacheDir, `pokemon_${pokemonId}_eink.png`)
        };
    }

    /**
     * Check if optimized sprite is cached
     */
    isSpriteOptimized(pokemonId) {
        const paths = this.getSpritePaths(pokemonId);
        return fs.existsSync(paths.optimized);
    }

    /**
     * Download Pokemon sprite from PokeAPI GitHub
     */
    async downloadSprite(pokemonId) {
        // Choose sprite URL based on type
        let url;
        if (this.spriteType === 'pixel') {
            // Retro pixel sprites (96x96 classic look)
            url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`;
        } else {
            // High-res official artwork (475x475)
            url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`;
        }

        const paths = this.getSpritePaths(pokemonId);

        // Check if already downloaded
        if (fs.existsSync(paths.raw)) {
            return paths.raw;
        }

        return new Promise((resolve, reject) => {
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download sprite: HTTP ${response.statusCode}`));
                    return;
                }

                const fileStream = fs.createWriteStream(paths.raw);
                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve(paths.raw);
                });

                fileStream.on('error', (error) => {
                    fs.unlink(paths.raw, () => {}); // Clean up partial file
                    reject(error);
                });
            }).on('error', reject);
        });
    }

    /**
     * Optimize sprite for e-ink display
     */
    async optimizeForEink(rawPath, outputPath) {
        // Check if Python environment and optimizer exist
        if (!fs.existsSync(this.pythonPath)) {
            throw new Error(`Python not found at ${this.pythonPath}`);
        }
        if (!fs.existsSync(this.optimizerScript)) {
            throw new Error(`Optimizer script not found at ${this.optimizerScript}`);
        }

        try {
            const command = `"${this.pythonPath}" "${this.optimizerScript}" "${rawPath}" -o "${outputPath}"`;
            await execPromise(command);
            return outputPath;
        } catch (error) {
            throw new Error(`E-ink optimization failed: ${error.message}`);
        }
    }

    /**
     * Get mock Pokemon data for testing
     */
    getMockPokemonData() {
        return {
            id: 25, // Pikachu
            name: 'Pikachu',
            types: ['electric'],
            reason: 'mock',
            spritePath: null,
            source: 'mock'
        };
    }

    /**
     * Get today's Pokemon sprite with contextual selection
     *
     * @param {Object} context - Context for selection
     * @param {Object} context.weatherData - Formatted weather data
     * @param {Object} context.calendarData - Formatted calendar data
     */
    async getTodaysPokemonSprite(context = {}) {
        // Use mock data if enabled
        if (this.mockData) {
            return this.getMockPokemonData();
        }

        // Select Pokemon based on context
        const selected = this.selectDailyPokemon(context);
        const pokemonId = selected.id;
        const pokemonName = selected.name;
        const paths = this.getSpritePaths(pokemonId);

        try {
            // Return cached optimized sprite if available
            if (this.isSpriteOptimized(pokemonId)) {
                return {
                    id: pokemonId,
                    name: pokemonName,
                    types: selected.types || [],
                    reason: selected.reason,
                    spritePath: paths.optimized,
                    source: 'cache'
                };
            }

            // Download raw sprite
            await this.downloadSprite(pokemonId);

            // Optimize for e-ink
            await this.optimizeForEink(paths.raw, paths.optimized);

            return {
                id: pokemonId,
                name: pokemonName,
                types: selected.types || [],
                reason: selected.reason,
                spritePath: paths.optimized,
                source: 'fresh'
            };
        } catch (error) {
            console.warn(`Failed to get Pokemon sprite: ${error.message}`);

            // Return error state without crashing
            return {
                id: pokemonId,
                name: pokemonName,
                types: selected.types || [],
                reason: selected.reason,
                spritePath: null,
                source: 'error',
                error: error.message
            };
        }
    }

    /**
     * Format Pokemon data for dashboard display
     */
    formatPokemonForDashboard(pokemonData) {
        return {
            id: pokemonData.id,
            name: pokemonData.name,
            displayName: `#${pokemonData.id} ${pokemonData.name}`,
            types: pokemonData.types || [],
            reason: pokemonData.reason || '',
            spritePath: pokemonData.spritePath,
            source: pokemonData.source,
            hasSprite: pokemonData.spritePath !== null
        };
    }

    /**
     * Get formatted Pokemon data for dashboard (with context)
     *
     * @param {Object} context - Context for selection
     * @param {Object} context.weatherData - Formatted weather data
     * @param {Object} context.calendarData - Formatted calendar data
     */
    async getFormattedPokemon(context = {}) {
        const pokemonData = await this.getTodaysPokemonSprite(context);
        return this.formatPokemonForDashboard(pokemonData);
    }

    /**
     * Get selection history stats
     */
    getHistoryStats() {
        return this.selector.getHistoryStats();
    }

    /**
     * Clean old cached sprites (keep last N days)
     */
    async cleanOldSprites(daysToKeep = 30) {
        const files = fs.readdirSync(this.cacheDir);
        const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
        let cleaned = 0;

        for (const file of files) {
            const filePath = path.join(this.cacheDir, file);
            const stats = fs.statSync(filePath);

            if (stats.mtime.getTime() < cutoffTime) {
                fs.unlinkSync(filePath);
                cleaned++;
            }
        }

        return cleaned;
    }
}

module.exports = PokemonService;
