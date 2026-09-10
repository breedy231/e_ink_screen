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
@endphp
<x-trmnl::view size="{{ $size }}">
    <x-trmnl::layout class="layout--col gap--space-between">
        <div class="col col--center">
            <span class="value value--xlarge" data-fit-value="true">{{ $tempF }}&deg;</span>
            <span class="label">{{ $conditions }}</span>
            <span class="label label--small">wind {{ $windMph }} mph</span>
        </div>
    </x-trmnl::layout>
    <x-trmnl::title-bar title="Chicago"
                        instance="{{ now()->timezone('America/Chicago')->format('g:i A') }}"/>
</x-trmnl::view>
