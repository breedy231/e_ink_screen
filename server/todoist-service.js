#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Todoist Service Module — today + overdue tasks for the dashboard.
 *
 * Same cache + fallback chain as transit-service.js (live -> cache ->
 * expired cache -> fixture). An unset TODOIST_API_TOKEN skips the live
 * attempt entirely, so "unconfigured" and "down" both land on the
 * fixture — matching how CTA behaved before its keys arrived.
 */

const TODOIST_API_BASE = 'https://api.todoist.com/api/v1';
const MAX_TASKS = 12;

class TodoistService {
    constructor(options = {}) {
        this.apiToken = options.apiToken || config.TODOIST_API_TOKEN;
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'cache');
        this.fixturesDir = options.fixturesDir || path.join(__dirname, 'fixtures', 'todoist');
        this.cacheTimeout = options.cacheTimeout || config.TODOIST_CACHE_TTL_MS;
        this.requestTimeout = options.requestTimeout || 15000;
        this.useFixtures = options.useFixtures || false;

        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    getCacheFilePath() {
        return path.join(this.cacheDir, 'todoist_cache.json');
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
            console.warn(`Failed to save todoist cache: ${error.message}`);
        }
    }

    loadFixture() {
        const raw = fs.readFileSync(path.join(this.fixturesDir, 'tasks.json'), 'utf8');
        return JSON.parse(raw);
    }

    httpGetJson(urlPath) {
        return new Promise((resolve, reject) => {
            const req = https.get(`${TODOIST_API_BASE}${urlPath}`, {
                timeout: this.requestTimeout,
                headers: { Authorization: `Bearer ${this.apiToken}` }
            }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`Todoist API returned HTTP ${res.statusCode}`));
                    return;
                }
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse Todoist response: ${error.message}`));
                    }
                });
            });
            req.on('timeout', () => req.destroy(new Error('Todoist API request timed out')));
            req.on('error', (error) => reject(new Error(`Todoist API request failed: ${error.message}`)));
        });
    }

    async fetchTasksAndProjects() {
        if (!this.apiToken) return null;
        // Unified v1 API (REST v2 started returning 410 Gone in 2026).
        // Both endpoints wrap payloads in { results, next_cursor }.
        const query = encodeURIComponent('overdue | today');
        const [tasksResp, projectsResp] = await Promise.all([
            this.httpGetJson(`/tasks/filter?query=${query}&limit=100`),
            this.httpGetJson('/projects?limit=200')
        ]);
        return {
            tasks: (tasksResp && tasksResp.results) || [],
            projects: (projectsResp && projectsResp.results) || []
        };
    }

    /**
     * v1 folds any due time into `due.date` as a naive local datetime
     * ("2026-09-14T22:30:00"); date-only tasks stay "2026-09-14". Format
     * the clock time directly off the string — no Date/timezone round trip.
     */
    formatDueTime(dueDate) {
        if (!dueDate || !dueDate.includes('T')) return null;
        const [h, m] = dueDate.slice(11, 16).split(':').map(Number);
        const suffix = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 === 0 ? 12 : h % 12;
        return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
    }

    /**
     * Raw Todoist shape -> ours. Overdue first, then by priority (Todoist
     * p1 = API priority 4) and time. `todayIso` injectable for tests.
     */
    parseTasks(raw, todayIso) {
        const today = todayIso || new Date().toISOString().slice(0, 10);
        const projectNames = {};
        for (const p of (raw && raw.projects) || []) projectNames[p.id] = p.name;

        const tasks = ((raw && raw.tasks) || [])
            .map(t => {
                const dueDate = t.due && t.due.date ? t.due.date.slice(0, 10) : null;
                return {
                    content: t.content,
                    project: projectNames[t.project_id] || null,
                    priority: 5 - (t.priority || 1),   // API 4..1 -> display P1..P4
                    time: this.formatDueTime(t.due && t.due.date),
                    isOverdue: dueDate !== null && dueDate < today
                };
            })
            .sort((a, b) =>
                Number(b.isOverdue) - Number(a.isOverdue) ||
                a.priority - b.priority ||
                String(a.time || '￿').localeCompare(String(b.time || '￿'))
            );

        return {
            tasks: tasks.slice(0, MAX_TASKS),
            counts: {
                overdue: tasks.filter(t => t.isOverdue).length,
                today: tasks.filter(t => !t.isOverdue).length,
                total: tasks.length
            }
        };
    }

    async getTodoistData() {
        let raw;
        if (!this.useFixtures && this.isCacheValid()) {
            raw = this.loadCachedData();
            if (raw) return { ...this.parseTasks(raw), source: 'cache', _timestamp: Date.now() };
        }

        if (!this.useFixtures) {
            try {
                raw = await this.fetchTasksAndProjects();
                if (raw) {
                    this.saveCachedData(raw);
                    return { ...this.parseTasks(raw), source: 'api', _timestamp: Date.now() };
                }
            } catch (error) {
                console.warn(`Todoist API failed: ${error.message}`);
            }

            raw = this.loadCachedData();
            if (raw) return { ...this.parseTasks(raw), source: 'expired-cache', _timestamp: Date.now() };
        }

        const fixture = this.loadFixture();
        return { ...this.parseTasks(fixture, fixture._todayIso), source: 'fixture', _timestamp: Date.now() };
    }
}

module.exports = TodoistService;
