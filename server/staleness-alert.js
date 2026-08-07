/**
 * Liveness/staleness alert decision logic.
 *
 * The Kindle only fetches during active hours (default 7:00-22:00 Central,
 * every 15 min — see kindle/config/dashboard.conf). If it goes dark during
 * that window (dead battery, crashed loop, WiFi drop) the Pi currently has
 * no way to say so — the 2026-06-18 and 2026-08-07 outages were both silent
 * until someone noticed the physical screen was frozen.
 *
 * Split out like battery-alert.js so the time math can be unit tested
 * without a real clock or HTTP server.
 */

class StalenessAlertState {
    /**
     * @param {object} [opts]
     * @param {number} [opts.thresholdMs] how long without a fetch, once inside
     *   active hours, before we consider the Kindle silent (default 45 min —
     *   three missed 15-min cycles, enough to survive one blip)
     * @param {number} [opts.activeHoursStart] local hour (0-23) fetches begin
     * @param {number} [opts.activeHoursEnd] local hour (0-23) fetches stop
     * @param {string} [opts.timezone] IANA zone the active-hours window is in
     */
    constructor({ thresholdMs = 45 * 60 * 1000, activeHoursStart = 7, activeHoursEnd = 22, timezone = 'America/Chicago' } = {}) {
        this.thresholdMs = thresholdMs;
        this.activeHoursStart = activeHoursStart;
        this.activeHoursEnd = activeHoursEnd;
        this.timezone = timezone;

        this.lastFetchAt = null;
        // Grace-period anchor: either "when we most recently entered active
        // hours" or "when this state was created", whichever is later. Without
        // it, the first check after the overnight gap (or a service restart)
        // would immediately see a multi-hour-old lastFetchAt and false-alarm
        // before the Kindle even got a chance to check in.
        this.graceAnchor = null;
        this.wasActive = false;
        this.alerted = false; // latch: only one notification per stale episode
    }

    /** Call on every dashboard fetch, regardless of query params. */
    recordFetch(now) {
        this.lastFetchAt = now;
        this.alerted = false; // re-arm for the next episode
    }

    isActiveHour(now) {
        const hour = parseInt(
            new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: this.timezone }).format(now),
            10
        ) % 24;
        return hour >= this.activeHoursStart && hour < this.activeHoursEnd;
    }

    /**
     * @param {number} now epoch ms
     * @returns {{stale: boolean, notify: boolean, silentMinutes: number|null}}
     */
    evaluate(now) {
        const active = this.isActiveHour(now);

        if (!active) {
            this.wasActive = false;
            return { stale: false, notify: false, silentMinutes: null };
        }

        if (!this.wasActive) {
            this.graceAnchor = now;
            this.wasActive = true;
        }

        const effectiveLastSeen = Math.max(this.lastFetchAt ?? 0, this.graceAnchor);
        const silentMs = now - effectiveLastSeen;
        const silentMinutes = Math.round(silentMs / 60000);

        if (silentMs <= this.thresholdMs) {
            return { stale: false, notify: false, silentMinutes };
        }

        if (this.alerted) {
            return { stale: true, notify: false, silentMinutes };
        }

        this.alerted = true;
        return { stale: true, notify: true, silentMinutes };
    }
}

module.exports = { StalenessAlertState };
