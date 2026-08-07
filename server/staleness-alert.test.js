#!/usr/bin/env node

/**
 * Tests for StalenessAlertState
 * Run with: node server/staleness-alert.test.js
 */

const { StalenessAlertState } = require('./staleness-alert');

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

// All fixtures sit in July (CDT, UTC-5) so the offset math below is fixed.
const MIN = 60 * 1000;
function central(day, hour, minute = 0) {
    return Date.UTC(2026, 6, day, hour + 5, minute); // +5h: CDT -> UTC
}

function runTests() {
    console.log('\n🧪 Running StalenessAlertState Tests\n');
    console.log('═══════════════════════════════════════════\n');

    console.log('Test 1: Quiet outside active hours');
    {
        const s = new StalenessAlertState({ thresholdMs: 45 * MIN });
        assertEquals(s.evaluate(central(15, 3, 0)).stale, false, '3am with no fetch ever is not stale');
        assertEquals(s.evaluate(central(15, 23, 0)).stale, false, '11pm with no fetch ever is not stale');
    }

    console.log('\nTest 2: Grace period on entering active hours (overnight gap)');
    {
        // Last real fetch was 9pm the day before — ~10 hours of silence by
        // 7am. Without the grace anchor this would false-alarm immediately.
        const s = new StalenessAlertState({ thresholdMs: 45 * MIN });
        s.recordFetch(central(14, 21, 0));
        assertEquals(s.evaluate(central(15, 7, 0)).notify, false, 'no alert right at active-hours start');
        assertEquals(s.evaluate(central(15, 7, 10)).notify, false, 'no alert 10 min into the window');
    }

    console.log('\nTest 3: Alerts once after the threshold elapses with no fetch');
    {
        const s = new StalenessAlertState({ thresholdMs: 45 * MIN });
        s.evaluate(central(15, 7, 0)); // enters active window, sets grace anchor
        const still = s.evaluate(central(15, 7, 40));
        assertEquals(still.notify, false, '40 min in: still under threshold');
        const late = s.evaluate(central(15, 7, 50));
        assertEquals(late.notify, true, '50 min in: threshold crossed, alert fires');
        assertEquals(late.stale, true, 'stale flag set');
    }

    console.log('\nTest 4: Latches — no repeat alert while still silent');
    {
        const s = new StalenessAlertState({ thresholdMs: 45 * MIN });
        s.evaluate(central(15, 7, 0));
        assertEquals(s.evaluate(central(15, 7, 50)).notify, true, 'first check past threshold alerts');
        assertEquals(s.evaluate(central(15, 8, 30)).notify, false, 'still silent an hour later: no repeat alert');
        assertEquals(s.evaluate(central(15, 8, 30)).stale, true, 'but still reports stale');
    }

    console.log('\nTest 5: A fetch clears staleness and re-arms for the next episode');
    {
        const s = new StalenessAlertState({ thresholdMs: 45 * MIN });
        s.evaluate(central(15, 7, 0));
        assertEquals(s.evaluate(central(15, 7, 50)).notify, true, 'goes stale and alerts');

        s.recordFetch(central(15, 8, 0));
        assertEquals(s.evaluate(central(15, 8, 10)).stale, false, 'fetch clears the stale state');

        // Silent again for another 46 min — should alert again, not be
        // suppressed by the earlier latch.
        assertEquals(s.evaluate(central(15, 8, 56)).notify, true, 're-arms and alerts on a second episode');
    }

    console.log('\nTest 6: Regular fetches every 15 min never go stale');
    {
        const s = new StalenessAlertState({ thresholdMs: 45 * MIN });
        let anyStale = false;
        for (let m = 0; m <= 180; m += 15) {
            s.recordFetch(central(15, 7, m));
            if (s.evaluate(central(15, 7, m)).stale) anyStale = true;
        }
        assertEquals(anyStale, false, 'no staleness with a healthy 15-min cadence');
    }

    console.log('\nTest 7: Active-hours boundary respects configured window');
    {
        const s = new StalenessAlertState({ thresholdMs: 10 * MIN, activeHoursStart: 9, activeHoursEnd: 17 });
        assertEquals(s.isActiveHour(central(15, 8, 59)), false, '8:59 is before a 9-17 window');
        assertEquals(s.isActiveHour(central(15, 9, 0)), true, '9:00 is inside a 9-17 window');
        assertEquals(s.isActiveHour(central(15, 16, 59)), true, '16:59 is inside a 9-17 window');
        assertEquals(s.isActiveHour(central(15, 17, 0)), false, '17:00 is outside a 9-17 window');
    }

    console.log('\n═══════════════════════════════════════════');
    console.log(`\n${testsPassed} passed, ${testsFailed} failed\n`);
    return testsFailed === 0;
}

process.exit(runTests() ? 0 : 1);
