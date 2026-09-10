#!/usr/bin/env node

/**
 * Tests for DeviceAlertRegistry
 * Run with: node server/device-alerts.test.js
 */

const { DeviceAlertRegistry, DEFAULT_DEVICE_ID } = require('./device-alerts');

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

// Matches staleness-alert.test.js: July fixtures so CDT (UTC-5) is fixed.
const MIN = 60 * 1000;
function central(day, hour, minute = 0) {
    return Date.UTC(2026, 6, day, hour + 5, minute); // +5h: CDT -> UTC
}

const BOTH = { monitored: ['v0', 'kitchen'], alertConfig: { staleThresholdMs: 45 * MIN } };

function runTests() {
    console.log('\n🧪 Running DeviceAlertRegistry Tests\n');
    console.log('═══════════════════════════════════════════\n');

    console.log('Test 1: Device id resolution');
    {
        const r = new DeviceAlertRegistry(BOTH);
        assertEquals(r.resolveId(null), DEFAULT_DEVICE_ID, 'absent ?device= resolves to the desk Kindle');
        assertEquals(r.resolveId(''), DEFAULT_DEVICE_ID, 'empty ?device= resolves to the desk Kindle');
        assertEquals(r.resolveId('kitchen'), 'kitchen', 'known id passes through');
        assertEquals(r.resolveId('KITCHEN'), 'kitchen', 'id is lowercased');
        assertEquals(r.resolveId('../etc/passwd'), 'invalid', 'malformed id is rejected, not defaulted');
        assertEquals(r.resolveId('x'.repeat(64)), 'invalid', 'over-long id is rejected');
    }

    console.log('\nTest 2: THE BUG — a second device must not vouch for the first');
    {
        const r = new DeviceAlertRegistry(BOTH);
        const v0 = r.get('v0');
        const kitchen = r.get('kitchen');

        // 07:00 — both enter active hours, setting the grace anchor.
        v0.staleness.evaluate(central(15, 7, 0));
        kitchen.staleness.evaluate(central(15, 7, 0));

        // 07:30 — only the kitchen screen checks in.
        r.recordFetch('kitchen', central(15, 7, 30));

        // 08:00 — 60 min since v0's anchor, past the 45 min threshold.
        const v0Decision = v0.staleness.evaluate(central(15, 8, 0));
        const kitchenDecision = kitchen.staleness.evaluate(central(15, 8, 0));

        assertEquals(v0Decision.stale, true, 'desk Kindle is stale after 60 min of silence');
        assertEquals(v0Decision.notify, true, 'desk Kindle ALERTS even though the kitchen screen is polling');
        assertEquals(kitchenDecision.stale, false, 'kitchen screen is not stale — it fetched 30 min ago');
    }

    console.log('\nTest 3: ...and the same holds in reverse');
    {
        const r = new DeviceAlertRegistry(BOTH);
        const v0 = r.get('v0');
        const kitchen = r.get('kitchen');

        v0.staleness.evaluate(central(15, 7, 0));
        kitchen.staleness.evaluate(central(15, 7, 0));
        r.recordFetch('v0', central(15, 7, 30));

        assertEquals(kitchen.staleness.evaluate(central(15, 8, 0)).notify, true, 'kitchen screen alerts when only the desk Kindle is polling');
        assertEquals(v0.staleness.evaluate(central(15, 8, 0)).stale, false, 'desk Kindle is fine');
    }

    console.log('\nTest 4: Profiles gate which alerts exist at all');
    {
        const r = new DeviceAlertRegistry(BOTH);
        const v0 = r.get('v0');
        const kitchen = r.get('kitchen');

        assert(v0.battery !== null, 'desk Kindle has battery alerting (no permanent charger)');
        assert(v0.bedtime !== null, 'desk Kindle has bedtime alerting');
        assert(v0.staleness !== null, 'desk Kindle has staleness alerting');

        assertEquals(kitchen.battery, null, 'kitchen screen has NO battery alerting (always charging)');
        assertEquals(kitchen.bedtime, null, 'kitchen screen has NO bedtime alerting');
        assert(kitchen.staleness !== null, 'kitchen screen still has staleness alerting — its only silent failure');
    }

    console.log('\nTest 5: Unknown devices are inert and cannot mask a real one');
    {
        const r = new DeviceAlertRegistry(BOTH);
        const v0 = r.get('v0');
        v0.staleness.evaluate(central(15, 7, 0));

        const stranger = r.recordFetch(r.resolveId('some-rando'), central(15, 7, 30));
        assertEquals(stranger.staleness, null, 'unknown device gets no staleness state');
        assertEquals(stranger.battery, null, 'unknown device gets no battery state');
        assertEquals(v0.staleness.evaluate(central(15, 8, 0)).notify, true, 'desk Kindle still alerts despite the stranger polling');
    }

    console.log('\nTest 6: Monitoring is deployment state, separate from capability');
    {
        // Default config: only the desk Kindle is deployed.
        const r = new DeviceAlertRegistry({ monitored: ['v0'], alertConfig: { staleThresholdMs: 45 * MIN } });
        const kitchen = r.get('kitchen');
        assertEquals(kitchen.staleness, null, 'a known-but-undeployed device raises no staleness alerts');
        assertEquals(r.stalenessWatched().length, 1, 'only the deployed device is walked by the staleness timer');
    }

    console.log('\nTest 7: Monitored devices exist before their first fetch');
    {
        // A device that dies and NEVER checks in must still be able to go
        // stale — lazily creating state on first fetch could never do that.
        const r = new DeviceAlertRegistry(BOTH);
        const ids = r.stalenessWatched().map((d) => d.id).sort();
        assertEquals(ids.join(','), 'kitchen,v0', 'both monitored devices are instantiated at construction');

        const kitchen = r.get('kitchen');
        kitchen.staleness.evaluate(central(15, 7, 0));
        assertEquals(kitchen.staleness.evaluate(central(15, 8, 0)).notify, true, 'a never-seen device still alerts');
    }

    console.log('\nTest 8: recordFetch on an alert-less device is a no-op, not a crash');
    {
        const r = new DeviceAlertRegistry({ monitored: ['v0'], alertConfig: { staleThresholdMs: 45 * MIN } });
        const entry = r.recordFetch('kitchen', central(15, 7, 30));
        assertEquals(entry.id, 'kitchen', 'returns the device entry');
        assertEquals(entry.staleness, null, 'and did not blow up on the missing state machine');
    }

    console.log('\n═══════════════════════════════════════════');
    console.log(`\n  Passed: ${testsPassed}`);
    console.log(`  Failed: ${testsFailed}\n`);
    process.exit(testsFailed > 0 ? 1 : 0);
}

runTests();
