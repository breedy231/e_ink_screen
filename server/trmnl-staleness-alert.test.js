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
        const d = s.evaluate({ source: 'expired-cache', fetchedAt: T0 }, T0 + 10 * MIN);
        assert(!d.stale && !d.notify, 'expired-cache within threshold stays quiet');
        assert(d.staleMinutes === 10, 'reports minutes since last good fetch');
    }

    console.log('\nNotify once past threshold:');
    {
        const s = new TrmnlStalenessAlertState({ thresholdMs: 30 * MIN });
        const first = s.evaluate({ source: 'expired-cache', fetchedAt: T0 }, T0 + 45 * MIN);
        assert(first.stale && first.notify, 'first evaluation past threshold notifies');
        assert(first.staleMinutes === 45 && first.hadScreen, 'carries age and hadScreen');
        const second = s.evaluate({ source: 'expired-cache', fetchedAt: T0 }, T0 + 60 * MIN);
        assert(second.stale && !second.notify, 'latch holds — no repeat notification');
    }

    console.log('\nRe-arm on recovery:');
    {
        const s = new TrmnlStalenessAlertState({ thresholdMs: 30 * MIN });
        s.evaluate({ source: 'expired-cache', fetchedAt: T0 }, T0 + 45 * MIN);
        const ok = s.evaluate({ source: 'api', fetchedAt: T0 + 50 * MIN }, T0 + 50 * MIN);
        assert(!ok.stale && !ok.notify, 'successful fetch clears the episode');
        const again = s.evaluate({ source: 'expired-cache', fetchedAt: T0 + 50 * MIN }, T0 + 90 * MIN);
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

    console.log('\nfetchedAt beats first-failure anchor:');
    {
        const s = new TrmnlStalenessAlertState({ thresholdMs: 30 * MIN });
        // First failure observed when the cached screen is already 40 min old
        // (e.g. service restarted mid-outage) — should alert immediately.
        const d = s.evaluate({ source: 'expired-cache', fetchedAt: T0 - 40 * MIN }, T0);
        assert(d.notify, 'pre-aged cache alerts on first failing poll after restart');
    }

    console.log(`\n${testsPassed} passed, ${testsFailed} failed\n`);
    if (testsFailed > 0) process.exit(1);
}

runTests();
