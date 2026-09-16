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
 * Anchored to the cached screen's own fetchedAt, which survives service
 * restarts; a restart mid-outage therefore doesn't reset the clock.
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
     * @returns {{stale: boolean, notify: boolean, staleMinutes: number|null, hadScreen: boolean}}
     */
    evaluate(result, now) {
        const source = result && result.source;
        const healthy = source === 'api' || source === 'cache' || source === 'mock';

        if (healthy) {
            this.alerted = false; // re-arm for the next episode
            this.firstFailureAt = null;
            return { stale: false, notify: false, staleMinutes: null, hadScreen: true };
        }

        // Failing: expired-cache, or null (no cached screen at all).
        if (this.firstFailureAt === null) {
            this.firstFailureAt = now;
        }

        const lastGoodAt = (result && result.fetchedAt) || null;
        // No cached screen means no fetchedAt to age — measure the episode
        // from its first observed failure instead.
        const anchor = lastGoodAt ?? this.firstFailureAt;
        const staleMs = now - anchor;
        const staleMinutes = Math.round(staleMs / 60000);
        const hadScreen = lastGoodAt !== null;

        if (staleMs <= this.thresholdMs) {
            return { stale: false, notify: false, staleMinutes, hadScreen };
        }

        if (this.alerted) {
            return { stale: true, notify: false, staleMinutes, hadScreen };
        }

        this.alerted = true;
        return { stale: true, notify: true, staleMinutes, hadScreen };
    }
}

module.exports = { TrmnlStalenessAlertState };
