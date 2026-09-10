/**
 * Per-device alert state registry.
 *
 * Until now the server held exactly ONE set of alert state machines, and
 * `stalenessAlert.recordFetch()` fired on every `/dashboard` hit regardless of
 * which device sent it. That was fine with a single Kindle. It is actively
 * dangerous with two: the second device's polling would continuously re-arm
 * the shared staleness alert, so the desk Kindle could die without anyone
 * being told — reopening the exact silent-failure mode that the 2026-06-18 and
 * 2026-08-07 outages produced and that these alerts were built to close.
 *
 * So alert state is keyed by device, and each device gets a profile saying
 * which alerts even make sense for it. A screen on a permanent charger has no
 * use for battery or bedtime warnings (it is always charging — they would be
 * pure noise), but very much still needs staleness, since "the page stopped
 * updating" becomes its only silent-failure mode.
 *
 * Device identity comes from `?device=` on the request. The desk Kindle sends
 * no such param and must keep working untouched, so an ABSENT param resolves
 * to DEFAULT_DEVICE_ID.
 */

const { BatteryAlertState } = require('./battery-alert');
const { StalenessAlertState } = require('./staleness-alert');
const { BedtimeAlertState } = require('./bedtime-alert');

/** Device that a request with no `?device=` param belongs to. */
const DEFAULT_DEVICE_ID = 'v0';

/**
 * Known devices and which alerts apply to each.
 *
 * `battery`/`bedtime`/`staleness` are capability flags, NOT deployment state —
 * whether a device is actually watched is decided by the monitored list passed
 * to the constructor (see MONITORED_DEVICES in config.js). A device can be
 * known here long before it exists on the network.
 */
const DEVICE_PROFILES = {
    v0: {
        label: 'Desk Kindle',
        // Kindle Touch, no permanent charger — it has died flat twice, so
        // every battery-related alert stays on.
        battery: true,
        bedtime: true,
        staleness: true
    },
    kitchen: {
        label: 'Kitchen Paper',
        // Paperwhite 3, permanently plugged in next to the counter outlet.
        // Always-charging makes battery/bedtime alerts meaningless noise;
        // staleness is the only failure worth hearing about.
        battery: false,
        bedtime: false,
        staleness: true
    }
};

/** Profile handed to a device id we do not recognise: never alerts, never masks. */
function unknownProfile(id) {
    return { label: `Unknown device (${id})`, battery: false, bedtime: false, staleness: false };
}

const VALID_DEVICE_ID = /^[a-z0-9_-]{1,32}$/;

class DeviceAlertRegistry {
    /**
     * @param {object} [opts]
     * @param {string[]} [opts.monitored] device ids to actively watch. Devices
     *   outside this list still resolve (so their fetches are attributed
     *   correctly and never credited to another device) but raise no alerts.
     *   Staleness state for every monitored device is created UP FRONT, not
     *   lazily — a device that dies and never checks in again must still be
     *   able to go stale, which a lazily-created entry could never do.
     * @param {object} [opts.profiles] device id -> profile, for tests.
     * @param {object} [opts.alertConfig] thresholds passed to the state machines.
     */
    constructor({ monitored = [DEFAULT_DEVICE_ID], profiles = DEVICE_PROFILES, alertConfig = {} } = {}) {
        this.profiles = profiles;
        this.alertConfig = alertConfig;
        this.monitored = new Set(monitored);
        this.devices = new Map();

        for (const id of this.monitored) {
            this.get(id);
        }
    }

    /**
     * Map a raw `?device=` value to a device id.
     *
     * Absent -> the default device, preserving the desk Kindle's existing
     * param-less fetches. Present but malformed or unrecognised -> returned
     * as-is (sanitised), so it gets its own inert state rather than being
     * silently credited to the default device. Attributing a stranger's
     * traffic to the desk Kindle is precisely the bug this class exists to
     * prevent, so there is deliberately no fallback-to-default here.
     */
    resolveId(raw) {
        if (raw === null || raw === undefined || raw === '') return DEFAULT_DEVICE_ID;
        const id = String(raw).toLowerCase();
        return VALID_DEVICE_ID.test(id) ? id : 'invalid';
    }

    /** Get (creating if needed) the alert state bundle for a device id. */
    get(deviceId) {
        const existing = this.devices.get(deviceId);
        if (existing) return existing;

        const known = Object.prototype.hasOwnProperty.call(this.profiles, deviceId);
        const profile = known ? this.profiles[deviceId] : unknownProfile(deviceId);
        const watched = this.monitored.has(deviceId);

        const entry = {
            id: deviceId,
            profile,
            // An unwatched device gets no state machines at all, so there is no
            // way for it to emit an alert or hold state that matters.
            battery: watched && profile.battery ? new BatteryAlertState() : null,
            staleness: watched && profile.staleness
                ? new StalenessAlertState({
                    thresholdMs: this.alertConfig.staleThresholdMs,
                    activeHoursStart: this.alertConfig.activeHoursStart,
                    activeHoursEnd: this.alertConfig.activeHoursEnd,
                    timezone: this.alertConfig.timezone
                })
                : null,
            bedtime: watched && profile.bedtime
                ? new BedtimeAlertState({
                    safeLevel: this.alertConfig.bedtimeSafeLevel,
                    windowStartHour: this.alertConfig.bedtimeWindowStart,
                    windowEndHour: this.alertConfig.activeHoursEnd,
                    timezone: this.alertConfig.timezone
                })
                : null
        };

        this.devices.set(deviceId, entry);
        return entry;
    }

    /** Record a fetch against one device only. No-op if it has no staleness state. */
    recordFetch(deviceId, now) {
        const entry = this.get(deviceId);
        if (entry.staleness) entry.staleness.recordFetch(now);
        return entry;
    }

    /** Every device with live staleness state — what the staleness timer walks. */
    stalenessWatched() {
        return [...this.devices.values()].filter((d) => d.staleness);
    }
}

module.exports = { DeviceAlertRegistry, DEVICE_PROFILES, DEFAULT_DEVICE_ID };
