#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

/**
 * Pokemon Sprite Service Module
 * Fetches daily Pokemon sprites with caching and e-ink optimization
 */

class PokemonService {
    constructor(options = {}) {
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'cache', 'pokemon');
        this.mockData = options.mockData || false;
        this.maxPokemonId = options.maxPokemonId || 151; // Gen 1 Pokemon only for retro vibe
        this.spriteType = options.spriteType || 'pixel'; // 'pixel' for retro sprites, 'artwork' for high-res
        this.optimizerScript = options.optimizerScript || path.join(__dirname, 'optimize-sprite-for-eink.py');
        this.pythonPath = options.pythonPath || path.join(__dirname, '..', 'test_env', 'bin', 'python3');

        // Ensure cache directory exists
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }

        // Gen 1 Pokemon names (complete list for better display)
        this.pokemonNames = {
            1: 'Bulbasaur', 2: 'Ivysaur', 3: 'Venusaur', 4: 'Charmander', 5: 'Charmeleon',
            6: 'Charizard', 7: 'Squirtle', 8: 'Wartortle', 9: 'Blastoise', 10: 'Caterpie',
            11: 'Metapod', 12: 'Butterfree', 13: 'Weedle', 14: 'Kakuna', 15: 'Beedrill',
            16: 'Pidgey', 17: 'Pidgeotto', 18: 'Pidgeot', 19: 'Rattata', 20: 'Raticate',
            21: 'Spearow', 22: 'Fearow', 23: 'Ekans', 24: 'Arbok', 25: 'Pikachu',
            26: 'Raichu', 27: 'Sandshrew', 28: 'Sandslash', 29: 'Nidoran♀', 30: 'Nidorina',
            31: 'Nidoqueen', 32: 'Nidoran♂', 33: 'Nidorino', 34: 'Nidoking', 35: 'Clefairy',
            36: 'Clefable', 37: 'Vulpix', 38: 'Ninetales', 39: 'Jigglypuff', 40: 'Wigglytuff',
            41: 'Zubat', 42: 'Golbat', 43: 'Oddish', 44: 'Gloom', 45: 'Vileplume',
            46: 'Paras', 47: 'Parasect', 48: 'Venonat', 49: 'Venomoth', 50: 'Diglett',
            51: 'Dugtrio', 52: 'Meowth', 53: 'Persian', 54: 'Psyduck', 55: 'Golduck',
            56: 'Mankey', 57: 'Primeape', 58: 'Growlithe', 59: 'Arcanine', 60: 'Poliwag',
            61: 'Poliwhirl', 62: 'Poliwrath', 63: 'Abra', 64: 'Kadabra', 65: 'Alakazam',
            66: 'Machop', 67: 'Machoke', 68: 'Machamp', 69: 'Bellsprout', 70: 'Weepinbell',
            71: 'Victreebel', 72: 'Tentacool', 73: 'Tentacruel', 74: 'Geodude', 75: 'Graveler',
            76: 'Golem', 77: 'Ponyta', 78: 'Rapidash', 79: 'Slowpoke', 80: 'Slowbro',
            81: 'Magnemite', 82: 'Magneton', 83: 'Farfetch\'d', 84: 'Doduo', 85: 'Dodrio',
            86: 'Seel', 87: 'Dewgong', 88: 'Grimer', 89: 'Muk', 90: 'Shellder',
            91: 'Cloyster', 92: 'Gastly', 93: 'Haunter', 94: 'Gengar', 95: 'Onix',
            96: 'Drowzee', 97: 'Hypno', 98: 'Krabby', 99: 'Kingler', 100: 'Voltorb',
            101: 'Electrode', 102: 'Exeggcute', 103: 'Exeggutor', 104: 'Cubone', 105: 'Marowak',
            106: 'Hitmonlee', 107: 'Hitmonchan', 108: 'Lickitung', 109: 'Koffing', 110: 'Weezing',
            111: 'Rhyhorn', 112: 'Rhydon', 113: 'Chansey', 114: 'Tangela', 115: 'Kangaskhan',
            116: 'Horsea', 117: 'Seadra', 118: 'Goldeen', 119: 'Seaking', 120: 'Staryu',
            121: 'Starmie', 122: 'Mr. Mime', 123: 'Scyther', 124: 'Jynx', 125: 'Electabuzz',
            126: 'Magmar', 127: 'Pinsir', 128: 'Tauros', 129: 'Magikarp', 130: 'Gyarados',
            131: 'Lapras', 132: 'Ditto', 133: 'Eevee', 134: 'Vaporeon', 135: 'Jolteon',
            136: 'Flareon', 137: 'Porygon', 138: 'Omanyte', 139: 'Omastar', 140: 'Kabuto',
            141: 'Kabutops', 142: 'Aerodactyl', 143: 'Snorlax', 144: 'Articuno', 145: 'Zapdos',
            146: 'Moltres', 147: 'Dratini', 148: 'Dragonair', 149: 'Dragonite', 150: 'Mewtwo',
            151: 'Mew'
        };
    }

    /**
     * Get Pokemon ID for today using date-based seed
     * Ensures same Pokemon displays all day
     */
    getDailyPokemonId(date = new Date()) {
        const dayOfYear = Math.floor(
            (date - new Date(date.getFullYear(), 0, 0)) / 86400000
        );
        const year = date.getFullYear();

        // Use date as seed for consistent daily Pokemon
        const seed = year * 1000 + dayOfYear;
        const pokemonId = (seed % this.maxPokemonId) + 1;

        return pokemonId;
    }

    /**
     * Get Pokemon name if known, otherwise return ID
     */
    getPokemonName(pokemonId) {
        return this.pokemonNames[pokemonId] || `Pokemon #${pokemonId}`;
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
            spritePath: null, // No actual sprite in mock mode
            source: 'mock'
        };
    }

    /**
     * Get today's Pokemon sprite (cached or fresh)
     */
    async getTodaysPokemonSprite() {
        // Use mock data if enabled
        if (this.mockData) {
            return this.getMockPokemonData();
        }

        const pokemonId = this.getDailyPokemonId();
        const pokemonName = this.getPokemonName(pokemonId);
        const paths = this.getSpritePaths(pokemonId);

        try {
            // Return cached optimized sprite if available
            if (this.isSpriteOptimized(pokemonId)) {
                return {
                    id: pokemonId,
                    name: pokemonName,
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
                spritePath: paths.optimized,
                source: 'fresh'
            };
        } catch (error) {
            console.warn(`Failed to get Pokemon sprite: ${error.message}`);

            // Return error state without crashing
            return {
                id: pokemonId,
                name: pokemonName,
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
            displayName: `#${pokemonData.id}`,
            spritePath: pokemonData.spritePath,
            source: pokemonData.source,
            hasSprite: pokemonData.spritePath !== null
        };
    }

    /**
     * Get formatted Pokemon data for dashboard
     */
    async getFormattedPokemon() {
        const pokemonData = await this.getTodaysPokemonSprite();
        return this.formatPokemonForDashboard(pokemonData);
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
