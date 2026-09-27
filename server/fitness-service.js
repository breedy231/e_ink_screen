#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Fitness Service Module — daily numbers from the FitLocal prod API
 * (Fly.io, auto-stop machines: first hit after idle takes ~10s to wake,
 * hence the generous request timeout).
 *
 * Sources: /goals/daily-nutrition (targets + today's intake),
 * /recovery-summary (per-muscle recoveryPct), /health-snapshots (latest
 * bodyWeightKg — rows can lag by months, so the date ships with the
 * number). Same cache + fallback chain as transit-service.js; no API key
 * configured means fixtures.
 */

class FitnessService {
    constructor(options = {}) {
        this.apiUrl = options.apiUrl || config.FITLOCAL_API_URL;
        this.apiKey = options.apiKey || config.FITLOCAL_API_KEY;
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'cache');
        this.fixturesDir = options.fixturesDir || path.join(__dirname, 'fixtures', 'fitness');
        this.cacheTimeout = options.cacheTimeout || config.FITLOCAL_CACHE_TTL_MS;
        this.requestTimeout = options.requestTimeout || 30000;
        this.useFixtures = options.useFixtures || false;

        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    getCacheFilePath() {
        return path.join(this.cacheDir, 'fitness_cache.json');
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
            console.warn(`Failed to save fitness cache: ${error.message}`);
        }
    }

    loadFixture() {
        const raw = fs.readFileSync(path.join(this.fixturesDir, 'fitlocal.json'), 'utf8');
        return JSON.parse(raw);
    }

    httpGetJson(urlPath) {
        return new Promise((resolve, reject) => {
            const req = https.get(`${this.apiUrl}${urlPath}`, {
                timeout: this.requestTimeout,
                headers: { Authorization: `Bearer ${this.apiKey}` }
            }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`FitLocal API returned HTTP ${res.statusCode}`));
                    return;
                }
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse FitLocal response: ${error.message}`));
                    }
                });
            });
            req.on('timeout', () => req.destroy(new Error('FitLocal API request timed out')));
            req.on('error', (error) => reject(new Error(`FitLocal API request failed: ${error.message}`)));
        });
    }

    async fetchAll() {
        if (!this.apiKey) return null;
        const [nutrition, recovery, snapshots] = await Promise.all([
            this.httpGetJson('/goals/daily-nutrition'),
            this.httpGetJson('/recovery-summary'),
            this.httpGetJson('/health-snapshots')
        ]);
        // Keep only what we render — /health-snapshots is ~350 rows and
        // this raw blob gets cached to disk.
        const weighted = (Array.isArray(snapshots) ? snapshots : [])
            .filter(r => r.bodyWeightKg)
            .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const latest = weighted[weighted.length - 1] || null;
        return {
            nutrition,
            recovery,
            latestSnapshot: latest ? { date: latest.date, bodyWeightKg: latest.bodyWeightKg } : null
        };
    }

    parseData(raw) {
        const n = (raw && raw.nutrition) || {};
        const muscles = ((raw && raw.recovery && raw.recovery.muscles) || [])
            .map(m => ({ muscle: m.name, pct: Math.round(m.recoveryPct) }))
            .sort((a, b) => a.pct - b.pct);
        const snap = raw && raw.latestSnapshot;

        return {
            weight: snap ? {
                lb: Math.round(snap.bodyWeightKg * 2.2046 * 10) / 10,
                date: snap.date
            } : null,
            nutrition: {
                date: n.date || null,
                isStale: n.isStale === true,
                isInCut: n.isInCut === true,
                calories: n.calories || { current: 0, target: 0 },
                protein: n.protein || { current: 0, target: 0 }
            },
            // Least-recovered first — that's the "don't train this" signal.
            recovery: muscles,
            fullyRecovered: muscles.length > 0 && muscles.every(m => m.pct >= 100)
        };
    }

    async getFitnessData() {
        let raw;
        if (!this.useFixtures && this.isCacheValid()) {
            raw = this.loadCachedData();
            if (raw) return { ...this.parseData(raw), source: 'cache', _timestamp: Date.now() };
        }

        if (!this.useFixtures) {
            try {
                raw = await this.fetchAll();
                if (raw) {
                    this.saveCachedData(raw);
                    return { ...this.parseData(raw), source: 'api', _timestamp: Date.now() };
                }
            } catch (error) {
                console.warn(`FitLocal API failed: ${error.message}`);
            }

            raw = this.loadCachedData();
            if (raw) return { ...this.parseData(raw), source: 'expired-cache', _timestamp: Date.now() };
        }

        return { ...this.parseData(this.loadFixture()), source: 'fixture', _timestamp: Date.now() };
    }
}

module.exports = FitnessService;
