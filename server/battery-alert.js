/**
 * Low-battery alert decision logic.
 *
 * Split out of local-dashboard-server.js so it can be unit tested without
 * pulling in the canvas render pipeline.
 *
 * The Kindle reports its battery level on every dashboard fetch. We want one
 * Discord ping per 5% bucket as the level falls (15, 10, 5, 0), and we want
 * that to happen again on the NEXT discharge cycle — the original inline
 * version never cleared its high-water mark, so after a single drain to ~3%
 * it latched at bucket 0 and stayed silent for the life of the process.
 */

const LOW_BATTERY_THRESHOLD = 15;   // start warning at or below this
const CRITICAL_THRESHOLD = 5;       // "Critical" rather than "Low"
const BUCKET_SIZE = 5;

class BatteryAlertState {
    constructor() {
        this.lastNotifiedBucket = null; // last 5%-bucket we notified at
    }

    /** Re-arm so the next discharge cycle alerts again. */
    reset() {
        this.lastNotifiedBucket = null;
    }

    /**
     * Decide whether to alert for this reading.
     *
     * @param {string|number} batteryLevel percent, as reported by the Kindle
     * @param {string} chargingStatus lipc isCharging value ("1" when charging)
     * @returns {{notify: boolean, level: number|null, bucket: number|null,
     *            severity: 'Low'|'Critical'|null, critical: boolean}}
     */
    evaluate(batteryLevel, chargingStatus) {
        const none = { notify: false, level: null, bucket: null, severity: null, critical: false };

        if (batteryLevel === null || batteryLevel === undefined || batteryLevel === '') return none;

        const level = parseInt(batteryLevel, 10);
        if (isNaN(level)) return none;

        // Charging, or recovered above the threshold: re-arm and stay quiet.
        // This is the fix — without it the high-water mark below never clears.
        if (chargingStatus === '1' || level > LOW_BATTERY_THRESHOLD) {
            this.reset();
            return { ...none, level };
        }

        // Only ping once per bucket as the level drops.
        const bucket = Math.floor(level / BUCKET_SIZE) * BUCKET_SIZE;
        if (this.lastNotifiedBucket !== null && bucket >= this.lastNotifiedBucket) {
            return { ...none, level, bucket };
        }

        this.lastNotifiedBucket = bucket;

        const critical = level <= CRITICAL_THRESHOLD;
        return {
            notify: true,
            level,
            bucket,
            severity: critical ? 'Critical' : 'Low',
            critical
        };
    }
}

module.exports = {
    BatteryAlertState,
    LOW_BATTERY_THRESHOLD,
    CRITICAL_THRESHOLD
};
