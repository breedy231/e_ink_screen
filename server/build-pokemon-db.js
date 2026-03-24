#!/usr/bin/env node

/**
 * Build Pokemon Database
 * Fetches all Pokemon (1-1025) with names and types from PokeAPI
 * Outputs pokemon-data.json for use by the selector
 *
 * Usage: node build-pokemon-db.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'pokemon-data.json');
const TOTAL_POKEMON = 1025;
const BATCH_SIZE = 50; // Fetch in batches to avoid overwhelming the API

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`JSON parse error: ${e.message}`));
                }
            });
        }).on('error', reject);
    });
}

async function fetchPokemon(id) {
    const data = await fetchJSON(`https://pokeapi.co/api/v2/pokemon/${id}`);
    return {
        id: data.id,
        name: data.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-'),
        types: data.types.map(t => t.type.name)
    };
}

async function fetchBatch(ids) {
    const results = [];
    for (const id of ids) {
        try {
            const pokemon = await fetchPokemon(id);
            results.push(pokemon);
            if (id % 100 === 0) {
                console.log(`  Fetched ${id}/${TOTAL_POKEMON}...`);
            }
        } catch (error) {
            console.warn(`  Warning: Failed to fetch Pokemon #${id}: ${error.message}`);
            // Add placeholder
            results.push({ id, name: `Pokemon #${id}`, types: ['normal'] });
        }
    }
    return results;
}

async function main() {
    console.log(`Building Pokemon database (1-${TOTAL_POKEMON})...`);

    const allPokemon = [];

    for (let start = 1; start <= TOTAL_POKEMON; start += BATCH_SIZE) {
        const end = Math.min(start + BATCH_SIZE - 1, TOTAL_POKEMON);
        const ids = [];
        for (let i = start; i <= end; i++) ids.push(i);

        console.log(`Fetching batch ${start}-${end}...`);
        const batch = await fetchBatch(ids);
        allPokemon.push(...batch);

        // Small delay between batches
        if (end < TOTAL_POKEMON) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // Sort by ID
    allPokemon.sort((a, b) => a.id - b.id);

    // Write output
    const output = {
        _meta: {
            totalPokemon: allPokemon.length,
            generatedAt: new Date().toISOString(),
            source: 'PokeAPI (pokeapi.co)'
        },
        pokemon: allPokemon
    };

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
    console.log(`\nDone! Wrote ${allPokemon.length} Pokemon to ${OUTPUT_FILE}`);

    // Print type distribution
    const typeCounts = {};
    for (const p of allPokemon) {
        for (const t of p.types) {
            typeCounts[t] = (typeCounts[t] || 0) + 1;
        }
    }
    console.log('\nType distribution:');
    Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => console.log(`  ${type}: ${count}`));
}

main().catch(console.error);
