#!/usr/bin/env node

/**
 * Tests for TrmnlStalenessAlertState
 * Run with: node server/trmnl-staleness-alert.test.js
 */

const { TrmnlStalenessAlertState } = require('./trmnl-staleness-alert');

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

const MIN = 60 * 1000;
const T0 = 1_700_000_000_000;

function runTests() {
    console.log('\n🧪 Running TrmnlStalenessAlertState Tests\n');

    console.log('Healthy sources:');
    {
        const s = new TrmnlStalenessAlertState();
        for (const source of ['api', 'cache', 'mock']) {
            const d = s.evaluate({ source, fetchedAt: T0 }, T0);
            assert(!d.stale && !d.notify, `${source} is healthy`);
        }
    }

    console.log('\nFailure before threshold:');
    {
        const s = new TrmnlStalenessAlertState({ thresholdMs: 30 * MIN });
        s.evaluate({ source: 'expired-cache', fetchedAt: T0 }, T0 + 10 * MIN);
        const d = s.evaluate({ source: 'expired-cache', fetchedAt: T0 }, T0 + 25 * MIN);
        assert(!d.stale && !d.notify, 'failing for 15 min stays quiet');
        assert(d.staleMinutes === 25, 'staleMinutes reports screen age');
        assert(d.failingMinutes === 15, 'failingMinutes reports time since first failure');
    }

    console.log('\nNotify once failing past threshold:');
    {
        const s = new TrmnlStalenessAlertState({ thresholdMs: 30 * MIN });
        s.evaluate({ source: 'expired-cache', fetchedAt: T0 }, T0 + 15 * MIN);
        const first = s.evaluate({ source: 'expired-cache', fetchedAt: T0 }, T0 + 60 * MIN);
        assert(first.stale && first.notify, 'failing 45 min notifies');
        assert(first.staleMinutes === 60 && first.hadScreen, 'carries screen age and hadScreen');
        const second = s.evaluate({ source: 'expired-cache', fetchedAt: T0 }, T0 + 75 * MIN);
        assert(second.stale && !second.notify, 'latch holds — no repeat notification');
    }

    console.log('\nRe-arm on recovery:');
    {
        const s = new TrmnlStalenessAlertState({ thresholdMs: 30 * MIN });
        s.evaluate({ source: 'expired-cache', fetchedAt: T0 }, T0);
        s.evaluate({ source: 'expired-cache', fetchedAt: T0 }, T0 + 45 * MIN);
        const ok = s.evaluate({ source: 'api', fetchedAt: T0 + 50 * MIN }, T0 + 50 * MIN);
        assert(!ok.stale && !ok.notify, 'successful fetch clears the episode');
        s.evaluate({ source: 'expired-cache', fetchedAt: T0 + 50 * MIN }, T0 + 60 * MIN);
        const again = s.evaluate({ source: 'expired-cache', fetchedAt: T0 + 50 * MIN }, T0 + 95 * MIN);
        assert(again.notify, 'a new episode past threshold notifies again');
    }

    console.log('\nNo cached screen at all:');
    {
        const s = new TrmnlStalenessAlertState({ thresholdMs: 30 * MIN });
        const early = s.evaluate(null, T0);
        assert(!early.notify && !early.hadScreen, 'null result anchors to first failure, quiet at first');
        const later = s.evaluate(null, T0 + 31 * MIN);
        assert(later.notify && !later.hadScreen, 'null result notifies once threshold passes from first failure');
    }

    console.log('\nOvernight gap is not an outage (2026-10 regression):');
    {
        const s = new TrmnlStalenessAlertState({ thresholdMs: 30 * MIN });
        // Last fetch 21:45, nothing overnight, 07:00 render slow -> expired-cache.
        const morning = s.evaluate({ source: 'expired-cache', fetchedAt: T0 - 555 * MIN }, T0);
        assert(!morning.notify, 'first morning poll with a 9h-old cache does not alert');
        assert(morning.staleMinutes === 555, 'still reports the real screen age');
        const next = s.evaluate({ source: 'cache', fetchedAt: T0 + 2 * MIN }, T0 + 15 * MIN);
        assert(!next.stale, 'background fetch landing clears it');
    }

    console.log(`\n${testsPassed} passed, ${testsFailed} failed\n`);
    if (testsFailed > 0) process.exit(1);
}

runTests();
