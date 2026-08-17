#!/usr/bin/env node

/**
 * Tests for TransitService
 * Run with: node server/transit-service.test.js
 */

const fs = require('fs');
const path = require('path');
const TransitService = require('./transit-service');

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

function loadFixture(name) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'transit', name), 'utf8'));
}

async function runTests() {
    console.log('\n🧪 Running TransitService Tests\n');
    console.log('═══════════════════════════════════════════\n');

    const service = new TransitService({ cacheDir: path.join(__dirname, '..', 'cache', 'transit-test') });

    // Test 1: bus parsing groups by route+stop and sorts arrivals
    console.log('Test 1: parseBusPredictions');
    const bus = service.parseBusPredictions(loadFixture('bus-predictions.json'));
    assert(bus.length === 3, 'Returns one entry per configured bus stop/route');
    const route8 = bus.find(b => b.route === '8');
    assert(route8.arrivals.length === 2, 'Route 8 has 2 arrivals from fixture');
    assert(route8.arrivals[0].minutes === 5, 'Route 8 arrivals sorted ascending by minutes');
    const route146 = bus.find(b => b.route === '146');
    assert(route146.arrivals.some(a => a.isDelayed === true), 'Delayed bus prediction flagged isDelayed');
    console.log();

    // Test 2: bus error/empty response yields empty arrivals, not a crash
    console.log('Test 2: parseBusPredictions empty state');
    const busEmpty = service.parseBusPredictions(loadFixture('bus-predictions-empty.json'));
    assert(busEmpty.every(b => b.arrivals.length === 0), 'All stops have empty arrivals on a "No arrival times" response');
    console.log();

    // Test 3: train parsing filters by exact platform stpId (direction)
    console.log('Test 3: parseTrainArrivals filters by direction');
    const trainRaw = loadFixture('train-arrivals.json');
    const now = new Date(trainRaw.ctatt.tmst).getTime();
    const rail = service.parseTrainArrivals(trainRaw, now);
    const red = rail.find(l => l.route === 'Red');
    const brn = rail.find(l => l.route === 'Brn');
    assert(red.arrivals.length === 2, 'Red Line only counts the Loop-bound (South) platform, not Howard-bound');
    assert(brn.arrivals.length === 2, 'Brown Line only counts the Loop-bound platform, not Kimball-bound');
    assert(red.arrivals[0].minutes === 3, 'Red Line arrival minutes computed from arrT - tmst');
    assert(red.rideMinutesToLoop === 15, 'Red Line carries the static ride-time-to-Loop estimate');
    assert(brn.arrivals.some(a => a.isDelayed === true), 'Delayed train arrival flagged isDelayed');
    console.log();

    // Test 4: train empty response (late night) yields empty arrivals
    console.log('Test 4: parseTrainArrivals empty state');
    const railEmpty = service.parseTrainArrivals(loadFixture('train-arrivals-empty.json'));
    assert(railEmpty.every(l => l.arrivals.length === 0), 'No etas in feed means empty arrivals for every line');
    console.log();

    // Test 5: alerts parsing
    console.log('Test 5: parseAlerts');
    const alerts = service.parseAlerts(loadFixture('alerts.json'));
    assert(alerts.length === 2, 'Parses both alerts from fixture');
    assert(alerts[0].routes.includes('Red'), 'Alert carries its impacted route id(s)');
    assert(alerts[0].isMajor === true, 'MajorAlert="1" maps to isMajor true');
    assert(alerts[1].isMajor === false, 'MajorAlert="0" maps to isMajor false');
    console.log();

    // Test 6: end-to-end getTransitData falls back to fixtures when no API keys are configured
    console.log('Test 6: getTransitData without API keys uses fixtures, alerts still live');
    const unconfigured = new TransitService({
        cacheDir: path.join(__dirname, '..', 'cache', 'transit-test'),
        busApiKey: null,
        trainApiKey: null
    });
    const data = await unconfigured.getTransitData();
    assert(data.bus.source === 'fixture', 'Bus falls back to fixture with no key configured');
    assert(data.rail.source === 'fixture', 'Train falls back to fixture with no key configured');
    assert(data.hasAnyArrivals === true, 'Fixture data reports arrivals present');
    assert(Array.isArray(data.alerts), 'Alerts array present (attempted live, no key needed)');
    console.log();

    // Test 7: late-night fixtures produce hasAnyArrivals=false for the empty-state UI
    console.log('Test 7: late-night empty state');
    const lateNight = new TransitService({
        cacheDir: path.join(__dirname, '..', 'cache', 'transit-test-latenight'),
        useFixtures: true,
        fixturesDir: path.join(__dirname, 'fixtures', 'transit-late-night')
    });
    const lateNightData = await lateNight.getTransitData();
    assert(lateNightData.hasAnyArrivals === false, 'Empty bus + train fixtures produce hasAnyArrivals=false');
    console.log();

    // Cleanup test cache dirs
    for (const dir of ['transit-test', 'transit-test-latenight']) {
        const p = path.join(__dirname, '..', 'cache', dir);
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    }

    console.log('═══════════════════════════════════════════');
    console.log(`\n${testsPassed} passed, ${testsFailed} failed\n`);
    if (testsFailed > 0) process.exit(1);
}

runTests().catch(error => {
    console.error('Test run failed:', error);
    process.exit(1);
});
