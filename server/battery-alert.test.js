#!/usr/bin/env node

/**
 * Tests for BatteryAlertState
 * Run with: node server/battery-alert.test.js
 */

const { BatteryAlertState } = require('./battery-alert');

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

/** Feed a sequence of readings, return the levels that produced an alert. */
function notifiedLevels(state, readings, charging = '0') {
    const fired = [];
    for (const level of readings) {
        const d = state.evaluate(level, charging);
        if (d.notify) fired.push(d.level);
    }
    return fired;
}

function runTests() {
    console.log('\n🧪 Running BatteryAlertState Tests\n');
    console.log('═══════════════════════════════════════════\n');

    console.log('Test 1: Quiet above the threshold');
    {
        const s = new BatteryAlertState();
        assertEquals(notifiedLevels(s, [100, 80, 42, 16]).length, 0, 'no alerts above 15%');
    }

    console.log('\nTest 2: One alert per 5% bucket on the way down');
    {
        const s = new BatteryAlertState();
        const fired = notifiedLevels(s, [15, 14, 12, 11, 10, 9, 7, 6, 5, 4, 3]);
        assertEquals(fired.join(','), '15,14,9,4', 'fires once per bucket (15, 10, 5, 0)');
    }

    console.log('\nTest 3: Severity flips to Critical at 5%');
    {
        const s = new BatteryAlertState();
        assertEquals(s.evaluate(12, '0').severity, 'Low', '12% is Low');
        const crit = s.evaluate(5, '0');
        assertEquals(crit.severity, 'Critical', '5% is Critical');
        assertEquals(crit.critical, true, '5% sets critical flag');
    }

    console.log('\nTest 4: Silent while charging');
    {
        const s = new BatteryAlertState();
        assertEquals(notifiedLevels(s, [10, 5, 3], '1').length, 0, 'no alerts when charging');
    }

    console.log('\nTest 5: REGRESSION — re-arms after a recharge');
    {
        // The original bug: draining to 3% latched the high-water mark at
        // bucket 0, so every later cycle was suppressed for the life of the
        // process. This is what let the Kindle die unannounced on 2026-06-18.
        const s = new BatteryAlertState();
        const first = notifiedLevels(s, [15, 10, 5, 3]);
        assertEquals(first.length, 4, 'first discharge alerts 4 times');

        // Plugged in and charged back up.
        s.evaluate(60, '1');
        s.evaluate(100, '1');

        const second = notifiedLevels(s, [15, 10, 5, 3]);
        assertEquals(second.length, 4, 'second discharge alerts again after charging');
    }

    console.log('\nTest 6: Re-arms on recovery above threshold without a charging flag');
    {
        const s = new BatteryAlertState();
        notifiedLevels(s, [10]);
        s.evaluate(90, '0'); // recovered; charging flag never observed
        assertEquals(notifiedLevels(s, [10]).length, 1, 'alerts again after recovering above 15%');
    }

    console.log('\nTest 7: Bad input is ignored');
    {
        const s = new BatteryAlertState();
        assertEquals(s.evaluate(null, '0').notify, false, 'null level does not alert');
        assertEquals(s.evaluate(undefined, '0').notify, false, 'undefined level does not alert');
        assertEquals(s.evaluate('', '0').notify, false, 'empty string does not alert');
        assertEquals(s.evaluate('not-a-number', '0').notify, false, 'NaN level does not alert');
    }

    console.log('\nTest 8: String levels (the Kindle sends query-string values)');
    {
        const s = new BatteryAlertState();
        assertEquals(s.evaluate('3', '0').notify, true, 'string "3" alerts');
        assertEquals(s.evaluate('100', '0').notify, false, 'string "100" does not alert');
    }

    console.log('\n═══════════════════════════════════════════');
    console.log(`\n${testsPassed} passed, ${testsFailed} failed\n`);
    return testsFailed === 0;
}

process.exit(runTests() ? 0 : 1);
