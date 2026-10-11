#!/usr/bin/env node

/**
 * Tests for the quarter-hour word clock
 * Run with: node server/word-clock.test.js
 */

const { wordClock, phraseFor } = require('./word-clock');

let testsPassed = 0;
let testsFailed = 0;

function assertEquals(actual, expected, message) {
    if (actual === expected) {
        console.log(`  ✓ ${message}`);
        testsPassed++;
    } else {
        console.error(`  ✗ ${message} (expected: ${expected}, got: ${actual})`);
        testsFailed++;
    }
}

console.log('\nTest 1: phrases floor to the current quarter');
assertEquals(phraseFor(14, 0), 'two o’clock', '14:00');
assertEquals(phraseFor(14, 14), 'two o’clock', '14:14 still the top of the hour');
assertEquals(phraseFor(14, 15), 'quarter past two', '14:15');
assertEquals(phraseFor(14, 30), 'half past two', '14:30');
assertEquals(phraseFor(14, 44), 'half past two', '14:44');
assertEquals(phraseFor(14, 45), 'quarter to three', '14:45 names the next hour');
assertEquals(phraseFor(11, 45), 'quarter to twelve', '11:45');
assertEquals(phraseFor(23, 45), 'quarter to twelve', '23:45');

console.log('\nTest 2: noon and midnight');
assertEquals(phraseFor(12, 0), 'noon', '12:00');
assertEquals(phraseFor(0, 5), 'midnight', '00:05');
assertEquals(phraseFor(12, 15), 'quarter past twelve', '12:15');

console.log('\nTest 3: timezone + mood line');
// 2026-10-11 19:16 UTC = 14:16 CDT (Sunday)
let c = wordClock(new Date('2026-10-11T19:16:00Z'), 'America/Chicago');
assertEquals(c.phrase, 'quarter past two', 'CDT conversion');
assertEquals(c.mood, 'Sunday afternoon', 'weekday + part of day');
// 2026-12-01 13:00 UTC = 07:00 CST (Tuesday)
c = wordClock(new Date('2026-12-01T13:00:00Z'), 'America/Chicago');
assertEquals(c.phrase, 'seven o’clock', 'CST conversion');
assertEquals(c.mood, 'Tuesday morning', 'morning');
// 03:59 UTC Oct 12 = 22:59 CDT Oct 11 (still Sunday locally)
c = wordClock(new Date('2026-10-12T03:59:00Z'), 'America/Chicago');
assertEquals(c.mood, 'Sunday night', 'local weekday, not UTC weekday');

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
process.exit(testsFailed > 0 ? 1 : 0);
