#!/usr/bin/env node

/**
 * Tests for HoroscopeService
 * Run with: node server/horoscope-service.test.js
 *
 * The fixture feed is synthetic (see its header comment); these pin the
 * parser to the structure documented in docs/scoping/horoscope-tile.md.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const HoroscopeService = require('./horoscope-service');
const { dateFromTitle } = require('./horoscope-service');

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

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'horoscope', 'feed.xml'), 'utf8');
const SEP27_NOON_CT = new Date('2026-09-27T17:00:00Z');
const SEP28_NOON_CT = new Date('2026-09-28T17:00:00Z');
const tmpCache = () => fs.mkdtempSync('/tmp/horoscope-test-');

/** Serve `body` (or a redirect) on 127.0.0.1; resolves { url, hits, close }. */
function serveFeed(body, { redirect = false } = {}) {
    const state = { hits: 0 };
    const server = http.createServer((req, res) => {
        state.hits++;
        if (redirect && req.url === '/old') {
            res.writeHead(301, { Location: '/feed.xml' });
            res.end();
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/rss+xml' });
        res.end(body);
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const base = `http://127.0.0.1:${server.address().port}`;
            resolve({
                url: redirect ? `${base}/old` : `${base}/feed.xml`,
                state,
                close: () => new Promise(r => server.close(r))
            });
        });
    });
}

async function runTests() {
    console.log('\n🧪 Running HoroscopeService Tests\n');

    console.log('Title dates (slugs are unreliable, titles are the key):');
    assert(dateFromTitle('Horoscope for Sunday, September 27, 2026') === '2026-09-27', 'full month name');
    assert(dateFromTitle('Horoscope for Sunday, September 06, 2026') === '2026-09-06', 'zero-padded day (2025+ format)');
    assert(dateFromTitle('Horoscope for Tuesday, July 1, 2024') === '2024-07-01', 'unpadded day (2024 format)');
    assert(dateFromTitle('Horoscopes for Monday, Sept. 7, 2026') === '2026-09-07', 'plural + abbreviated month');
    assert(dateFromTitle('Lakefront trail reopens') === null, 'non-horoscope title -> null');

    const service = new HoroscopeService({ signs: ['taurus', 'libra'], cacheDir: tmpCache() });

    console.log('\nItem selection:');
    const items = service.findHoroscopeItems(FIXTURE);
    assert(items.length === 2, 'news item skipped, both horoscope items found');
    assert(items[0].date === '2026-09-27', 'newest column first');

    console.log('\nToday\'s column (2026-09-27):');
    const today = service.parseFeed(FIXTURE, '2026-09-27');
    assert(today.date === '2026-09-27' && today.dateLabel === 'Sun, Sep 27', 'date + label');
    assert(today.author === 'Georgia Nicols', 'author from dc:creator');
    assert(today.moonAlert.avoidFrom === '10 a.m.' && today.moonAlert.avoidUntil === 'noon', 'moon alert window parsed');
    assert(today.moonAlert.headline === 'Avoid 10a–noon', 'compact headline for the quadrant');
    assert(today.moonAlert.moonFrom === 'Taurus' && today.moonAlert.moonSign === 'Gemini', 'moon ingress parsed');
    assert(today.moonAlert.clear === false, 'restricted day is not clear');
    assert(today.signs.map(s => s.sign).join() === 'taurus,libra', 'only configured signs, in configured order');

    const taurus = today.signs[0];
    assert(taurus.rating === 'positive', 'star-box rating extracted');
    assert(taurus.dates === 'April 20-May 20', 'sign date range kept');
    assert(taurus.text.includes('—') && !taurus.text.includes('&mdash;'), 'entities decoded');
    assert(!/positive day|★/.test(taurus.text), 'star-box text excluded from column text');
    assert(taurus.text.startsWith('Money matters'), 'column text starts at the first paragraph');
    assert(taurus.teaser.length <= 71 && taurus.teaser.endsWith('…'), 'long first sentence teased to <=70 chars + ellipsis');
    assert(today.signs[1].text.includes('you’ve'), 'curly apostrophe decoded (Libra)');

    console.log('\nOlder column + moon alert variants:');
    const sat = service.parseFeed(FIXTURE, '2026-09-26');
    assert(sat.date === '2026-09-26', 'picks newest column on/before the requested day');
    assert(sat.moonAlert.clear === true && sat.moonAlert.headline === 'All clear', '"no restrictions" -> All clear');
    assert(sat.moonAlert.moonSign === 'Taurus', '"moon is in" parsed; lowercase "Moon alert" heading matched');
    assert(service.parseFeed(FIXTURE, '2026-09-25') === null, 'nothing on/before -> null');
    const after = service.parseMoonAlert('Avoid shopping and important decisions after 3:15 a.m. Chicago time today. The moon moves from Aries into Taurus.');
    assert(after.avoidFrom === '3:15 a.m.' && after.avoidUntil === null && after.headline === 'Avoid after 3:15a', '"after <time>" form');
    const until = service.parseMoonAlert('Avoid shopping or important decisions until 1 p.m. today.');
    assert(until.avoidUntil === '1 p.m.' && until.headline === 'Avoid until 1p', '"until <time>" form');
    const odd = service.parseMoonAlert('The moon is void today; take it easy.');
    assert(odd.headline === 'Moon alert' && odd.text.startsWith('The moon'), 'unrecognised wording keeps full text + generic headline');

    console.log('\nSign order + escaped-HTML bodies:');
    const reversed = new HoroscopeService({ signs: ['libra', 'taurus', 'notasign'], cacheDir: tmpCache() });
    assert(reversed.parseFeed(FIXTURE, '2026-09-27').signs.map(s => s.sign).join() === 'libra,taurus', 'order follows config; unknown sign ignored');
    const escaped = FIXTURE.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, html) =>
        html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    const esc = service.parseFeed(escaped, '2026-09-27');
    assert(esc && esc.signs[0].rating === 'positive' && esc.signs[0].text.includes('—'), 'entity-escaped description parses the same');
    const junk = service.parseFeed(FIXTURE.replace('Money matters', '&#99999999; Money matters'), '2026-09-27');
    assert(junk.signs[0].text.includes('&#99999999;'), 'out-of-range numeric entity left as-is, no throw');

    console.log('\nFallback chain:');
    const fixtureOnly = new HoroscopeService({ useFixtures: true, cacheDir: tmpCache() });
    const fx = await fixtureOnly.getHoroscopeData(SEP27_NOON_CT);
    assert(fx.source === 'fixture' && fx.stale === false && fx.signs.length === 2, 'useFixtures serves the fixture column');

    const feed = await serveFeed(FIXTURE, { redirect: true });
    const live = new HoroscopeService({ feedUrl: feed.url, cacheDir: tmpCache(), retryMs: 60000, requestTimeout: 2000 });
    const first = await live.getHoroscopeData(SEP27_NOON_CT);
    assert(first.source === 'api' && first.stale === false, 'live feed (via 301) -> api, fresh');
    const hitsAfterFirst = feed.state.hits;
    const second = await live.getHoroscopeData(SEP27_NOON_CT);
    assert(second.source === 'cache' && feed.state.hits === hitsAfterFirst, 'same day -> day cache, no refetch');
    const nextDay = await live.getHoroscopeData(SEP28_NOON_CT);
    assert(nextDay.source === 'api' && nextDay.stale === true && nextDay.date === '2026-09-27', 'next day, column not out yet -> newest available, flagged stale');
    const hitsAfterMiss = feed.state.hits;
    const throttled = await live.getHoroscopeData(SEP28_NOON_CT);
    assert(throttled.source === 'expired-cache' && feed.state.hits === hitsAfterMiss, 'miss is throttled for retryMs (no feed hammering)');
    await feed.close();

    const down = new HoroscopeService({ feedUrl: 'http://127.0.0.1:1/rss', cacheDir: tmpCache(), retryMs: 0, requestTimeout: 500 });
    const noCache = await down.getHoroscopeData(SEP27_NOON_CT);
    assert(noCache.source === 'fixture', 'unreachable feed, no cache -> fixture');
    down.saveCachedData(service.parseFeed(FIXTURE, '2026-09-26'));
    const withCache = await down.getHoroscopeData(SEP27_NOON_CT);
    assert(withCache.source === 'expired-cache' && withCache.stale === true, 'unreachable feed with old cache -> expired-cache, stale');

    const empty = await serveFeed('<rss><channel></channel></rss>');
    const emptySvc = new HoroscopeService({ feedUrl: empty.url, cacheDir: tmpCache(), retryMs: 0 });
    assert((await emptySvc.getHoroscopeData(SEP27_NOON_CT)).source === 'fixture', 'feed without a horoscope item -> fixture');
    await empty.close();

    console.log(`\n${testsPassed} passed, ${testsFailed} failed\n`);
    if (testsFailed > 0) process.exit(1);
}

runTests().catch((error) => {
    console.error(`Test run crashed: ${error.message}`);
    process.exit(1);
});
