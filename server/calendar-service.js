#!/usr/bin/env node

const ical = require('node-ical');
const fs = require('fs');
const path = require('path');

/**
 * Calendar Service Module using iCal
 * Fetches calendar events with caching and error handling
 */

class CalendarService {
    constructor(options = {}) {
        this.calendarUrl = options.calendarUrl ||
            'https://p131-caldav.icloud.com/published/2/MjI5OTUzMTIyMjI5OTUzMZLhbQwURkdD4X6iOELPaSGd-SFwu4bBeQeKF-HiOzWVvNRHxpB7SgCR2AETucFgtWqk_4S6kyx6HqeH7RvKT3Q';
        this.timezone = options.timezone || 'America/Chicago';
        this.cacheDir = options.cacheDir || path.join(__dirname, '..', 'cache');
        this.cacheTimeout = options.cacheTimeout || 15 * 60 * 1000; // 15 minutes
        this.mockData = options.mockData || false;

        // Ensure cache directory exists
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    getCacheFilePath() {
        return path.join(this.cacheDir, 'calendar_cache.json');
    }

    isCacheValid() {
        try {
            const cacheFile = this.getCacheFilePath();
            if (!fs.existsSync(cacheFile)) return false;
            const stat = fs.statSync(cacheFile);
            return (Date.now() - stat.mtimeMs) < this.cacheTimeout;
        } catch (error) {
            return false;
        }
    }

    loadCachedData() {
        try {
            const data = fs.readFileSync(this.getCacheFilePath(), 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return null;
        }
    }

    saveCachedData(data) {
        try {
            fs.writeFileSync(this.getCacheFilePath(), JSON.stringify(data));
        } catch (error) {
            console.warn(`Failed to save calendar cache: ${error.message}`);
        }
    }

    getMockCalendarData() {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

        return {
            today: [
                { time: '2:00 PM', name: 'Piano tuning - Marriot', allDay: false },
                { time: '5:30 PM', name: 'Dinner with Sarah', allDay: false }
            ],
            tomorrow: [
                { time: 'All day', name: 'Emmy move-in day', allDay: true },
                { time: '10:00 AM', name: 'Coffee with Alex', allDay: false }
            ],
            upcoming: [
                { time: 'Thu, Mar 12', name: 'Dentist', allDay: false },
                { time: 'Fri, Mar 13', name: 'Date night', allDay: false }
            ],
            source: 'mock',
            _timestamp: Date.now()
        };
    }

    /**
     * Fetch raw calendar data from iCal URL
     */
    async fetchCalendarData() {
        const data = await ical.async.fromURL(this.calendarUrl);
        const events = Object.values(data).filter(e => e.type === 'VEVENT');
        return {
            events: events.map(e => ({
                summary: e.summary || 'Untitled',
                start: new Date(e.start).toISOString(),
                end: new Date(e.end).toISOString(),
                allDay: e.datetype === 'date'
            })),
            _source: 'api',
            _timestamp: Date.now()
        };
    }

    /**
     * Get calendar data with caching
     */
    async getCalendarData() {
        if (this.mockData) {
            return { _source: 'mock', ...this.getMockCalendarData() };
        }

        // Check cache first
        if (this.isCacheValid()) {
            const cachedData = this.loadCachedData();
            if (cachedData) {
                cachedData._source = 'cache';
                return cachedData;
            }
        }

        try {
            const data = await this.fetchCalendarData();
            this.saveCachedData(data);
            return data;
        } catch (error) {
            console.warn(`Calendar API failed: ${error.message}`);

            // Try expired cache
            const cachedData = this.loadCachedData();
            if (cachedData) {
                cachedData._source = 'expired-cache';
                return cachedData;
            }

            // Fall back to mock
            return { _source: 'mock', ...this.getMockCalendarData() };
        }
    }

    /**
     * Format calendar data for dashboard display
     */
    formatForDashboard(calendarData) {
        // If already formatted (mock data), return as-is
        if (calendarData.today) {
            return calendarData;
        }

        const now = new Date();
        const DAY_MS = 24 * 60 * 60 * 1000;

        // Get day boundaries in local timezone
        const localNow = new Date(now.toLocaleString('en-US', { timeZone: this.timezone }));
        const todayStart = new Date(localNow.getFullYear(), localNow.getMonth(), localNow.getDate());
        const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
        const dayAfterTomorrow = new Date(tomorrowStart.getTime() + DAY_MS);
        const upcomingEnd = new Date(todayStart.getTime() + 7 * DAY_MS); // 7 days out

        const todayEvents = [];
        const tomorrowEvents = [];
        const upcomingEvents = [];

        for (const event of calendarData.events) {
            const start = new Date(event.start);
            const end = new Date(event.end);

            // Convert to local time for comparison
            const localStart = new Date(start.toLocaleString('en-US', { timeZone: this.timezone }));
            const localEnd = new Date(end.toLocaleString('en-US', { timeZone: this.timezone }));

            // Today's events (not yet ended)
            if (localStart < tomorrowStart && localEnd > localNow && localStart >= todayStart) {
                todayEvents.push(this.formatEvent(event, start));
            }
            // All-day events that span today
            else if (event.allDay && start <= todayStart && end > todayStart && localEnd > localNow) {
                todayEvents.push(this.formatEvent(event, start));
            }

            // Tomorrow's events
            if (localStart >= tomorrowStart && localStart < dayAfterTomorrow) {
                tomorrowEvents.push(this.formatEvent(event, start));
            }
            // All-day events that span tomorrow
            else if (event.allDay && start <= tomorrowStart && end > tomorrowStart) {
                tomorrowEvents.push(this.formatEvent(event, start));
            }

            // Upcoming events (day after tomorrow through end of window)
            if (localStart >= dayAfterTomorrow && localStart < upcomingEnd) {
                upcomingEvents.push(this.formatEvent(event, start, true));
            }
            else if (event.allDay && start <= dayAfterTomorrow && end > dayAfterTomorrow && localStart < upcomingEnd) {
                upcomingEvents.push(this.formatEvent(event, start, true));
            }
        }

        // Sort by time
        const sortFn = (a, b) => {
            if (a.allDay && !b.allDay) return -1;
            if (!a.allDay && b.allDay) return 1;
            return a._sortTime - b._sortTime;
        };

        todayEvents.sort(sortFn);
        tomorrowEvents.sort(sortFn);
        upcomingEvents.sort((a, b) => a._sortTime - b._sortTime);

        return {
            today: todayEvents.map(({ _sortTime, ...e }) => e),
            tomorrow: tomorrowEvents.map(({ _sortTime, ...e }) => e),
            upcoming: upcomingEvents.map(({ _sortTime, ...e }) => e),
            source: calendarData._source || 'unknown',
            _timestamp: calendarData._timestamp
        };
    }

    formatEvent(event, start, includeDate = false) {
        const dateLabel = includeDate ? start.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone: this.timezone
        }) : null;

        if (event.allDay) {
            return {
                time: dateLabel || 'All day',
                name: event.summary,
                allDay: true,
                _sortTime: start.getTime()
            };
        }

        const timeStr = start.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: this.timezone
        });

        return {
            time: dateLabel ? `${dateLabel}` : timeStr,
            timeSuffix: dateLabel ? timeStr : null,
            name: event.summary,
            allDay: false,
            _sortTime: start.getTime()
        };
    }

    /**
     * Get formatted calendar data for dashboard
     */
    async getFormattedCalendar() {
        const data = await this.getCalendarData();
        return this.formatForDashboard(data);
    }
}

module.exports = CalendarService;
