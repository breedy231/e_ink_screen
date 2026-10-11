@props(['size' => 'quadrant'])
@php
    // Quarter-hour word clock. The Kindle redraws at :00/:15/:30/:45 (+30s),
    // so we floor to the quarter we're in: the phrase stays true until the
    // next redraw. Computed at render time — no data source.
    $t = now()->timezone('America/Chicago');
    $hours = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six',
              'seven', 'eight', 'nine', 'ten', 'eleven'];
    $h = $t->hour % 12;
    $cur = $hours[$h];
    $next = $hours[($h + 1) % 12];
    [$line1, $line2] = match (intdiv($t->minute, 15)) {
        0 => match ($t->hour) {
            12 => ['noon', ''],
            0 => ['midnight', ''],
            default => [$cur, 'o’clock'],
        },
        1 => ['quarter past', $cur],
        2 => ['half past', $cur],
        3 => ['quarter to', $next],
    };
    $part = match (true) {
        $t->hour < 5 => 'night',
        $t->hour < 12 => 'morning',
        $t->hour < 17 => 'afternoon',
        $t->hour < 21 => 'evening',
        default => 'night',
    };
    $mood = $t->format('l') . ' ' . $part;
@endphp
<div class="view view--{{ $size }}">
  <div style="display:flex; flex-direction:column; justify-content:space-between; height:100%; box-sizing:border-box; padding:24px 26px; text-align:left; color:#000;">
    <div style="font-size:52px; line-height:1.02; font-weight:600; letter-spacing:-1px;">{{ $line1 }}@if ($line2 !== '')<br>{{ $line2 }}@endif</div>
    <div style="font-size:26px;">{{ $mood }}</div>
  </div>
</div>
