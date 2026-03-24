#!/usr/bin/env node

/**
 * Pokemon Contextual Selector
 *
 * Selects a Pokemon based on daily context:
 * 1. Weather conditions → Pokemon types
 * 2. Calendar events → keyword matching
 * 3. Holidays → themed Pokemon
 * 4. No-repeat guarantee: every Pokemon shown before any repeats
 */

const fs = require('fs');
const path = require('path');

class PokemonSelector {
    constructor(options = {}) {
        this.dataFile = options.dataFile || path.join(__dirname, 'pokemon-data.json');
        this.historyFile = options.historyFile || path.join(__dirname, '..', 'cache', 'pokemon-history.json');
        this.timezone = options.timezone || 'America/Chicago';

        // Load Pokemon database
        this.pokemonDb = this._loadDatabase();

        // Weather condition → Pokemon type mapping
        this.weatherTypeMap = {
            'clear': ['fire', 'grass', 'normal', 'flying'],
            'mostly-clear': ['fire', 'grass', 'normal', 'flying'],
            'partly-cloudy': ['normal', 'flying', 'fairy'],
            'cloudy': ['flying', 'normal', 'fairy', 'steel'],
            'fog': ['ghost', 'psychic', 'dark', 'poison'],
            'drizzle': ['water', 'grass', 'bug'],
            'freezing-drizzle': ['ice', 'water'],
            'rain': ['water', 'electric', 'bug'],
            'heavy-rain': ['water', 'electric', 'dragon'],
            'freezing-rain': ['ice', 'water', 'steel'],
            'snow': ['ice', 'fairy', 'steel'],
            'heavy-snow': ['ice', 'dragon', 'steel'],
            'showers': ['water', 'electric'],
            'heavy-showers': ['water', 'electric', 'dragon'],
            'thunderstorm': ['electric', 'dragon', 'dark'],
            'heavy-thunderstorm': ['electric', 'dragon', 'dark'],
            'unknown': ['normal']
        };

        // Holiday definitions (month-day → theme)
        this.holidays = {
            '01-01': { name: 'New Year', types: ['psychic', 'fairy', 'fire'], pokemonIds: [385, 492] }, // Jirachi, Shaymin
            '02-14': { name: 'Valentine\'s Day', types: ['fairy', 'psychic'], pokemonIds: [370, 35, 36, 39, 40, 468] }, // Luvdisc, Clefairy line, Jigglypuff line, Togekiss
            '03-17': { name: 'St Patrick\'s Day', types: ['grass', 'bug'], pokemonIds: [1, 2, 3, 152, 153, 154, 251] }, // Grass starters, Celebi
            '04-22': { name: 'Earth Day', types: ['grass', 'ground', 'rock'], pokemonIds: [389, 423, 497] }, // Torterra, Gastrodon, Serperior
            '07-04': { name: 'Independence Day', types: ['fire', 'electric'], pokemonIds: [6, 145, 146, 244, 250] }, // Charizard, Zapdos, Moltres, Entei, Ho-Oh
            '10-31': { name: 'Halloween', types: ['ghost', 'dark', 'poison'], pokemonIds: [92, 93, 94, 200, 302, 353, 354, 429, 442, 710, 711] }, // Ghost types
            '12-25': { name: 'Christmas', types: ['ice', 'fairy'], pokemonIds: [225, 471, 584, 613, 614, 712, 713] }, // Delibird, Glaceon, Vanilluxe, Cubchoo, Beartic, Bergmite, Avalugg
            '12-31': { name: 'New Year\'s Eve', types: ['fire', 'psychic', 'fairy'], pokemonIds: [385, 151] } // Jirachi, Mew
        };

        // Calendar event keyword → Pokemon type mapping
        this.eventKeywordMap = {
            // Activities
            'birthday': { types: ['fairy', 'normal'], pokemonIds: [35, 39, 113, 242, 440] }, // Clefairy, Jigglypuff, Chansey, Blissey, Happiny
            'party': { types: ['fairy', 'normal'], pokemonIds: [35, 39, 25] },
            'gym': { types: ['fighting'], pokemonIds: [66, 67, 68, 106, 107, 237] }, // Machop line, Hitmons
            'workout': { types: ['fighting'], pokemonIds: [66, 67, 68] },
            'exercise': { types: ['fighting'], pokemonIds: [66, 67, 68] },
            'run': { types: ['fighting', 'normal'], pokemonIds: [78, 135] }, // Rapidash, Jolteon
            'swim': { types: ['water'], pokemonIds: [131, 134, 350] }, // Lapras, Vaporeon, Milotic
            'beach': { types: ['water', 'ground'], pokemonIds: [7, 8, 9, 131, 120, 121] }, // Squirtle line, Lapras, Staryu, Starmie
            'hike': { types: ['rock', 'ground', 'grass'], pokemonIds: [74, 75, 76, 95] }, // Geodude line, Onix
            'camp': { types: ['fire', 'grass', 'ground'], pokemonIds: [4, 5, 6, 37, 58] }, // Charmander line, Vulpix, Growlithe
            'garden': { types: ['grass', 'bug'], pokemonIds: [43, 44, 45, 182, 315, 407] }, // Oddish line, Bellossom, Roselia, Roserade

            // Social
            'dinner': { types: ['normal', 'fire'], pokemonIds: [143, 446] }, // Snorlax, Munchlax
            'restaurant': { types: ['normal'], pokemonIds: [143, 446] },
            'lunch': { types: ['normal'], pokemonIds: [143, 446] },
            'coffee': { types: ['psychic', 'normal'], pokemonIds: [96, 97, 63, 64, 65] }, // Drowzee, Hypno, Abra line
            'date': { types: ['fairy'], pokemonIds: [370, 468] }, // Luvdisc, Togekiss
            'wedding': { types: ['fairy'], pokemonIds: [35, 36, 468, 282] }, // Clefairy, Clefable, Togekiss, Gardevoir

            // Work/School
            'meeting': { types: ['psychic', 'normal'], pokemonIds: [63, 64, 65, 196] }, // Abra line, Espeon
            'work': { types: ['normal', 'steel'], pokemonIds: [132, 137, 233, 474] }, // Ditto, Porygon line
            'school': { types: ['psychic'], pokemonIds: [63, 64, 65, 196] },
            'exam': { types: ['psychic'], pokemonIds: [63, 64, 65, 196, 518] }, // Abra line, Espeon, Musharna
            'study': { types: ['psychic'], pokemonIds: [63, 64, 65, 196] },
            'interview': { types: ['psychic', 'normal'], pokemonIds: [196, 197] }, // Espeon, Umbreon

            // Health
            'doctor': { types: ['fairy', 'normal'], pokemonIds: [113, 242, 440] }, // Chansey, Blissey, Happiny
            'dentist': { types: ['normal'], pokemonIds: [113, 242] },
            'hospital': { types: ['fairy', 'normal'], pokemonIds: [113, 242, 440] },
            'vet': { types: ['normal'], pokemonIds: [133, 134, 135, 136] }, // Eevee, Vaporeon, Jolteon, Flareon

            // Music/Entertainment
            'music': { types: ['normal', 'fairy'], pokemonIds: [39, 40, 124, 648] }, // Jigglypuff, Wigglytuff, Jynx, Meloetta
            'concert': { types: ['normal', 'electric'], pokemonIds: [39, 40, 25, 101] }, // Jigglypuff, Wigglytuff, Pikachu, Electrode
            'movie': { types: ['psychic', 'dark'], pokemonIds: [150, 151, 249, 250] }, // Mewtwo, Mew, Lugia, Ho-Oh
            'game': { types: ['normal', 'electric'], pokemonIds: [137, 233, 474] }, // Porygon line

            // Travel
            'flight': { types: ['flying'], pokemonIds: [18, 22, 142, 149, 250, 384] }, // Pidgeot, Fearow, Aerodactyl, Dragonite, Ho-Oh, Rayquaza
            'travel': { types: ['flying', 'water'], pokemonIds: [131, 149, 384] }, // Lapras, Dragonite, Rayquaza
            'airport': { types: ['flying', 'steel'], pokemonIds: [18, 142, 227] }, // Pidgeot, Aerodactyl, Skarmory
            'vacation': { types: ['water', 'flying'], pokemonIds: [131, 319, 321] }, // Lapras, Sharpedo, Wailord

            // Pets
            'dog': { types: ['normal', 'fire'], pokemonIds: [58, 59, 133, 507, 508, 509] }, // Growlithe, Arcanine, Eevee, Herdier family
            'cat': { types: ['normal', 'dark'], pokemonIds: [52, 53, 431, 432, 509, 510] }, // Meowth, Persian, Glameow, Purugly, Purrloin, Liepard
            'walk': { types: ['normal', 'grass'], pokemonIds: [58, 59, 133] }, // Growlithe, Arcanine, Eevee

            // Seasonal/Nature
            'garden': { types: ['grass', 'bug'], pokemonIds: [1, 2, 3, 152, 153, 154] },
            'cleaning': { types: ['water', 'normal'], pokemonIds: [60, 61, 62] }, // Poliwag line
            'shopping': { types: ['normal'], pokemonIds: [52, 53] }, // Meowth (Pay Day!)
            'move': { types: ['fighting', 'normal'], pokemonIds: [66, 67, 68, 143] } // Machop line, Snorlax
        };
    }

    _loadDatabase() {
        try {
            const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
            return data.pokemon || [];
        } catch (error) {
            console.warn(`Failed to load Pokemon database: ${error.message}`);
            return [];
        }
    }

    /**
     * Load history of shown Pokemon IDs
     */
    _loadHistory() {
        try {
            const dir = path.dirname(this.historyFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            if (fs.existsSync(this.historyFile)) {
                return JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
            }
        } catch (error) {
            console.warn(`Failed to load Pokemon history: ${error.message}`);
        }
        return { shown: [], lastDate: null, lastPokemonId: null };
    }

    /**
     * Save history
     */
    _saveHistory(history) {
        try {
            const dir = path.dirname(this.historyFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2));
        } catch (error) {
            console.warn(`Failed to save Pokemon history: ${error.message}`);
        }
    }

    /**
     * Get today's date string in local timezone
     */
    _getTodayString(date = new Date()) {
        return date.toLocaleDateString('en-CA', { timeZone: this.timezone }); // YYYY-MM-DD format
    }

    /**
     * Get month-day string for holiday checking
     */
    _getMonthDay(date = new Date()) {
        const localDate = new Date(date.toLocaleString('en-US', { timeZone: this.timezone }));
        const month = String(localDate.getMonth() + 1).padStart(2, '0');
        const day = String(localDate.getDate()).padStart(2, '0');
        return `${month}-${day}`;
    }

    /**
     * Deterministic shuffle using a seed (Fisher-Yates with seeded random)
     */
    _seededRandom(seed) {
        let s = seed;
        return function() {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            return s / 0x7fffffff;
        };
    }

    /**
     * Get Pokemon types that match current weather
     */
    getWeatherTypes(weatherData) {
        if (!weatherData || !weatherData.current) return [];

        const icon = weatherData.current.icon || 'unknown';
        return this.weatherTypeMap[icon] || this.weatherTypeMap['unknown'];
    }

    /**
     * Get Pokemon types and specific IDs from calendar events
     */
    getCalendarContext(calendarData) {
        const result = { types: new Set(), pokemonIds: new Set() };

        if (!calendarData) return result;

        const allEvents = [
            ...(calendarData.today || []),
            ...(calendarData.tomorrow || [])
        ];

        for (const event of allEvents) {
            const eventName = (event.name || event.summary || '').toLowerCase();
            for (const [keyword, mapping] of Object.entries(this.eventKeywordMap)) {
                if (eventName.includes(keyword)) {
                    mapping.types.forEach(t => result.types.add(t));
                    if (mapping.pokemonIds) {
                        mapping.pokemonIds.forEach(id => result.pokemonIds.add(id));
                    }
                }
            }
        }

        return result;
    }

    /**
     * Check if today is a holiday
     */
    getHolidayContext(date = new Date()) {
        const monthDay = this._getMonthDay(date);

        // Check exact match
        if (this.holidays[monthDay]) {
            return this.holidays[monthDay];
        }

        // Check near-holiday (within 3 days for major ones)
        const localDate = new Date(date.toLocaleString('en-US', { timeZone: this.timezone }));
        for (let offset = -3; offset <= 3; offset++) {
            if (offset === 0) continue;
            const checkDate = new Date(localDate);
            checkDate.setDate(checkDate.getDate() + offset);
            const checkMonthDay = `${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
            if (this.holidays[checkMonthDay]) {
                // Only return near-holiday for major holidays
                const holiday = this.holidays[checkMonthDay];
                if (['Christmas', 'Halloween', 'Independence Day'].includes(holiday.name)) {
                    return { ...holiday, name: `Near ${holiday.name}` };
                }
            }
        }

        return null;
    }

    /**
     * Get temperature-based type preferences
     */
    getTemperatureTypes(weatherData) {
        if (!weatherData || !weatherData.current) return [];

        const tempStr = weatherData.current.temperature;
        const temp = parseInt(tempStr);
        if (isNaN(temp)) return [];

        if (temp <= 20) return ['ice', 'steel'];
        if (temp <= 35) return ['ice', 'water'];
        if (temp <= 50) return ['water', 'normal'];
        if (temp >= 95) return ['fire', 'ground', 'dragon'];
        if (temp >= 85) return ['fire', 'grass'];
        return [];
    }

    /**
     * Score a Pokemon based on how well it matches the current context
     */
    scorePokemon(pokemon, context) {
        let score = 0;

        // Holiday-specific Pokemon IDs get highest priority
        if (context.holidayPokemonIds && context.holidayPokemonIds.has(pokemon.id)) {
            score += 100;
        }

        // Calendar-specific Pokemon IDs get high priority
        if (context.calendarPokemonIds && context.calendarPokemonIds.has(pokemon.id)) {
            score += 80;
        }

        // Holiday type match
        if (context.holidayTypes) {
            for (const type of pokemon.types) {
                if (context.holidayTypes.includes(type)) {
                    score += 30;
                }
            }
        }

        // Calendar type match
        if (context.calendarTypes) {
            for (const type of pokemon.types) {
                if (context.calendarTypes.has(type)) {
                    score += 20;
                }
            }
        }

        // Weather type match
        if (context.weatherTypes) {
            for (const type of pokemon.types) {
                if (context.weatherTypes.includes(type)) {
                    score += 10;
                }
            }
        }

        // Temperature type match
        if (context.temperatureTypes) {
            for (const type of pokemon.types) {
                if (context.temperatureTypes.includes(type)) {
                    score += 5;
                }
            }
        }

        return score;
    }

    /**
     * Select today's Pokemon based on context
     *
     * @param {Object} options
     * @param {Object} options.weatherData - Formatted weather data
     * @param {Object} options.calendarData - Formatted calendar data
     * @param {Date} options.date - Override date (for testing)
     * @returns {Object} Selected Pokemon { id, name, types, reason }
     */
    selectPokemon(options = {}) {
        const date = options.date || new Date();
        const todayStr = this._getTodayString(date);

        // Check history - return same Pokemon if already selected today
        const history = this._loadHistory();
        if (history.lastDate === todayStr && history.lastPokemonId) {
            const cached = this.pokemonDb.find(p => p.id === history.lastPokemonId);
            if (cached) {
                return { ...cached, reason: history.lastReason || 'cached', source: 'history' };
            }
        }

        // Build context
        const weatherTypes = this.getWeatherTypes(options.weatherData);
        const temperatureTypes = this.getTemperatureTypes(options.weatherData);
        const calendarContext = this.getCalendarContext(options.calendarData);
        const holidayContext = this.getHolidayContext(date);

        const context = {
            weatherTypes,
            temperatureTypes,
            calendarTypes: calendarContext.types,
            calendarPokemonIds: calendarContext.pokemonIds,
            holidayTypes: holidayContext ? holidayContext.types : null,
            holidayPokemonIds: holidayContext ? new Set(holidayContext.pokemonIds || []) : null
        };

        // Get set of already-shown Pokemon
        let shownSet = new Set(history.shown || []);
        const totalPokemon = this.pokemonDb.length;

        // If all Pokemon have been shown, reset
        if (shownSet.size >= totalPokemon) {
            console.log(`All ${totalPokemon} Pokemon shown! Resetting history.`);
            shownSet = new Set();
            history.shown = [];
        }

        // Filter to unshown Pokemon
        const available = this.pokemonDb.filter(p => !shownSet.has(p.id));

        // Score all available Pokemon
        const scored = available.map(p => ({
            ...p,
            score: this.scorePokemon(p, context)
        }));

        // Sort by score descending
        scored.sort((a, b) => b.score - a.score);

        // Get the top score
        const topScore = scored[0] ? scored[0].score : 0;

        // Collect all Pokemon tied for top score
        const topCandidates = scored.filter(p => p.score === topScore);

        // Use date-based seed to pick deterministically from top candidates
        const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
        const seed = date.getFullYear() * 1000 + dayOfYear;
        const rng = this._seededRandom(seed);
        const index = Math.floor(rng() * topCandidates.length);
        const selected = topCandidates[index];

        // Determine reason
        let reason = 'random';
        if (topScore >= 100) {
            reason = `holiday: ${holidayContext.name}`;
        } else if (topScore >= 80) {
            reason = 'calendar event match';
        } else if (topScore >= 30) {
            reason = `holiday type: ${holidayContext.name}`;
        } else if (topScore >= 20) {
            reason = 'calendar type match';
        } else if (topScore >= 10) {
            const weatherCondition = options.weatherData && options.weatherData.current
                ? options.weatherData.current.condition : 'weather';
            reason = `weather: ${weatherCondition}`;
        } else if (topScore >= 5) {
            reason = 'temperature match';
        }

        // Update history
        history.shown.push(selected.id);
        history.lastDate = todayStr;
        history.lastPokemonId = selected.id;
        history.lastReason = reason;
        this._saveHistory(history);

        console.log(`Pokemon selected: #${selected.id} ${selected.name} [${selected.types.join('/')}] (reason: ${reason}, score: ${topScore}, ${history.shown.length}/${totalPokemon} shown)`);

        return {
            id: selected.id,
            name: selected.name,
            types: selected.types,
            reason,
            source: 'selected'
        };
    }

    /**
     * Get Pokemon info by ID
     */
    getPokemonById(id) {
        return this.pokemonDb.find(p => p.id === id) || null;
    }

    /**
     * Get total Pokemon count
     */
    getTotalCount() {
        return this.pokemonDb.length;
    }

    /**
     * Get history stats
     */
    getHistoryStats() {
        const history = this._loadHistory();
        return {
            shown: (history.shown || []).length,
            total: this.pokemonDb.length,
            percentComplete: Math.round(((history.shown || []).length / this.pokemonDb.length) * 100),
            lastDate: history.lastDate,
            lastPokemonId: history.lastPokemonId,
            lastReason: history.lastReason
        };
    }
}

module.exports = PokemonSelector;
