/**
 * TRMNL screen staleness alert decision logic.
 *
 * The Kindle->Pi leg has staleness-alert.js, but the Pi->BYOS leg had
 * nothing: when the Mac hosting BYOS becomes unreachable (IP drift, Docker
 * down, FileVault-locked after reboot), trmnl-service.js silently serves
 * its expired cache and every health signal stays green — the 2026-09-11
 * outage sat unnoticed for three days that way.
 *
 * Evaluated on each Kindle poll (resolveLayout), so there is no timer and
 * no active-hours math here — polls only happen during active hours.
 *
 * The threshold is measured from the first failing poll of the episode,
 * NOT from the cached screen's fetchedAt. Nothing fetches overnight, so the
 * first morning poll always finds a ~9h-old cache; when that render is slow
 * (trmnl-service.js lets it finish in the background and serves the expired
 * cache meanwhile) the old fetchedAt anchor alerted "stale for 555 min" every
 * morning. Cost: a service restart mid-outage restarts the clock, delaying
 * the alert by one threshold. staleMinutes still reports the screen's age.
 *
 * Split out like battery-alert.js so it can be unit tested without the
 * render deps.
 */

class TrmnlStalenessAlertState {
    /**
     * @param {object} [opts]
     * @param {number} [opts.thresholdMs] how old the last successful BYOS
     *   fetch may get, while fetches are failing, before alerting (default
     *   30 min — six missed 5-min cycles, enough to survive a Mac reboot)
     */
    constructor({ thresholdMs = 30 * 60 * 1000 } = {}) {
        this.thresholdMs = thresholdMs;
        this.firstFailureAt = null;
        this.alerted = false; // latch: one notification per stale episode
    }

    /**
     * @param {{source: string, fetchedAt?: number}|null} result what
     *   getFormattedTrmnl() resolved to for this poll
     * @param {number} now epoch ms
     * @returns {{stale: boolean, notify: boolean, staleMinutes: number|null, failingMinutes: number|null, hadScreen: boolean}}
     */
    evaluate(result, now) {
        const source = result && result.source;
        const healthy = source === 'api' || source === 'cache' || source === 'mock';

        if (healthy) {
            this.alerted = false; // re-arm for the next episode
            this.firstFailureAt = null;
            return { stale: false, notify: false, staleMinutes: null, failingMinutes: null, hadScreen: true };
        }

        // Failing: expired-cache, or null (no cached screen at all).
        if (this.firstFailureAt === null) {
            this.firstFailureAt = now;
        }

        const lastGoodAt = (result && result.fetchedAt) || null;
        const failingMs = now - this.firstFailureAt;
        const failingMinutes = Math.round(failingMs / 60000);
        // Age of what the Kindle is showing; with no cached screen there is
        // nothing to age, so fall back to how long fetches have failed.
        const staleMinutes = lastGoodAt !== null ? Math.round((now - lastGoodAt) / 60000) : failingMinutes;
        const hadScreen = lastGoodAt !== null;
        const base = { staleMinutes, failingMinutes, hadScreen };

        if (failingMs <= this.thresholdMs) {
            return { stale: false, notify: false, ...base };
        }

        if (this.alerted) {
            return { stale: true, notify: false, ...base };
        }

        this.alerted = true;
        return { stale: true, notify: true, ...base };
    }
}

module.exports = { TrmnlStalenessAlertState };
