#!/usr/bin/env node

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const config = require('./config');

/**
 * TRMNL Service Module
 *
 * Polls a self-hosted TRMNL BYOS server (e.g. usetrmnl/byos_laravel) the
 * same way the real TRMNL firmware would: GET /api/display with ID/
 * Access-Token headers, then download the returned image_url. The fetched
 * screen is cached to disk so a slow/down BYOS never blocks a dashboard
 * request.
 */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NEGATIVE_CACHE_MS = 30 * 1000; // avoid double-hitting a down BYOS per request

class TrmnlService {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || config.TRMNL_BASE_URL;
        this.deviceMac = options.deviceMac || config.TRMNL_DEVICE_MAC;
        this.apiKey = options.apiKey || config.TRMNL_API_KEY;
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'cache', 'trmnl');
        this.cacheTimeout = options.cacheTimeout || config.TRMNL_CACHE_TTL_MS;
        this.requestTimeout = options.requestTimeout || 15000;
        this.mockData = options.mockData || false;

        this._lastFailureAt = 0;

        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    isConfigured() {
        return Boolean(this.baseUrl && this.deviceMac && this.apiKey);
    }

    getScreenPath() {
        return path.join(this.cacheDir, 'screen.png');
    }

    getMetaPath() {
        return path.join(this.cacheDir, 'screen.meta.json');
    }

    isCacheValid() {
        try {
            const stat = fs.statSync(this.getScreenPath());
            return (Date.now() - stat.mtimeMs) < this.cacheTimeout;
        } catch (error) {
            return false;
        }
    }

    hasCache() {
        return fs.existsSync(this.getScreenPath());
    }

    saveMeta(meta) {
        try {
            fs.writeFileSync(this.getMetaPath(), JSON.stringify(meta));
        } catch (error) {
            console.warn(`Failed to save TRMNL meta: ${error.message}`);
        }
    }

    loadMeta() {
        try {
            return JSON.parse(fs.readFileSync(this.getMetaPath(), 'utf8'));
        } catch (error) {
            return {};
        }
    }

    /**
     * GET <baseUrl>/api/display — the same contract the TRMNL firmware
     * uses. Response fields of interest: image_url (absolute or relative),
     * refresh_rate.
     */
    fetchDisplayJson() {
        return new Promise((resolve, reject) => {
            const displayUrl = new URL('/api/display', this.baseUrl);
            const client = displayUrl.protocol === 'https:' ? https : http;

            const req = client.get(displayUrl, {
                timeout: this.requestTimeout,
                headers: {
                    ID: this.deviceMac,
                    'Access-Token': this.apiKey
                }
            }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`TRMNL display API returned HTTP ${res.statusCode}`));
                    return;
                }

                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse TRMNL display response: ${error.message}`));
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy(new Error(`TRMNL display API timed out after ${this.requestTimeout}ms`));
            });
            req.on('error', (error) => {
                reject(new Error(`Failed to reach TRMNL display API: ${error.message}`));
            });
        });
    }

    /**
     * Download image_url to a temp file, verify it's a PNG, then atomically
     * rename over the previous cache — a bad/partial download must never
     * clobber a good cached screen.
     */
    downloadImage(imageUrl) {
        return new Promise((resolve, reject) => {
            const resolvedUrl = new URL(imageUrl, this.baseUrl);
            const client = resolvedUrl.protocol === 'https:' ? https : http;
            const tempPath = `${this.getScreenPath()}.tmp`;

            const req = client.get(resolvedUrl, { timeout: this.requestTimeout }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`TRMNL image download returned HTTP ${res.statusCode}`));
                    return;
                }

                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);

                    if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) {
                        reject(new Error('TRMNL image is not PNG (BYOS may be serving BMP — see TRMNL_SETUP.md)'));
                        return;
                    }

                    try {
                        fs.writeFileSync(tempPath, buffer);
                        fs.renameSync(tempPath, this.getScreenPath());
                        resolve(this.getScreenPath());
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy(new Error(`TRMNL image download timed out after ${this.requestTimeout}ms`));
            });
            req.on('error', reject);
        });
    }

    /**
     * Placeholder screen for --mock/tests — no network.
     */
    getMockScreen() {
        const width = 800;
        const height = 480;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, width - 4, height - 4);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 48px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TRMNL (mock)', width / 2, height / 2);

        const mockPath = path.join(this.cacheDir, 'mock-screen.png');
        fs.writeFileSync(mockPath, canvas.toBuffer('image/png'));

        return {
            imagePath: mockPath,
            width,
            height,
            source: 'mock'
        };
    }

    /**
     * Fetch the current TRMNL screen with a fallback chain:
     * mock -> unconfigured=null -> fresh cache -> API -> expired cache -> null.
     * Never fabricates content for the real display — the caller falls
     * back to the default layout when this resolves to null.
     */
    async getFormattedTrmnl() {
        if (this.mockData) {
            return this.getMockScreen();
        }

        if (!this.isConfigured()) {
            console.warn('TrmnlService: TRMNL_BASE_URL/DEVICE_MAC/API_KEY not fully configured; skipping');
            return null;
        }

        if (this.isCacheValid()) {
            return { imagePath: this.getScreenPath(), ...this.loadMeta(), source: 'cache' };
        }

        // Short negative memo so a down BYOS isn't re-hit on every request.
        if (Date.now() - this._lastFailureAt < NEGATIVE_CACHE_MS && this.hasCache()) {
            return { imagePath: this.getScreenPath(), ...this.loadMeta(), source: 'expired-cache' };
        }

        try {
            const display = await this.fetchDisplayJson();
            if (!display.image_url) {
                throw new Error('TRMNL display response missing image_url');
            }

            await this.downloadImage(display.image_url);

            const meta = { refreshRate: display.refresh_rate || null, fetchedAt: Date.now() };
            this.saveMeta(meta);

            return { imagePath: this.getScreenPath(), ...meta, source: 'api' };
        } catch (error) {
            console.warn(`TrmnlService: fetch failed: ${error.message}`);
            this._lastFailureAt = Date.now();

            if (this.hasCache()) {
                return { imagePath: this.getScreenPath(), ...this.loadMeta(), source: 'expired-cache' };
            }

            return null;
        }
    }
}

module.exports = TrmnlService;
