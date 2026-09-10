#!/usr/bin/env node

/**
 * Tests for FitnessService
 * Run with: node server/fitness-service.test.js
 */

const fs = require('fs');
const FitnessService = require('./fitness-service');

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

async function runTests() {
    console.log('\n🧪 Running FitnessService Tests\n');

    const service = new FitnessService({ useFixtures: true });

    console.log('Fixture fallback:');
    const data = await service.getFitnessData();
    assert(data.source === 'fixture', 'useFixtures serves fixture source');

    console.log('\nWeight:');
    assert(data.weight !== null, 'weight present');
    assert(data.weight.lb === 164.7, 'kg converts to lb rounded to 0.1 (74.71kg -> 164.7lb)');
    assert(data.weight.date === '2026-06-24', 'weight carries its snapshot date');

    console.log('\nNutrition:');
    assert(data.nutrition.calories.current === 703 && data.nutrition.calories.target === 1800, 'calorie current/target pass through');
    assert(data.nutrition.protein.target === 170, 'protein target passes through');
    assert(data.nutrition.isStale === true, 'stale flag passes through');
    assert(data.nutrition.isInCut === false, 'cut flag passes through');

    console.log('\nRecovery:');
    assert(data.recovery.length === 10, 'all muscle groups present');
    assert(data.recovery[0].pct <= data.recovery[data.recovery.length - 1].pct, 'sorted least-recovered first');
    assert(data.recovery[0].muscle === 'quads' && data.recovery[0].pct === 55, 'least-recovered muscle first');
    assert(data.fullyRecovered === false, 'not fully recovered with sub-100 muscles');

    console.log('\nFully recovered:');
    const allRecovered = service.parseData({
        nutrition: {},
        recovery: { muscles: [{ name: 'chest', recoveryPct: 100 }, { name: 'back', recoveryPct: 100 }] },
        latestSnapshot: null
    });
    assert(allRecovered.fullyRecovered === true, 'fullyRecovered true when every muscle at 100');
    assert(allRecovered.weight === null, 'missing snapshot yields null weight');
    assert(allRecovered.nutrition.calories.current === 0, 'missing nutrition defaults to zeros');

    console.log('\nUnconfigured:');
    const noKey = new FitnessService({ apiKey: null, cacheDir: fs.mkdtempSync('/tmp/fitness-test-') });
    const fallback = await noKey.getFitnessData();
    assert(fallback.source === 'fixture', 'missing key falls through to fixture');

    console.log(`\n${testsPassed} passed, ${testsFailed} failed\n`);
    if (testsFailed > 0) process.exit(1);
}

runTests().catch((error) => {
    console.error(`Test run crashed: ${error.message}`);
    process.exit(1);
});
