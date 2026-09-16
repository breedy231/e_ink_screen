#!/usr/bin/env node

/**
 * Tests for RssService
 * Run with: node server/rss-service.test.js
 */

const fs = require('fs');
const RssService = require('./rss-service');

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
    console.log('\n🧪 Running RssService Tests\n');

    const service = new RssService({ useFixtures: true });

    console.log('Fixture fallback:');
    const data = await service.getRssData();
    assert(data.source === 'fixture', 'useFixtures serves fixture source');
    assert(typeof data.generated === 'string', 'generated timestamp passes through');
    assert(typeof data.lead === 'string' && data.lead.length > 0, 'lead passes through');

    console.log('\nThemes:');
    assert(data.themes.length > 0 && data.themes.length <= 4, 'themes present and capped at 4');
    assert(data.themes.every(t => t.items.length <= 3), 'items per theme capped at 3');
    assert(data.themes[0].title && data.themes[0].summary, 'theme carries title and summary');
    assert(data.themes[0].items[0].feed !== undefined, 'items carry feed name');

    console.log('\nCounts:');
    assert(typeof data.watchCount === 'number', 'watchCount is numeric');
    assert(typeof data.alsoCount === 'number', 'alsoCount is numeric');

    console.log('\nCaps on oversized input:');
    const big = service.parseDigest({
        generated: '2026-09-10T08:00:00',
        lead: 'lead',
        themes: Array.from({ length: 8 }, (_, i) => ({
            title: `T${i}`, summary: 's',
            items: Array.from({ length: 6 }, (_, j) => ({ feed: `f${j}`, title: `i${j}` }))
        })),
        videos: [1, 2, 3],
        also: [1, 2]
    });
    assert(big.themes.length === 4, '8 themes trimmed to 4');
    assert(big.themes[0].items.length === 3, '6 items trimmed to 3');
    assert(big.watchCount === 3 && big.alsoCount === 2, 'counts reflect raw array sizes');

    console.log('\nEmpty digest:');
    const empty = service.parseDigest({});
    assert(empty.themes.length === 0 && empty.lead === null, 'empty digest parses to empty shape');

    console.log('\nUnreachable digest server:');
    const noUrl = new RssService({
        digestUrl: 'http://127.0.0.1:1/last_digest.json',
        requestTimeout: 500,
        cacheDir: fs.mkdtempSync('/tmp/rss-test-')
    });
    const fallback = await noUrl.getRssData();
    assert(fallback.source === 'fixture', 'unreachable URL with no cache falls through to fixture');

    console.log(`\n${testsPassed} passed, ${testsFailed} failed\n`);
    if (testsFailed > 0) process.exit(1);
}

runTests().catch((error) => {
    console.error(`Test run crashed: ${error.message}`);
    process.exit(1);
});
