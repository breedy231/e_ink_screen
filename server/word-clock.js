/**
 * Quarter-hour word clock for the TRMNL clock strip.
 *
 * The Kindle redraws at :00/:15/:30/:45 (+30s), so the time is floored to
 * the quarter we're in: "quarter past two" stays true until the next redraw.
 */

const HOURS = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six',
    'seven', 'eight', 'nine', 'ten', 'eleven'];

/** Local {hour, minute, weekday} for `date` in `timeZone`. */
function localParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'long',
        hourCycle: 'h23'
    }).formatToParts(date);
    const get = type => parts.find(p => p.type === type).value;
    return { hour: Number(get('hour')), minute: Number(get('minute')), weekday: get('weekday') };
}

function phraseFor(hour, minute) {
    const cur = HOURS[hour % 12];
    const next = HOURS[(hour + 1) % 12];
    switch (Math.floor(minute / 15)) {
        case 0:
            if (hour === 12) return 'noon';
            if (hour === 0) return 'midnight';
            return `${cur} o’clock`;
        case 1: return `quarter past ${cur}`;
        case 2: return `half past ${cur}`;
        default: return `quarter to ${next}`;
    }
}

function partOfDay(hour) {
    if (hour < 5) return 'night';
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    if (hour < 21) return 'evening';
    return 'night';
}

/**
 * @returns {{phrase: string, mood: string}} e.g.
 *   { phrase: 'quarter past two', mood: 'Sunday afternoon' }
 */
function wordClock(date, timeZone) {
    const { hour, minute, weekday } = localParts(date, timeZone);
    return { phrase: phraseFor(hour, minute), mood: `${weekday} ${partOfDay(hour)}` };
}

module.exports = { wordClock, phraseFor, partOfDay };
