#!/usr/bin/env node

/**
 * Tests for the night screen model and the local-date helper it relies on
 * Run with: node server/night-screen.test.js
 */

const { buildNightModel } = require('./night-screen');
const { localDateIso } = require('./local-date');
const WeatherService = require('./weather-service');
const TodoistService = require('./todoist-service');

let testsPassed = 0;
let testsFailed = 0;

function assertEquals(actual, expected, message) {
    if (actual === expected) {
        console.log(`  ✓ ${message}`);
        testsPassed++;
    } else {
        console.error(`  ✗ ${message} (expected: ${expected}, got: ${actual})`);
        testsFailed++;
    }
}

const TZ = 'America/Chicago';
// Thu Oct 15 2026, 10:00:30 PM CDT = Fri 03:00:30 UTC
const TEN_PM = new Date('2026-10-16T03:00:30Z');
// Fri Oct 16 2026, 2:10 AM CDT (a reboot overnight)
const TWO_AM = new Date('2026-10-16T07:10:00Z');

const calendar = {
    today: [{ time: '9:00 AM', name: 'Today thing', allDay: false }],
    tomorrow: [
        { time: '10:00 AM', name: 'Piano spa day ', allDay: false },
        { time: 'All day', name: 'Holiday', allDay: true }
    ]
};
const weather = {
    days: [
        { isoDate: '2026-10-15', highTemp: '65°', lowTemp: '51°', condition: 'Rain', sunrise: '7:07 AM' },
        { isoDate: '2026-10-16', highTemp: '61°', lowTemp: '48°', condition: 'Showers', sunrise: '7:08 AM' },
        { isoDate: '2026-10-17', highTemp: '70°', lowTemp: '55°', condition: 'Clear sky', sunrise: '7:09 AM' }
    ]
};

console.log('\nTest 1: local date, not UTC date, after 7pm Central');
assertEquals(localDateIso(TEN_PM, TZ), '2026-10-15', '10pm CDT is still the 15th locally');
assertEquals(TEN_PM.toISOString().slice(0, 10), '2026-10-16', '(UTC already says the 16th)');

console.log('\nTest 2: drawn at 10pm — tomorrow is Friday');
let m = buildNightModel({ now: TEN_PM, timeZone: TZ, wakeHour: 7, safeLevel: 40, calendar, weather,
    deviceStats: { battery: { level: '26' }, charging: false } });
assertEquals(m.nightOf, 'Thursday, Oct 15', 'header names the evening');
assertEquals(m.nextDayHeading, 'Tomorrow', 'left column heading');
assertEquals(m.nextDayName, 'Friday', 'right column heading');
assertEquals(m.events.length, 2, 'tomorrow\'s events');
assertEquals(m.events[0].name, 'Piano spa day', 'event name trimmed');
assertEquals(m.events[1].time, 'All day', 'all-day label');
assertEquals(m.weather.high, '61°', 'weather is Friday\'s, not Saturday\'s');
assertEquals(m.weather.sunrise, '7:08 AM', 'Friday sunrise');
assertEquals(m.asleepSince, '10:00 PM', 'asleep since, floored to the quarter');
assertEquals(m.backAt, '7:00 AM', 'wake time');
assertEquals(m.battery, '26%', 'battery');
assertEquals(m.batteryNote, 'charge tonight', 'low battery says charge tonight');

console.log('\nTest 3: drawn after midnight — the next day is today');
m = buildNightModel({ now: TWO_AM, timeZone: TZ, wakeHour: 7, calendar, weather });
assertEquals(m.nightOf, 'Thursday, Oct 15', 'still Thursday night');
assertEquals(m.nextDayHeading, 'Today', 'heading says Today');
assertEquals(m.nextDayName, 'Friday', 'Friday');
assertEquals(m.events[0].name, 'Today thing', 'uses today\'s events');
assertEquals(m.weather.high, '61°', 'Friday weather');
assertEquals(m.asleepSince, '2:00 AM', 'asleep since 2:00');
assertEquals(m.battery, null, 'no battery param, no battery');

console.log('\nTest 4: battery notes');
const note = (level, charging) => buildNightModel({ now: TEN_PM, timeZone: TZ,
    deviceStats: { battery: { level }, charging } }).batteryNote;
assertEquals(note('80', false), '', 'healthy: no note');
assertEquals(note('40', false), 'charge tonight', 'at the safe level: charge');
assertEquals(note('20', true), 'charging', 'charging wins');
assertEquals(buildNightModel({ now: TEN_PM, timeZone: TZ,
    deviceStats: { battery: { level: 'unknown' } } }).battery, null, 'unknown level: no battery');

console.log('\nTest 4b: trailing time in the title is dropped when it matches');
const named = (time, name) => buildNightModel({ now: TEN_PM, timeZone: TZ,
    calendar: { tomorrow: [{ time, name }] } }).events[0].name;
assertEquals(named('10:00 AM', 'Piano spa day 10:00'), 'Piano spa day', '"10:00" matches 10:00 AM');
assertEquals(named('9:00 AM', 'Tuning 9:00'), 'Tuning', '"9:00"');
assertEquals(named('3:00 PM', 'Scott haircut 3:00 '), 'Scott haircut', 'trailing space');
assertEquals(named('3:00 PM', 'Haircut 3pm'), 'Haircut', '"3pm"');
assertEquals(named('6:30 PM', 'Route 66'), 'Route 66', 'a number that isn\'t the time stays');
assertEquals(named('All day', 'Day 2'), 'Day 2', 'all-day events untouched');

console.log('\nTest 5: missing data degrades, too many events collapse');
m = buildNightModel({ now: TEN_PM, timeZone: TZ });
assertEquals(m.events.length, 0, 'no calendar: no events');
assertEquals(m.weather, null, 'no weather: null');
const many = { tomorrow: Array.from({ length: 6 }, (_, i) => ({ time: `${i + 1}:00 PM`, name: `E${i}` })) };
m = buildNightModel({ now: TEN_PM, timeZone: TZ, calendar: many });
assertEquals(m.events.length, 3, 'shows 3 when there are more than 4');
assertEquals(m.moreEvents, 3, '+3 more');

console.log('\nTest 6: weather forecast skips today by local date (UTC-date regression)');
const ws = new WeatherService({ timezone: TZ, cacheDir: require('os').tmpdir() });
const realNow = Date.now;
Date.now = () => TEN_PM.getTime();
const RealDate = Date;
global.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [TEN_PM.getTime()])); }
    static now() { return TEN_PM.getTime(); }
};
const formatted = ws.formatWeatherForDashboard({
    current: { temperature_2m: 60, relative_humidity_2m: 50, weather_code: 0, wind_speed_10m: 5 },
    daily: {
        time: ['2026-10-15', '2026-10-16', '2026-10-17'],
        weather_code: [61, 80, 0],
        temperature_2m_max: [65, 61, 70],
        temperature_2m_min: [51, 48, 55],
        sunrise: ['2026-10-15T07:07', '2026-10-16T07:08', '2026-10-17T07:09']
    }
});
assertEquals(formatted.forecast[0].highTemp, '61°', 'first forecast day is Friday at 10pm Thursday');
assertEquals(formatted.days.length, 3, 'days keeps today too');
assertEquals(formatted.days[1].sunrise, '7:08 AM', 'sunrise formatted');

console.log('\nTest 7: Todoist "today" is the local date (UTC-date regression)');
const ts = new TodoistService({ useFixtures: true });
const parsed = ts.parseTasks({
    tasks: [{ id: '1', content: 'Due today', priority: 1, project_id: 'p', due: { date: '2026-10-15' } }],
    projects: [{ id: 'p', name: 'Inbox' }]
}, undefined, TEN_PM);
assertEquals(parsed.tasks[0].isOverdue, false, 'a task due today is not overdue at 10pm');
global.Date = RealDate;
Date.now = realNow;

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
process.exit(testsFailed > 0 ? 1 : 0);
