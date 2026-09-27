#!/usr/bin/env node

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Horoscope Service Module — the Chicago Sun-Times' daily Georgia Nicols
 * column (Moon Alert + a configured subset of signs), read from the paper's
 * site-wide RSS feed. SPIKE: parser shape reconstructed from archived feed
 * captures, not yet run against the live feed — see
 * docs/scoping/horoscope-tile.md before trusting it.
 *
 * The Sun-Times Terms of Use forbid scraping; the RSS feed is the channel it
 * publishes for automated readers, so that is the only thing fetched here —
 * never the article pages. The column changes once a day (the item is
 * published 00:01 Central), so the cache is keyed by local date rather than
 * mtime: one successful fetch per day, retries throttled until today's item
 * appears.
 *
 * Chain: today's cache -> live feed -> older cache (stale) -> fixture.
 * No new dependencies on purpose — deploy-to-pi.sh does not reliably run
 * npm install (docs/reviews/2026-09-review.md F4).
 */

const SIGNS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
    'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TEASER_CHARS = 70;
const TIME = '(\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m\\.?|noon|midnight)';

const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
    mdash: '—', ndash: '–', hellip: '…'
};

function codePoint(m, n) {
    return n > 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : m;
}

function decodeEntities(s) {
    return String(s)
        .replace(/&#x([0-9a-f]+);/gi, (m, h) => codePoint(m, parseInt(h, 16)))
        .replace(/&#(\d+);/g, (m, d) => codePoint(m, parseInt(d, 10)))
        .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

function stripTags(html) {
    return decodeEntities(String(html).replace(/<[^>]*>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}

function unwrapCdata(s) {
    const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
    return m ? m[1] : s;
}

/** First `<tag>` value inside an RSS item, CDATA unwrapped, NOT entity-decoded. */
function itemField(itemXml, tag) {
    const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(itemXml);
    return m ? unwrapCdata(m[1]) : null;
}

/** "Horoscope for Sunday, September 27, 2026" -> "2026-09-27" (also "Sept. 06"). */
function dateFromTitle(title) {
    const m = /horoscopes?\s+for\s+\w+,\s+([a-z]+)\.?\s+(\d{1,2}),\s+(\d{4})/i.exec(title || '');
    if (!m) return null;
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month < 0) return null;
    return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** "10 a.m." -> "10a", "3:15 p.m." -> "3:15p", "noon" -> "noon". */
function compactTime(t) {
    return t.toLowerCase().replace(/\s+/g, '').replace(/\./g, '').replace(/([ap])m$/, '$1');
}

function teaser(text, max = TEASER_CHARS) {
    const first = (text.match(/^.*?[.!?](?=\s|$)/) || [text])[0];
    if (first.length <= max) return first;
    const cut = first.slice(0, max);
    return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).replace(/[,;:]$/, '')}…`;
}

class HoroscopeService {
    constructor(options = {}) {
        this.feedUrl = options.feedUrl || config.HOROSCOPE_FEED_URL;
        this.signs = (options.signs || config.HOROSCOPE_SIGNS).filter(s => SIGNS.includes(s));
        this.timezone = options.timezone || config.TIMEZONE;
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'cache');
        this.fixturesDir = options.fixturesDir || path.join(__dirname, 'fixtures', 'horoscope');
        this.retryMs = options.retryMs ?? config.HOROSCOPE_RETRY_MS;
        this.requestTimeout = options.requestTimeout || 15000;
        this.useFixtures = options.useFixtures || false;

        // Last live attempt that did NOT yield today's column. Throttles
        // re-fetching a ~1 MB feed on every BYOS poll while the item is late.
        this._lastMissAt = 0;

        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    getCacheFilePath() {
        return path.join(this.cacheDir, 'horoscope_cache.json');
    }

    loadCachedData() {
        try {
            return JSON.parse(fs.readFileSync(this.getCacheFilePath(), 'utf8'));
        } catch (error) {
            return null;
        }
    }

    saveCachedData(data) {
        // Temp + rename: a torn write must not fall through to the fixture.
        const file = this.getCacheFilePath();
        try {
            fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
            fs.renameSync(`${file}.tmp`, file);
        } catch (error) {
            console.warn(`Failed to save horoscope cache: ${error.message}`);
        }
    }

    loadFixtureFeed() {
        return fs.readFileSync(path.join(this.fixturesDir, 'feed.xml'), 'utf8');
    }

    localDate(now = new Date()) {
        return new Intl.DateTimeFormat('en-CA', {
            year: 'numeric', month: '2-digit', day: '2-digit', timeZone: this.timezone
        }).format(now);
    }

    fetchFeed(url = this.feedUrl, redirects = 0) {
        if (!url) return Promise.resolve(null);
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https:') ? https : http;
            const req = client.get(url, {
                timeout: this.requestTimeout,
                headers: {
                    'User-Agent': 'kindle-dashboard/1.0 (personal e-ink display; RSS reader)',
                    Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.1'
                }
            }, (res) => {
                if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                    res.resume();
                    if (redirects >= MAX_REDIRECTS) {
                        reject(new Error('Horoscope feed: too many redirects'));
                        return;
                    }
                    resolve(this.fetchFeed(new URL(res.headers.location, url).toString(), redirects + 1));
                    return;
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`Horoscope feed returned HTTP ${res.statusCode}`));
                    return;
                }
                let size = 0;
                const chunks = [];
                res.on('data', (chunk) => {
                    size += chunk.length;
                    if (size > MAX_FEED_BYTES) {
                        req.destroy(new Error('Horoscope feed exceeded size cap'));
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            });
            req.on('timeout', () => req.destroy(new Error('Horoscope feed request timed out')));
            req.on('error', (error) => reject(new Error(`Horoscope feed request failed: ${error.message}`)));
        });
    }

    // ---- parsing (pure) ----

    /**
     * Every horoscope <item> in an RSS document, newest column date first.
     * Identified by title date, not URL: the Sun-Times slug format has
     * changed repeatedly (padding, typos, even a wrong date in the path).
     */
    findHoroscopeItems(xml) {
        const items = [];
        const re = /<item[\s>][\s\S]*?<\/item>/gi;
        let m;
        while ((m = re.exec(xml || '')) !== null) {
            const itemXml = m[0];
            const title = stripTags(itemField(itemXml, 'title') || '');
            const date = dateFromTitle(title);
            if (!date) continue;
            const html = itemField(itemXml, 'content:encoded') || itemField(itemXml, 'description') || '';
            items.push({
                date,
                title,
                link: stripTags(itemField(itemXml, 'link') || ''),
                author: stripTags(itemField(itemXml, 'dc:creator') || itemField(itemXml, 'author') || '') || null,
                // Brightspot may entity-escape the body instead of CDATA-wrapping it.
                html: /<h2/i.test(html) ? html : decodeEntities(html)
            });
        }
        return items.sort((a, b) => b.date.localeCompare(a.date));
    }

    /** Split article HTML into [{ heading, body }] on <h2>. */
    sections(html) {
        const parts = String(html).split(/<h2[^>]*>/i).slice(1);
        return parts.map((part) => {
            const [heading, ...rest] = part.split(/<\/h2>/i);
            return { heading: stripTags(heading), body: rest.join('') };
        });
    }

    paragraphs(bodyHtml) {
        const found = [];
        const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
        let m;
        while ((m = re.exec(bodyHtml)) !== null) {
            const text = stripTags(m[1]);
            if (text) found.push(text);
        }
        return found;
    }

    parseMoonAlert(text) {
        const alert = {
            text,
            clear: /no restrictions/i.test(text),
            avoidFrom: null,
            avoidUntil: null,
            moonFrom: null,
            moonSign: null,
            headline: 'Moon alert'
        };

        const range = new RegExp(`from\\s+${TIME}\\s+(?:to|until)\\s+${TIME}`, 'i').exec(text);
        const after = new RegExp(`after\\s+${TIME}`, 'i').exec(text);
        const until = new RegExp(`(?:until|before)\\s+${TIME}`, 'i').exec(text);
        if (range) {
            alert.avoidFrom = range[1];
            alert.avoidUntil = range[2];
        } else if (after) {
            alert.avoidFrom = after[1];
        } else if (until) {
            alert.avoidUntil = until[1];
        }

        const moves = /moon moves from (\w+) into (\w+)/i.exec(text);
        const isIn = /moon is in (\w+)/i.exec(text);
        if (moves) {
            alert.moonFrom = moves[1];
            alert.moonSign = moves[2];
        } else if (isIn) {
            alert.moonSign = isIn[1];
        }

        if (alert.clear) {
            alert.headline = 'All clear';
        } else if (alert.avoidFrom && alert.avoidUntil) {
            alert.headline = `Avoid ${compactTime(alert.avoidFrom)}–${compactTime(alert.avoidUntil)}`;
        } else if (alert.avoidFrom) {
            alert.headline = `Avoid after ${compactTime(alert.avoidFrom)}`;
        } else if (alert.avoidUntil) {
            alert.headline = `Avoid until ${compactTime(alert.avoidUntil)}`;
        }
        return alert;
    }

    /**
     * Article HTML -> { moonAlert, signs[] } for the configured signs, in
     * configured order. Each sign section is `<h2>Taurus (April 20-May 20)`,
     * a star-box whose text reads "A positive day", then the column text.
     */
    parseArticle(html) {
        let moonAlert = null;
        const bySign = {};

        for (const { heading, body } of this.sections(html)) {
            if (/^moon alert/i.test(heading)) {
                const text = this.paragraphs(body).join(' ') || stripTags(body);
                moonAlert = this.parseMoonAlert(text);
                continue;
            }
            const sign = /^([a-z]+)\s*\(([^)]*)\)/i.exec(heading);
            if (!sign || !SIGNS.includes(sign[1].toLowerCase())) continue;

            const plain = stripTags(body);
            const rating = /\bA\s+(positive|average|dynamic|so-so|so so)\s+day\b/i.exec(plain);
            const paras = this.paragraphs(body)
                .filter(p => !/^A\s+(positive|average|dynamic|so-so|so so)\s+day\.?$/i.test(p));
            const text = paras.join(' ');
            bySign[sign[1].toLowerCase()] = {
                sign: sign[1].toLowerCase(),
                name: sign[1][0].toUpperCase() + sign[1].slice(1).toLowerCase(),
                dates: sign[2].trim(),
                rating: rating ? rating[1].toLowerCase().replace(' ', '-') : null,
                text,
                teaser: teaser(text)
            };
        }

        return { moonAlert, signs: this.signs.map(s => bySign[s]).filter(Boolean) };
    }

    /**
     * RSS -> payload for the newest column dated on/before `today` (null
     * `today` = newest of all, for fixtures). Null when no usable item.
     */
    parseFeed(xml, today) {
        const item = this.findHoroscopeItems(xml).find(i => !today || i.date <= today);
        if (!item) return null;
        const { moonAlert, signs } = this.parseArticle(item.html);
        if (!moonAlert && signs.length === 0) return null;
        const [y, mo, d] = item.date.split('-').map(Number);
        return {
            date: item.date,
            dateLabel: new Date(Date.UTC(y, mo - 1, d, 12)).toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'
            }),
            title: item.title,
            link: item.link,
            author: item.author || 'Georgia Nicols',
            moonAlert,
            signs
        };
    }

    // ---- public API ----

    async getHoroscopeData(now = new Date()) {
        const today = this.localDate(now);
        const wrap = (data, source) => ({ ...data, stale: data.date !== today, source, _timestamp: Date.now() });

        if (this.useFixtures) {
            return wrap(this.parseFeed(this.loadFixtureFeed(), null), 'fixture');
        }

        const cached = this.loadCachedData();
        if (cached && cached.date === today) return wrap(cached, 'cache');

        if (now.getTime() - this._lastMissAt >= this.retryMs) {
            try {
                const xml = await this.fetchFeed();
                const parsed = xml ? this.parseFeed(xml, today) : null;
                if (parsed && (!cached || parsed.date >= cached.date)) {
                    this.saveCachedData(parsed);
                    if (parsed.date !== today) this._lastMissAt = now.getTime();
                    return wrap(parsed, 'api');
                }
                this._lastMissAt = now.getTime();
            } catch (error) {
                this._lastMissAt = now.getTime();
                console.warn(`Horoscope feed failed: ${error.message}`);
            }
        }

        if (cached) return wrap(cached, 'expired-cache');
        return wrap(this.parseFeed(this.loadFixtureFeed(), null), 'fixture');
    }
}

module.exports = HoroscopeService;
module.exports.dateFromTitle = dateFromTitle;
