#!/usr/bin/env node

/**
 * Tests for BedtimeAlertState
 * Run with: node server/bedtime-alert.test.js
 */

const { BedtimeAlertState } = require('./bedtime-alert');

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

/**
 * Test fixture: compute epoch ms for a given Chicago local time.
 *
 * In August, Chicago is CDT (UTC-5). So to get a local time of (day, hour, min):
 * - Convert to UTC by adding 5 hours
 * - Construct Date.UTC(year, month, day, hour+5, min)
 * - August = month 7 (0-indexed)
 *
 * Examples:
 * - Aug 9 21:15 CDT = Aug 10 02:15 UTC
 * - Aug 9 22:15 CDT = Aug 10 03:15 UTC
 * - Aug 9 20:45 CDT = Aug 10 01:45 UTC
 */
function chicagoTime(day, hour, minute = 0) {
    // August 2026 is CDT (UTC-5)
    return Date.UTC(2026, 7, day, hour + 5, minute);
}

function runTests() {
    console.log('\n🧪 Running BedtimeAlertState Tests\n');
    console.log('═══════════════════════════════════════════\n');

    console.log('Test 1: Fires at 21:15 with 22% not charging');
    {
        const s = new BedtimeAlertState();
        const now = chicagoTime(9, 21, 15);
        const result = s.evaluate('22', '0', now);
        assertEquals(result.notify, true, 'fires in bedtime window with low battery');
        assertEquals(result.level, 22, 'level is 22%');
    }

    console.log('\nTest 2: Silent before window (20:45)');
    {
        const s = new BedtimeAlertState();
        const now = chicagoTime(9, 20, 45);
        const result = s.evaluate('22', '0', now);
        assertEquals(result.notify, false, 'no alert before 21:00');
    }

    console.log('\nTest 3: Silent after window (22:15)');
    {
        const s = new BedtimeAlertState();
        const now = chicagoTime(9, 22, 15);
        const result = s.evaluate('22', '0', now);
        assertEquals(result.notify, false, 'no alert at or after 22:00');
    }

    console.log('\nTest 4: Silent when battery is above safe level (41%)');
    {
        const s = new BedtimeAlertState();
        const now = chicagoTime(9, 21, 30);
        const result = s.evaluate('41', '0', now);
        assertEquals(result.notify, false, 'no alert when battery above 40%');
    }

    console.log('\nTest 5: Fires at exactly safe level boundary (40%)');
    {
        const s = new BedtimeAlertState();
        const now = chicagoTime(9, 21, 30);
        const result = s.evaluate('40', '0', now);
        assertEquals(result.notify, true, 'fires at exactly 40% (safeLevel)');
        assertEquals(result.level, 40, 'level is 40%');
    }

    console.log('\nTest 6: Silent when charging, even at critical low (10%)');
    {
        const s = new BedtimeAlertState();
        const now = chicagoTime(9, 21, 30);
        const result = s.evaluate('10', '1', now);
        assertEquals(result.notify, false, 'no alert when charging, regardless of level');
    }

    console.log('\nTest 7: Only one alert per evening (latch)');
    {
        const s = new BedtimeAlertState();
        const now = chicagoTime(9, 21, 15);

        const first = s.evaluate('22', '0', now);
        assertEquals(first.notify, true, 'first call fires');

        const second = s.evaluate('20', '0', chicagoTime(9, 21, 45));
        assertEquals(second.notify, false, 'second call same evening suppressed');
    }

    console.log('\nTest 8: Fires again on the NEXT evening (different local date)');
    {
        const s = new BedtimeAlertState();
        const night1 = chicagoTime(9, 21, 15);
        const night2 = chicagoTime(10, 21, 15);

        const first = s.evaluate('22', '0', night1);
        assertEquals(first.notify, true, 'first night fires');

        const second = s.evaluate('22', '0', night2);
        assertEquals(second.notify, true, 'next night fires again (different date)');
    }

    console.log('\nTest 9: Charging clears latch, so unplugged-still-low same evening re-alerts');
    {
        const s = new BedtimeAlertState();
        const now = chicagoTime(9, 21, 15);

        // First alert at 21:15, battery low, not charging
        const first = s.evaluate('22', '0', now);
        assertEquals(first.notify, true, 'first alert fires');

        // At 21:20, plugged in (charging='1')
        const charging = s.evaluate('22', '1', chicagoTime(9, 21, 20));
        assertEquals(charging.notify, false, 'no alert when charging');
        // Latch is cleared by the charging status

        // At 21:25, unplugged again while still at 20%
        const unplugged = s.evaluate('20', '0', chicagoTime(9, 21, 25));
        assertEquals(unplugged.notify, true, 're-alerts same evening after charging cleared the latch');
    }

    console.log('\nTest 10: Invalid/missing battery values');
    {
        const s = new BedtimeAlertState();
        const now = chicagoTime(9, 21, 15);

        assertEquals(s.evaluate(null, '0', now).notify, false, 'null level does not alert');
        assertEquals(s.evaluate(undefined, '0', now).notify, false, 'undefined level does not alert');
        assertEquals(s.evaluate('', '0', now).notify, false, 'empty string does not alert');
        assertEquals(s.evaluate('not-a-number', '0', now).notify, false, 'NaN level does not alert');
    }

    console.log('\nTest 11: Custom window and safeLevel via constructor opts');
    {
        // Bedtime from 19:00-20:00, safe level 50%
        const s = new BedtimeAlertState({
            windowStartHour: 19,
            windowEndHour: 20,
            safeLevel: 50
        });
        const now = chicagoTime(9, 19, 30);

        // 51% in custom window: no alert (above safe level)
        assertEquals(s.evaluate('51', '0', now).notify, false, 'no alert when battery > custom safeLevel');

        // 50% in custom window: alert (at boundary)
        assertEquals(s.evaluate('50', '0', now).notify, true, 'fires at custom safeLevel boundary');

        // Outside custom window (20:30): no alert
        assertEquals(s.evaluate('10', '0', chicagoTime(9, 20, 30)).notify, false, 'no alert outside custom window');
    }

    console.log('\nTest 12: Custom timezone (e.g. Los Angeles)');
    {
        // PST/PDT is UTC-8. Let's test that a time that would be outside the
        // Chicago window is still handled correctly in a different timezone.
        const chicagoAlertTime = chicagoTime(9, 21, 15); // Aug 9 21:15 CDT

        const s = new BedtimeAlertState({ timezone: 'America/Los_Angeles' });
        // This same epoch is Aug 9 19:15 PDT (3 hours earlier)
        // With window 21-22, this is outside the window, so no alert
        const result = s.evaluate('22', '0', chicagoAlertTime);
        assertEquals(result.notify, false, 'respects custom timezone for window boundaries');
    }

    console.log('\nTest 13: String levels (the Kindle sends query-string values)');
    {
        const s = new BedtimeAlertState();
        const now = chicagoTime(9, 21, 30);
        assertEquals(s.evaluate('35', '0', now).notify, true, 'string "35" (below safe) alerts');
        assertEquals(s.evaluate('42', '0', now).notify, false, 'string "42" (above safe) does not alert');
    }

    console.log('\nTest 14: Alert continues to return level even when notify is false');
    {
        const s = new BedtimeAlertState();
        const now = chicagoTime(9, 21, 30);

        // Above safe level: should still report the level
        const aboveSafe = s.evaluate('50', '0', now);
        assertEquals(aboveSafe.notify, false, 'no alert above safe level');
        assertEquals(aboveSafe.level, 50, 'but level is still reported');

        // Outside window: should still report the level
        const outside = s.evaluate('20', '0', chicagoTime(9, 20, 30));
        assertEquals(outside.notify, false, 'no alert outside window');
        assertEquals(outside.level, 20, 'but level is still reported');

        // While charging: should still report the level
        const charging = s.evaluate('15', '1', chicagoTime(9, 21, 30));
        assertEquals(charging.notify, false, 'no alert while charging');
        assertEquals(charging.level, 15, 'but level is still reported');
    }

    console.log('\n═══════════════════════════════════════════');
    console.log(`\n${testsPassed} passed, ${testsFailed} failed\n`);
    return testsFailed === 0;
}

process.exit(runTests() ? 0 : 1);
