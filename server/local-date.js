/**
 * Calendar date (YYYY-MM-DD) as seen in `timeZone`.
 *
 * `toISOString().slice(0, 10)` is the UTC date, which in Chicago rolls over
 * to tomorrow at 7pm (6pm in winter) — enough to make an evening screen
 * treat tomorrow as today.
 */
function localDateIso(date = new Date(), timeZone) {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
}

module.exports = { localDateIso };
