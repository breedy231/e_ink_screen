#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * RSS Service Module — headlines from the rss-digest pipeline's
 * last_digest.json, served by its http.server on the Mac (plain HTTP,
 * LAN). The digest regenerates nightly at 17:00 CT, so "stale" here is
 * normal for most of the day — `generated` ships through so the recipe
 * can show data age. Same cache + fallback chain as transit-service.js.
 */

const MAX_THEMES = 4;
const MAX_ITEMS_PER_THEME = 3;

class RssService {
    constructor(options = {}) {
        this.digestUrl = options.digestUrl || config.RSS_DIGEST_URL;
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'cache');
        this.fixturesDir = options.fixturesDir || path.join(__dirname, 'fixtures', 'rss');
        this.cacheTimeout = options.cacheTimeout || config.RSS_CACHE_TTL_MS;
        this.requestTimeout = options.requestTimeout || 10000;
        this.useFixtures = options.useFixtures || false;

        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    getCacheFilePath() {
        return path.join(this.cacheDir, 'rss_cache.json');
    }

    isCacheValid() {
        try {
            const stat = fs.statSync(this.getCacheFilePath());
            return (Date.now() - stat.mtimeMs) < this.cacheTimeout;
        } catch (error) {
            return false;
        }
    }

    loadCachedData() {
        try {
            return JSON.parse(fs.readFileSync(this.getCacheFilePath(), 'utf8'));
        } catch (error) {
            return null;
        }
    }

    saveCachedData(data) {
        try {
            fs.writeFileSync(this.getCacheFilePath(), JSON.stringify(data));
        } catch (error) {
            console.warn(`Failed to save rss cache: ${error.message}`);
        }
    }

    loadFixture() {
        const raw = fs.readFileSync(path.join(this.fixturesDir, 'digest.json'), 'utf8');
        return JSON.parse(raw);
    }

    fetchDigest() {
        if (!this.digestUrl) return Promise.resolve(null);
        return new Promise((resolve, reject) => {
            const req = http.get(this.digestUrl, { timeout: this.requestTimeout }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`RSS digest returned HTTP ${res.statusCode}`));
                    return;
                }
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse RSS digest: ${error.message}`));
                    }
                });
            });
            req.on('timeout', () => req.destroy(new Error('RSS digest request timed out')));
            req.on('error', (error) => reject(new Error(`RSS digest request failed: ${error.message}`)));
        });
    }

    parseDigest(raw) {
        const themes = ((raw && raw.themes) || [])
            .slice(0, MAX_THEMES)
            .map(t => ({
                title: t.title,
                summary: t.summary,
                items: (t.items || []).slice(0, MAX_ITEMS_PER_THEME).map(i => ({
                    feed: i.feed,
                    title: i.title
                }))
            }));

        return {
            generated: (raw && raw.generated) || null,
            lead: (raw && raw.lead) || null,
            themes,
            watchCount: ((raw && raw.videos) || []).length,
            alsoCount: ((raw && raw.also) || []).length
        };
    }

    async getRssData() {
        let raw;
        if (!this.useFixtures && this.isCacheValid()) {
            raw = this.loadCachedData();
            if (raw) return { ...this.parseDigest(raw), source: 'cache', _timestamp: Date.now() };
        }

        if (!this.useFixtures) {
            try {
                raw = await this.fetchDigest();
                if (raw) {
                    this.saveCachedData(raw);
                    return { ...this.parseDigest(raw), source: 'api', _timestamp: Date.now() };
                }
            } catch (error) {
                console.warn(`RSS digest fetch failed: ${error.message}`);
            }

            raw = this.loadCachedData();
            if (raw) return { ...this.parseDigest(raw), source: 'expired-cache', _timestamp: Date.now() };
        }

        return { ...this.parseDigest(this.loadFixture()), source: 'fixture', _timestamp: Date.now() };
    }
}

module.exports = RssService;
