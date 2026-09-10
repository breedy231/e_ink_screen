#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const STOPS = require('./transit-stops');

/**
 * Transit Service Module — CTA bus + train + alerts, Loop-bound only.
 *
 * CTA runs three separate APIs with two separate keys (see
 * TRANSIT_SCREEN_PLAN.md): Bus Tracker, Train Tracker, and keyless Alerts.
 * Each source gets its own cache + fallback chain (cache -> expired cache
 * -> fixture), following calendar-service.js/weather-service.js. Bus/train
 * fall back to fixtures whenever their key isn't configured (not just on
 * error) — until CTA approves the keys, "unconfigured" and "down" look the
 * same on purpose. Alerts need no key, so they always attempt a live fetch.
 */

const ROUTE_IDS_FOR_ALERTS = ['8', '146', '151', 'Red', 'Brn'];

class TransitService {
    constructor(options = {}) {
        this.busApiKey = options.busApiKey || config.CTA_BUS_API_KEY;
        this.trainApiKey = options.trainApiKey || config.CTA_TRAIN_API_KEY;
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'cache');
        this.fixturesDir = options.fixturesDir || path.join(__dirname, 'fixtures', 'transit');
        this.cacheTimeout = options.cacheTimeout || config.TRANSIT_CACHE_TTL_MS;
        this.requestTimeout = options.requestTimeout || 15000;
        this.useFixtures = options.useFixtures || false; // force fixtures even if keys are set (tests/preview)

        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    // ---- cache helpers (one file per source) ----

    getCacheFilePath(sourceName) {
        return path.join(this.cacheDir, `transit_${sourceName}_cache.json`);
    }

    isCacheValid(sourceName) {
        try {
            const stat = fs.statSync(this.getCacheFilePath(sourceName));
            return (Date.now() - stat.mtimeMs) < this.cacheTimeout;
        } catch (error) {
            return false;
        }
    }

    loadCachedData(sourceName) {
        try {
            return JSON.parse(fs.readFileSync(this.getCacheFilePath(sourceName), 'utf8'));
        } catch (error) {
            return null;
        }
    }

    saveCachedData(sourceName, data) {
        try {
            fs.writeFileSync(this.getCacheFilePath(sourceName), JSON.stringify(data));
        } catch (error) {
            console.warn(`Failed to save transit ${sourceName} cache: ${error.message}`);
        }
    }

    loadFixture(fileName) {
        const raw = fs.readFileSync(path.join(this.fixturesDir, fileName), 'utf8');
        return JSON.parse(raw);
    }

    /**
     * Shared cache + fallback chain for one source: live fetch (if
     * possible) -> cache -> expired cache -> fixture. `fetchFn` returning
     * null means "not configured" and skips straight past the live attempt.
     */
    async fetchWithFallback(sourceName, fetchFn, fixtureFileName) {
        if (!this.useFixtures && this.isCacheValid(sourceName)) {
            const cached = this.loadCachedData(sourceName);
            if (cached) return { ...cached, _source: 'cache' };
        }

        if (!this.useFixtures) {
            try {
                const data = await fetchFn();
                if (data) {
                    this.saveCachedData(sourceName, data);
                    return { ...data, _source: 'api' };
                }
            } catch (error) {
                console.warn(`Transit ${sourceName} API failed: ${error.message}`);
            }

            const expired = this.loadCachedData(sourceName);
            if (expired) return { ...expired, _source: 'expired-cache' };
        }

        return { ...this.loadFixture(fixtureFileName), _source: 'fixture' };
    }

    // ---- HTTP fetchers ----

    httpGetJson(url) {
        return new Promise((resolve, reject) => {
            const req = https.get(url, { timeout: this.requestTimeout }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`Transit API returned HTTP ${res.statusCode}`));
                    return;
                }
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse transit response: ${error.message}`));
                    }
                });
            });
            req.on('timeout', () => req.destroy(new Error('Transit API request timed out')));
            req.on('error', (error) => reject(new Error(`Transit API request failed: ${error.message}`)));
        });
    }

    fetchBusPredictions() {
        if (!this.busApiKey) return Promise.resolve(null);
        const stopIds = [...new Set(STOPS.bus.map(s => s.stopId))].join(',');
        const routes = STOPS.bus.map(s => s.route).join(',');
        const url = `https://ctabustracker.com/bustime/api/v3/getpredictions?` +
            `key=${encodeURIComponent(this.busApiKey)}&rt=${routes}&stpid=${stopIds}&format=json`;
        return this.httpGetJson(url);
    }

    fetchTrainArrivals() {
        if (!this.trainApiKey) return Promise.resolve(null);
        const url = `https://lapi.transitchicago.com/api/1.0/ttarrivals.aspx?` +
            `key=${encodeURIComponent(this.trainApiKey)}&mapid=${STOPS.rail.mapid}&outputType=JSON`;
        return this.httpGetJson(url);
    }

    fetchAlerts() {
        const routeParams = ROUTE_IDS_FOR_ALERTS.map(r => `routeid=${encodeURIComponent(r)}`).join('&');
        const url = `https://lapi.transitchicago.com/api/1.0/alerts.aspx?outputType=JSON&activeonly=true&${routeParams}`;
        return this.httpGetJson(url);
    }

    // ---- parsers (raw CTA shape -> our shape) ----

    parseBusPredictions(raw) {
        const prds = (raw && raw['bustime-response'] && raw['bustime-response'].prd) || [];
        return STOPS.bus.map(stopCfg => {
            const arrivals = prds
                .filter(p => p.rt === stopCfg.route && p.stpid === stopCfg.stopId)
                .map(p => ({
                    minutes: p.prdctdn === 'DUE' ? 0 : parseInt(p.prdctdn, 10) || 0,
                    destination: p.des,
                    isDelayed: p.dly === true || p.dly === 'true'
                }))
                .sort((a, b) => a.minutes - b.minutes)
                .slice(0, 3);
            return {
                route: stopCfg.route,
                label: stopCfg.label,
                stopId: stopCfg.stopId,
                stopName: stopCfg.stopName,
                walkMinutes: stopCfg.walkMinutes,
                arrivals
            };
        });
    }

    parseTrainArrivals(raw, nowMs) {
        const etas = (raw && raw.ctatt && raw.ctatt.eta) || [];
        const now = nowMs || (raw && raw.ctatt && raw.ctatt.tmst ? new Date(raw.ctatt.tmst).getTime() : Date.now());
        return STOPS.rail.lines.map(lineCfg => {
            const arrivals = etas
                .filter(e => e.rt === lineCfg.route && e.stpId === lineCfg.platformStopId)
                .map(e => ({
                    minutes: Math.max(0, Math.round((new Date(e.arrT).getTime() - now) / 60000)),
                    destination: e.destNm,
                    isDelayed: e.isDly === '1',
                    isApproaching: e.isApp === '1'
                }))
                .sort((a, b) => a.minutes - b.minutes)
                .slice(0, 3);
            return {
                route: lineCfg.route,
                label: lineCfg.label,
                rideMinutesToLoop: lineCfg.rideMinutesToLoop,
                arrivals
            };
        });
    }

    parseAlerts(raw) {
        const alerts = (raw && raw.CTAAlerts && raw.CTAAlerts.Alert) || [];
        const list = Array.isArray(alerts) ? alerts : [alerts];
        return list
            // 'special-note' is amenity noise (elevator/escalator outages) —
            // CTA tags these with our routes too since they sit on the line,
            // but they're not something a departure screen should surface.
            .filter(a => a.SeverityCSS !== 'special-note')
            .map(a => {
                const services = (a.ImpactedService && a.ImpactedService.Service) || [];
                const serviceList = Array.isArray(services) ? services : [services];
                return {
                    routes: serviceList.map(s => s.ServiceId).filter(Boolean),
                    headline: a.Headline,
                    severity: a.SeverityCSS || 'unknown',
                    isMajor: a.MajorAlert === '1'
                };
            })
            .sort((a, b) => Number(b.isMajor) - Number(a.isMajor))
            .slice(0, 4);
    }

    // ---- public API ----

    async getTransitData() {
        const [busRaw, trainRaw, alertsRaw] = await Promise.all([
            this.fetchWithFallback('bus', () => this.fetchBusPredictions(), 'bus-predictions.json'),
            this.fetchWithFallback('train', () => this.fetchTrainArrivals(), 'train-arrivals.json'),
            this.fetchWithFallback('alerts', () => this.fetchAlerts(), 'alerts.json')
        ]);

        const bus = this.parseBusPredictions(busRaw);
        const rail = this.parseTrainArrivals(trainRaw);
        const alerts = this.parseAlerts(alertsRaw);

        const hasAnyArrivals = bus.some(s => s.arrivals.length > 0) || rail.some(l => l.arrivals.length > 0);

        return {
            rail: {
                stationName: STOPS.rail.stationName,
                mapid: STOPS.rail.mapid,
                walkMinutes: STOPS.rail.walkMinutes,
                lines: rail,
                source: trainRaw._source
            },
            bus: {
                stops: bus,
                source: busRaw._source
            },
            alerts,
            hasAnyArrivals,
            _timestamp: Date.now()
        };
    }
}

module.exports = TransitService;
