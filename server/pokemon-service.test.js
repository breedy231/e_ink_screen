#!/usr/bin/env node

/**
 * Tests for PokemonService and PokemonSelector
 * Run with: node server/pokemon-service.test.js
 */

const PokemonService = require('./pokemon-service');
const PokemonSelector = require('./pokemon-selector');
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

    // Test 1: Mock data returns expected format
    console.log('Test 1: Mock Data Format');
    const mockService = new PokemonService({ mockData: true });
    const mockData = mockService.getMockPokemonData();
    assert(mockData.id !== undefined, 'Mock data has id');
    assert(mockData.name !== undefined, 'Mock data has name');
    assert(mockData.source === 'mock', 'Mock data has correct source');
    assert(Array.isArray(mockData.types), 'Mock data has types array');
    console.log();

    // Test 2: Sprite paths are correct
    console.log('Test 2: Sprite Path Generation');
    const testCacheDir = path.join(__dirname, '..', 'cache', 'pokemon');
    const testService = new PokemonService({ cacheDir: testCacheDir });
    const paths = testService.getSpritePaths(25);
    assert(paths.raw.includes('pokemon_25_raw.png'), 'Raw sprite path includes Pokemon ID');
    assert(paths.optimized.includes('pokemon_25_eink.png'), 'Optimized sprite path includes Pokemon ID');
    console.log();

    // Test 3: Pokemon name lookup from database
    console.log('Test 3: Pokemon Name Lookup');
    const service = new PokemonService({ mockData: false });
    const name = service.getPokemonName(25);
    assert(name === 'Pikachu' || name.includes('#25'), `Pokemon #25 name lookup works: ${name}`);
    console.log();

    // Test 4: Formatted output structure includes name in displayName
    console.log('Test 4: Dashboard Format');
    const mockPokemon = { id: 25, name: 'Pikachu', types: ['electric'], reason: 'weather', spritePath: '/path/to/sprite.png', source: 'cache' };
    const formatted = service.formatPokemonForDashboard(mockPokemon);
    assertEquals(formatted.id, 25, 'Formatted data has id');
    assertEquals(formatted.name, 'Pikachu', 'Formatted data has name');
    assertEquals(formatted.displayName, '#25 Pikachu', 'Formatted data has displayName with number and name');
    assert(formatted.hasSprite === true, 'Formatted data indicates sprite availability');
    assert(formatted.reason === 'weather', 'Formatted data includes selection reason');
    assert(Array.isArray(formatted.types), 'Formatted data includes types');
    console.log();

    // Test 5: Error handling for missing sprite
    console.log('Test 5: Error Handling');
    const errorPokemon = { id: 1, name: 'Bulbasaur', types: ['grass', 'poison'], reason: 'fallback', spritePath: null, source: 'error', error: 'Network failure' };
    const formattedError = service.formatPokemonForDashboard(errorPokemon);
    assert(formattedError.hasSprite === false, 'Error state correctly indicates no sprite');
    console.log();

    // Test 6: Cache directory creation
    console.log('Test 6: Cache Directory Initialization');
    const tempCacheDir = path.join(__dirname, '..', 'cache', 'pokemon_test_temp');
    if (fs.existsSync(tempCacheDir)) {
        fs.rmSync(tempCacheDir, { recursive: true });
    }
    new PokemonService({ cacheDir: tempCacheDir });
    assert(fs.existsSync(tempCacheDir), 'Cache directory created automatically');
    fs.rmSync(tempCacheDir, { recursive: true });
    console.log();

    // Test 7: PokemonSelector - Weather type mapping
    console.log('Test 7: Weather Type Mapping');
    const selector = new PokemonSelector();
    const rainyWeather = { current: { icon: 'rain', temperature: '55°F' } };
    const weatherTypes = selector.getWeatherTypes(rainyWeather);
    assert(weatherTypes.includes('water'), 'Rain maps to water type');
    assert(weatherTypes.includes('electric'), 'Rain maps to electric type');

    const snowyWeather = { current: { icon: 'snow', temperature: '25°F' } };
    const snowTypes = selector.getWeatherTypes(snowyWeather);
    assert(snowTypes.includes('ice'), 'Snow maps to ice type');
    console.log();

    // Test 8: PokemonSelector - Holiday detection
    console.log('Test 8: Holiday Detection');
    // Use noon times to avoid timezone issues
    const halloween = selector.getHolidayContext(new Date('2025-10-31T12:00:00'));
    assert(halloween !== null, 'October 31 is detected as a holiday');
    assert(halloween.name === 'Halloween', `Holiday name is Halloween: ${halloween.name}`);
    assert(halloween.types.includes('ghost'), 'Halloween includes ghost type');

    const christmas = selector.getHolidayContext(new Date('2025-12-25T12:00:00'));
    assert(christmas !== null, 'December 25 is detected as a holiday');
    assert(christmas.name === 'Christmas', `Holiday name is Christmas: ${christmas.name}`);
    console.log();

    // Test 9: PokemonSelector - Calendar context
    console.log('Test 9: Calendar Event Matching');
    const calendarData = {
        today: [
            { name: 'Birthday party for Alex', allDay: false },
            { name: 'Gym session', allDay: false }
        ],
        tomorrow: []
    };
    const calCtx = selector.getCalendarContext(calendarData);
    assert(calCtx.types.has('fairy'), 'Birthday maps to fairy type');
    assert(calCtx.types.has('fighting'), 'Gym maps to fighting type');
    console.log();

    // Test 10: PokemonSelector - No-repeat with temp history
    console.log('Test 10: No-Repeat Selection');
    const tempHistoryFile = path.join(__dirname, '..', 'cache', 'pokemon-history-test.json');
    if (fs.existsSync(tempHistoryFile)) fs.unlinkSync(tempHistoryFile);

    const testSelector = new PokemonSelector({ historyFile: tempHistoryFile });
    if (testSelector.getTotalCount() > 0) {
        const result1 = testSelector.selectPokemon({ date: new Date('2025-06-01') });
        // Force a new day by clearing lastDate
        const hist = JSON.parse(fs.readFileSync(tempHistoryFile, 'utf8'));
        hist.lastDate = null;
        fs.writeFileSync(tempHistoryFile, JSON.stringify(hist));

        const result2 = testSelector.selectPokemon({ date: new Date('2025-06-02') });
        assert(result1.id !== result2.id, `Two different days select different Pokemon (${result1.id} vs ${result2.id})`);

        // Check history was updated
        const histAfter = JSON.parse(fs.readFileSync(tempHistoryFile, 'utf8'));
        assert(histAfter.shown.length === 2, `History shows 2 Pokemon selected: ${histAfter.shown.length}`);
        assert(!histAfter.shown.includes(undefined), 'No undefined values in history');
    } else {
        console.log('  ⚠ Skipping no-repeat test (pokemon-data.json not available)');
    }
    if (fs.existsSync(tempHistoryFile)) fs.unlinkSync(tempHistoryFile);
    console.log();

    // Test 11: Fallback selection works without database
    console.log('Test 11: Fallback Selection');
    const fallback = service._fallbackSelection(new Date('2025-11-12'));
    assert(fallback.id >= 1 && fallback.id <= 1025, `Fallback ID in valid range: ${fallback.id}`);
    assert(fallback.source === 'fallback', 'Fallback source is correct');
    console.log();

    // Test 12: History stats
    console.log('Test 12: History Stats');
    const stats = service.getHistoryStats();
    assert(typeof stats.shown === 'number', 'Stats has shown count');
    assert(typeof stats.total === 'number', 'Stats has total count');
    assert(typeof stats.percentComplete === 'number', 'Stats has percent complete');
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
