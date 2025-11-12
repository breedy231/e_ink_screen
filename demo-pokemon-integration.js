#!/usr/bin/env node

/**
 * Pokemon Sprite Integration Demo
 * Demonstrates how to fetch and prepare Pokemon sprites for the e-ink dashboard
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class PokemonServiceDemo {
    constructor() {
        this.cacheDir = path.join(__dirname, 'cache', 'pokemon');

        // Ensure cache directory exists
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Get Pokemon ID for today using date-based seed
     */
    getDailyPokemonId() {
        const today = new Date();
        const dayOfYear = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 86400000);
        const year = today.getFullYear();

        // Use date as seed for consistent daily Pokemon
        const seed = year * 1000 + dayOfYear;
        const pokemonId = (seed % 1025) + 1; // Pokemon IDs: 1-1025

        return pokemonId;
    }

    /**
     * Download Pokemon sprite from PokeAPI GitHub
     */
    async downloadSprite(pokemonId) {
        const url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`;
        const rawPath = path.join(this.cacheDir, `pokemon_${pokemonId}_raw.png`);

        // Check if already cached
        if (fs.existsSync(rawPath)) {
            console.log(`✅ Using cached sprite: ${rawPath}`);
            return rawPath;
        }

        console.log(`📥 Downloading Pokemon #${pokemonId} sprite...`);
        console.log(`   URL: ${url}`);

        return new Promise((resolve, reject) => {
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download sprite: ${response.statusCode}`));
                    return;
                }

                const fileStream = fs.createWriteStream(rawPath);
                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();
                    console.log(`✅ Downloaded: ${rawPath}`);

                    // Get file info
                    const stats = fs.statSync(rawPath);
                    console.log(`   Size: ${(stats.size / 1024).toFixed(1)}KB`);

                    resolve(rawPath);
                });
            }).on('error', reject);
        });
    }

    /**
     * Get Pokemon name from Bulbapedia data (simplified list)
     */
    getPokemonName(pokemonId) {
        // Top 151 Pokemon names for demo
        const names = {
            1: 'Bulbasaur', 4: 'Charmander', 7: 'Squirtle', 25: 'Pikachu',
            39: 'Jigglypuff', 54: 'Psyduck', 94: 'Gengar', 132: 'Ditto',
            133: 'Eevee', 143: 'Snorlax', 144: 'Articuno', 145: 'Zapdos',
            146: 'Moltres', 150: 'Mewtwo', 151: 'Mew'
        };

        return names[pokemonId] || `Pokemon #${pokemonId}`;
    }

    /**
     * Demo: Show today's Pokemon info
     */
    async demonstrateDaily() {
        console.log('\n🎮 POKEMON SPRITE E-INK INTEGRATION DEMO\n');
        console.log('═══════════════════════════════════════════\n');

        const pokemonId = this.getDailyPokemonId();
        const pokemonName = this.getPokemonName(pokemonId);

        console.log('📅 Today\'s Pokemon:');
        console.log(`   ID: ${pokemonId}`);
        console.log(`   Name: ${pokemonName}`);
        console.log(`   Date: ${new Date().toDateString()}`);
        console.log();

        try {
            const spritePath = await this.downloadSprite(pokemonId);

            console.log('\n📋 Integration Summary:');
            console.log('   ✅ Sprite downloaded successfully');
            console.log('   ✅ Cached for fast future access');
            console.log('   ⏭️  Next step: Convert to grayscale e-ink format');
            console.log('   ⏭️  Final step: Render on dashboard layout');

            console.log('\n🎨 E-ink Processing Steps:');
            console.log('   1. Convert RGBA → Grayscale (mode L)');
            console.log('   2. Remove alpha channel (white background)');
            console.log('   3. Apply high contrast (autocontrast)');
            console.log('   4. Resize to fit dashboard area (150x150px)');
            console.log('   5. Optimize PNG compression');

            console.log('\n📐 Dashboard Layout Integration:');
            console.log('   Position: Top-right corner (row 1-3, col 6-7)');
            console.log('   Size: 150x150px area');
            console.log('   Style: High contrast grayscale');
            console.log('   Label: Pokemon #' + pokemonId);

            console.log('\n🔄 Daily Rotation:');
            console.log('   Algorithm: Date-based seed (deterministic)');
            console.log('   Changes at: Midnight (00:00 local time)');
            console.log('   Persistence: Same Pokemon all day');
            console.log('   Cache: Reuses downloaded sprites');

            console.log('\n✨ Tomorrow\'s Pokemon Preview:');
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowId = this.getTomorrowsPokemonId();
            const tomorrowName = this.getPokemonName(tomorrowId);
            console.log(`   ${tomorrow.toDateString()}: #${tomorrowId} ${tomorrowName}`);

            console.log('\n═══════════════════════════════════════════');
            console.log('✅ Demo Complete!\n');

        } catch (error) {
            console.error('\n❌ Error:', error.message);
            console.log('\n💡 Fallback behavior:');
            console.log('   - Show "Pokemon unavailable" message');
            console.log('   - Retry on next dashboard update');
            console.log('   - Dashboard still generates successfully');
        }
    }

    /**
     * Get tomorrow's Pokemon ID (for preview)
     */
    getTomorrowsPokemonId() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dayOfYear = Math.floor((tomorrow - new Date(tomorrow.getFullYear(), 0, 0)) / 86400000);
        const year = tomorrow.getFullYear();
        const seed = year * 1000 + dayOfYear;
        return (seed % 1025) + 1;
    }

    /**
     * Test multiple days of Pokemon rotation
     */
    demonstrateWeekRotation() {
        console.log('\n🗓️  7-DAY POKEMON ROTATION PREVIEW\n');
        console.log('═══════════════════════════════════════════\n');

        for (let i = 0; i < 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);

            const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
            const year = date.getFullYear();
            const seed = year * 1000 + dayOfYear;
            const pokemonId = (seed % 1025) + 1;
            const pokemonName = this.getPokemonName(pokemonId);

            const label = i === 0 ? '📍 Today' : `   Day +${i}`;
            console.log(`${label}: ${date.toDateString()}`);
            console.log(`           Pokemon #${pokemonId} - ${pokemonName}\n`);
        }

        console.log('═══════════════════════════════════════════\n');
    }
}

// Run demo
async function main() {
    const service = new PokemonServiceDemo();

    // Show today's Pokemon with download
    await service.demonstrateDaily();

    // Show week rotation preview
    service.demonstrateWeekRotation();

    console.log('💡 Next Steps:');
    console.log('   1. Implement PokemonService in server/pokemon-service.js');
    console.log('   2. Add PokemonSpriteComponent to dashboard-engine.js');
    console.log('   3. Create weather-pokemon.json layout');
    console.log('   4. Test on actual Kindle e-ink display');
    console.log('   5. Deploy to production\n');
}

main().catch(console.error);
