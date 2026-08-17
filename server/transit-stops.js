#!/usr/bin/env node

/**
 * Stop/station config for the transit screen, derived once from the static
 * CTA GTFS feed (transitchicago.com/downloads/sch_data/google_transit.zip,
 * 2026-08-10) for a home near Broadway & Cornelia. Loop-bound only — the
 * platform stpids and rideMinutesToLoop below only make sense for that
 * direction. Re-derive if Brendan moves.
 *
 * rideMinutesToLoop is the median scheduled Belmont -> downtown travel time
 * across every weekday trip in the feed (Red -> Lake, Brown -> Washington/
 * Wells) — see the plan's "Departure + static ride time" option. Buses
 * don't get a ride-time estimate: 8/Halsted doesn't reach the Loop at all,
 * and 146/151 street-running times vary too much to be worth modeling.
 */

module.exports = {
    rail: {
        stationName: 'Belmont',
        mapid: '41320',
        walkMinutes: 11, // 0.54mi
        lines: [
            { route: 'Red', label: 'Red Line', platformStopId: '30256', rideMinutesToLoop: 15 },
            { route: 'Brn', label: 'Brown Line', platformStopId: '30258', rideMinutesToLoop: 20 }
        ]
    },
    bus: [
        { route: '8', label: '8 Halsted', stopId: '5759', stopName: 'Halsted & Cornelia', walkMinutes: 4 },
        { route: '146', label: '146 Inner Lake Shore/Michigan Express', stopId: '1065', stopName: 'Lake Shore & Cornelia', walkMinutes: 5 },
        { route: '151', label: '151 Sheridan', stopId: '1065', stopName: 'Lake Shore & Cornelia', walkMinutes: 5 }
    ]
};
