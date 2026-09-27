@props(['size' => 'quadrant'])
@php
    $wx = data_get($data, 'properties.timeseries.0.data.instant.details', []);
    $tempC = $wx['air_temperature'] ?? null;
    $tempF = is_numeric($tempC) ? round($tempC * 9 / 5 + 32) : 'N/A';
    $windMs = $wx['wind_speed'] ?? null;
    $windMph = is_numeric($windMs) ? round($windMs * 2.23694) : 'N/A';
    $symbol = data_get($data, 'properties.timeseries.0.data.next_1_hours.summary.symbol_code')
        ?: data_get($data, 'properties.timeseries.0.data.next_6_hours.summary.symbol_code');
    $conditions = $symbol ? ucwords(str_replace('_', ' ', $symbol)) : 'N/A';

    // Hi/lo over the next ~24h of hourly entries (met.no timeseries is UTC-hourly
    // near-term; close enough to "today" for a glanceable wall display).
    $dayTemps = collect(data_get($data, 'properties.timeseries', []))
        ->take(24)
        ->map(fn ($t) => data_get($t, 'data.instant.details.air_temperature'))
        ->filter(fn ($t) => is_numeric($t));
    $hiF = $dayTemps->isNotEmpty() ? round($dayTemps->max() * 9 / 5 + 32) : null;
    $loF = $dayTemps->isNotEmpty() ? round($dayTemps->min() * 9 / 5 + 32) : null;
@endphp
<x-trmnl::view size="{{ $size }}">
    <x-trmnl::layout class="layout--col gap--space-between">
        <div class="col col--center">
            <span class="value value--xlarge" data-fit-value="true">{{ $tempF }}&deg;</span>
            <span class="label">{{ $conditions }}</span>
            @if ($hiF !== null)
                <span class="label">H {{ $hiF }}&deg; / L {{ $loF }}&deg;</span>
            @endif
            <span class="label label--small">wind {{ $windMph }} mph</span>
        </div>
    </x-trmnl::layout>
    <x-trmnl::title-bar title="Chicago"
                        instance="{{ now()->timezone('America/Chicago')->format('g:i A') }}"/>
</x-trmnl::view>
