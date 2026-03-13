#!/usr/bin/env node

/**
 * Tests for PokemonService
 * Run with: node server/pokemon-service.test.js
 */

const PokemonService = require('./pokemon-service');
const fs = require('fs');
const path = require('path');

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        testsPassed++;
    } else {
        console.error(`  ✗ ${message}`);
        testsFailed++;
    }
}

function assertEquals(actual, expected, message) {
    assert(actual === expected, `${message} (expected: ${expected}, got: ${actual})`);
}

// Test suite
async function runTests() {
    console.log('\n🧪 Running PokemonService Tests\n');
    console.log('═══════════════════════════════════════════\n');

    // Test 1: Daily Pokemon ID is deterministic
    console.log('Test 1: Daily Pokemon ID Generation');
    const service = new PokemonService({ mockData: false });
    const testDate = new Date('2025-11-12');
    const pokemonId1 = service.getDailyPokemonId(testDate);
    const pokemonId2 = service.getDailyPokemonId(testDate);
    assertEquals(pokemonId1, pokemonId2, 'Same date produces same Pokemon ID');
    assert(pokemonId1 >= 1 && pokemonId1 <= 1025, `Pokemon ID in valid range (1-1025): ${pokemonId1}`);
    console.log();

    // Test 2: Different dates produce different Pokemon
    console.log('Test 2: Daily Rotation');
    const date1 = new Date('2025-11-12');
    const date2 = new Date('2025-11-13');
    const id1 = service.getDailyPokemonId(date1);
    const id2 = service.getDailyPokemonId(date2);
    assert(id1 !== id2, `Different dates produce different Pokemon (${id1} vs ${id2})`);
    console.log();

    // Test 3: Mock data returns expected format
    console.log('Test 3: Mock Data Format');
    const mockService = new PokemonService({ mockData: true });
    const mockData = mockService.getMockPokemonData();
    assert(mockData.id !== undefined, 'Mock data has id');
    assert(mockData.name !== undefined, 'Mock data has name');
    assert(mockData.source === 'mock', 'Mock data has correct source');
    console.log();

    // Test 4: Sprite paths are correct
    console.log('Test 4: Sprite Path Generation');
    const testCacheDir = path.join(__dirname, '..', 'cache', 'pokemon');
    const testService = new PokemonService({ cacheDir: testCacheDir });
    const paths = testService.getSpritePaths(25);
    assert(paths.raw.includes('pokemon_25_raw.png'), 'Raw sprite path includes Pokemon ID');
    assert(paths.optimized.includes('pokemon_25_eink.png'), 'Optimized sprite path includes Pokemon ID');
    console.log();

    // Test 5: Pokemon name lookup
    console.log('Test 5: Pokemon Name Lookup');
    assertEquals(service.getPokemonName(25), 'Pikachu', 'Known Pokemon returns name');
    assert(service.getPokemonName(999).includes('#999'), 'Unknown Pokemon returns ID format');
    console.log();

    // Test 6: Formatted output structure
    console.log('Test 6: Dashboard Format');
    const mockPokemon = { id: 25, name: 'Pikachu', spritePath: '/path/to/sprite.png', source: 'cache' };
    const formatted = service.formatPokemonForDashboard(mockPokemon);
    assertEquals(formatted.id, 25, 'Formatted data has id');
    assertEquals(formatted.name, 'Pikachu', 'Formatted data has name');
    assertEquals(formatted.displayName, '#25', 'Formatted data has displayName');
    assert(formatted.hasSprite === true, 'Formatted data indicates sprite availability');
    console.log();

    // Test 7: Error handling for missing sprite
    console.log('Test 7: Error Handling');
    const errorPokemon = { id: 1, name: 'Bulbasaur', spritePath: null, source: 'error', error: 'Network failure' };
    const formattedError = service.formatPokemonForDashboard(errorPokemon);
    assert(formattedError.hasSprite === false, 'Error state correctly indicates no sprite');
    console.log();

    // Test 8: Cache directory creation
    console.log('Test 8: Cache Directory Initialization');
    const tempCacheDir = path.join(__dirname, '..', 'cache', 'pokemon_test_temp');
    if (fs.existsSync(tempCacheDir)) {
        fs.rmSync(tempCacheDir, { recursive: true });
    }
    new PokemonService({ cacheDir: tempCacheDir });
    assert(fs.existsSync(tempCacheDir), 'Cache directory created automatically');
    fs.rmSync(tempCacheDir, { recursive: true });
    console.log();

    // Summary
    console.log('═══════════════════════════════════════════\n');
    console.log(`Tests passed: ${testsPassed}`);
    console.log(`Tests failed: ${testsFailed}`);
    console.log(`Total: ${testsPassed + testsFailed}\n`);

    if (testsFailed === 0) {
        console.log('✅ All tests passed!\n');
        process.exit(0);
    } else {
        console.error('❌ Some tests failed!\n');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Test suite error:', error);
    process.exit(1);
});
