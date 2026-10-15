/**
 * Night screen model: what the Kindle shows outside active hours.
 *
 * The loop draws this once as the radio goes off, and nothing redraws it
 * until morning — so every line has to stay true all night, and it has to
 * say when it was drawn. If it's still up after the wake time, the dates
 * on it make that obvious. That's also why there's no clock on it.
 *
 * Pure (no canvas) so it can be tested; NightComponent in
 * dashboard-engine.js draws it.
 */

const { localDateIso } = require('./local-date');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 4;

function localParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
    }).formatToParts(date);
    const get = type => Number(parts.find(p => p.type === type).value);
    return { hour: get('hour'), minute: get('minute') };
}

function clockLabel(hour, minute) {
    return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/**
 * Calendar titles often repeat the start time ("Tuning 9:00", "Piano spa day
 * 10:00"); the screen already shows the time above the name, so drop a
 * trailing time that matches it.
 */
function stripTrailingTime(name, time) {
    const match = /^(.*\S)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(name);
    const start = /^(\d{1,2}):(\d{2})/.exec(time || '');
    if (!match || !start) return name;
    const sameHour = Number(match[2]) === Number(start[1]);
    const sameMinute = Number(match[3] || 0) === Number(start[2]);
    return sameHour && sameMinute ? match[1] : name;
}

function dayLabel(date, timeZone, opts) {
    return new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(date);
}

/**
 * @param {object} p
 *   now         Date the screen is drawn
 *   timeZone    IANA zone (config.TIMEZONE)
 *   wakeHour    local hour active hours resume (config.ACTIVE_HOURS_START)
 *   safeLevel   battery % at or below which to say "charge tonight"
 *   calendar    calendar-service formatted data ({ today, tomorrow }) or null
 *   weather     weather-service formatted data (with `days`) or null
 *   deviceStats { battery: { level }, charging } from the request, or null
 */
function buildNightModel({ now = new Date(), timeZone, wakeHour = 7, safeLevel = 40,
    calendar = null, weather = null, deviceStats = null }) {
    const { hour, minute } = localParts(now, timeZone);

    // Drawn after midnight (a reboot at 2am): the "next day" is already today,
    // and the night belongs to yesterday's date.
    const afterMidnight = hour < wakeHour;
    const evening = afterMidnight ? new Date(now.getTime() - DAY_MS) : now;
    const nextDay = afterMidnight ? now : new Date(now.getTime() + DAY_MS);

    const allEvents = (calendar && (afterMidnight ? calendar.today : calendar.tomorrow)) || [];
    const events = allEvents.length > MAX_EVENTS ? allEvents.slice(0, MAX_EVENTS - 1) : allEvents;

    const nextIso = localDateIso(nextDay, timeZone);
    const day = weather && Array.isArray(weather.days)
        ? weather.days.find(d => d.isoDate === nextIso) || null
        : null;

    const level = deviceStats && deviceStats.battery && Number(deviceStats.battery.level);
    const hasLevel = Number.isFinite(level);
    const charging = !!(deviceStats && deviceStats.charging);
    let batteryNote = '';
    if (charging) batteryNote = 'charging';
    else if (hasLevel && level <= safeLevel) batteryNote = 'charge tonight';

    return {
        nightOf: dayLabel(evening, timeZone, { weekday: 'long', month: 'short', day: 'numeric' }),
        nextDayHeading: afterMidnight ? 'Today' : 'Tomorrow',
        nextDayName: dayLabel(nextDay, timeZone, { weekday: 'long' }),
        events: events.map(e => {
            const time = e.allDay ? 'All day' : (e.time || '');
            return { time, name: stripTrailingTime((e.name || '').trim(), time) };
        }),
        moreEvents: allEvents.length - events.length,
        weather: day && {
            high: day.highTemp,
            low: day.lowTemp,
            condition: day.condition,
            sunrise: day.sunrise
        },
        // Floored to the quarter, matching the loop's aligned wake-ups
        asleepSince: clockLabel(hour, minute - (minute % 15)),
        backAt: clockLabel(wakeHour, 0),
        battery: hasLevel ? `${level}%` : null,
        batteryNote
    };
}

module.exports = { buildNightModel };
