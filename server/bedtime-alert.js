/**
 * Bedtime charge check alert decision logic.
 *
 * Motivation: 2026-08-10 incident. Kindle entered overnight at 22% battery.
 * The request-driven low-battery alert fires at 15% and below, but the device
 * went completely silent after 22:00 (no fetches overnight). Next morning, dead
 * battery with no Discord alert ever fired.
 *
 * Root cause: the design splits battery monitoring and liveness monitoring
 * into separate state machines:
 * 1. Low-battery threshold (15%) — request-driven, only fires if Kindle is awake
 * 2. Staleness alert (45 min silent) — timer-driven, but only fires DURING
 *    active hours (7-22), so overnight silence is normal and expected
 *
 * This creates a designed blind spot: a low-but-not-critical battery at
 * bedtime (e.g. 22%) goes dark during the overnight window, and the system
 * has no way to say "you should charge that tonight before it dies."
 *
 * Solution: during the bedtime window (configurable 21:00-22:00, one hour
 * before active hours end), check if battery is below a safe overnight level
 * (default 40%). Fire once per evening, suppress if already charging, re-arm
 * on the next calendar day or when charging clears the latch.
 */

class BedtimeAlertState {
    /**
     * @param {object} [opts]
     * @param {number} [opts.safeLevel] battery % below which we warn
     *   (default 40 — empirically, overnight drain is 8-9 points, nonlinear at low end)
     * @param {number} [opts.windowStartHour] local hour (0-23) bedtime window begins
     * @param {number} [opts.windowEndHour] local hour (0-23) bedtime window ends
     *   (typically ACTIVE_HOURS_END from config, e.g. 22)
     * @param {string} [opts.timezone] IANA zone for the bedtime window
     */
    constructor({ safeLevel = 40, windowStartHour = 21, windowEndHour = 22, timezone = 'America/Chicago' } = {}) {
        this.safeLevel = safeLevel;
        this.windowStartHour = windowStartHour;
        this.windowEndHour = windowEndHour;
        this.timezone = timezone;

        this.lastAlertDate = null; // YYYY-MM-DD in local timezone; suppresses re-alert same evening
    }

    /**
     * Compute the local date (YYYY-MM-DD) in the configured timezone.
     *
     * @param {number} now epoch ms
     * @returns {string} local date as YYYY-MM-DD
     */
    getLocalDate(now) {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            timeZone: this.timezone
        });
        return formatter.format(now);
    }

    /**
     * Get the local hour (0-23) in the configured timezone.
     *
     * @param {number} now epoch ms
     * @returns {number} local hour
     */
    getLocalHour(now) {
        const hour = parseInt(
            new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: this.timezone }).format(now),
            10
        ) % 24;
        return hour;
    }

    /**
     * Decide whether to alert for a bedtime low-battery condition.
     *
     * @param {string|number} batteryLevel percent, as reported by the Kindle
     * @param {string} chargingStatus lipc isCharging value ("1" when charging)
     * @param {number} now epoch ms (caller passes Date.now(); parameterized for tests)
     * @returns {{notify: boolean, level: number|null}}
     */
    evaluate(batteryLevel, chargingStatus, now) {
        const none = { notify: false, level: null };

        if (batteryLevel === null || batteryLevel === undefined || batteryLevel === '') return none;

        const level = parseInt(batteryLevel, 10);
        if (isNaN(level)) return none;

        const localHour = this.getLocalHour(now);
        const localDate = this.getLocalDate(now);

        // Already charging: clear the latch and stay quiet.
        // Mission accomplished — the device is on the charger.
        // Clearing the latch means if it's unplugged later tonight while still
        // low, it will re-alert.
        if (chargingStatus === '1') {
            this.lastAlertDate = null;
            return { ...none, level };
        }

        // Outside the bedtime window: no alert (but still report level).
        if (localHour < this.windowStartHour || localHour >= this.windowEndHour) {
            return { ...none, level };
        }

        // Battery above safe level: no alert.
        if (level > this.safeLevel) {
            return { ...none, level };
        }

        // Already alerted today: suppress repeat (one ping per evening).
        if (this.lastAlertDate === localDate) {
            return { ...none, level };
        }

        // Fire: set the latch and return notify.
        this.lastAlertDate = localDate;
        return { notify: true, level };
    }
}

module.exports = { BedtimeAlertState };
