@props(['size' => 'full'])
@php
    $wx = data_get($data, 'properties.timeseries.0.data.instant.details', []);
    $tempC = $wx['air_temperature'] ?? null;
    $tempF = is_numeric($tempC) ? round($tempC * 9 / 5 + 32) : 'N/A';
    $windMs = $wx['wind_speed'] ?? null;
    $windMph = is_numeric($windMs) ? round($windMs * 2.23694) : 'N/A';
    $rh = $wx['relative_humidity'] ?? null;
    $rh = is_numeric($rh) ? round($rh) . '%' : 'N/A';
    $symbol = data_get($data, 'properties.timeseries.0.data.next_1_hours.summary.symbol_code')
        ?: data_get($data, 'properties.timeseries.0.data.next_6_hours.summary.symbol_code');
    $conditions = $symbol ? ucwords(str_replace('_', ' ', $symbol)) : 'N/A';
@endphp
<x-trmnl::view size="{{ $size }}">
    <x-trmnl::layout class="layout--col gap--space-between">
        <div class="grid" style="gap: 9px;">
            <div class="row row--center col--span-3 col--end">
                <img class="weather-image" style="max-height: 150px; margin:auto;"
                     src="{{ config('services.trmnl.base_url') }}/images/plugins/weather/wi-thermometer.svg">
            </div>
            <div class="col col--span-3 col--center">
                <div class="item">
                    <div class="meta"></div>
                    <div class="justify-center">
                        <span class="value value--xxlarge" data-fit-value="true">{{ $tempF }}&deg;</span>
                        <span class="label">Temperature</span>
                    </div>
                </div>
            </div>
            <div class="col col--span-3 col--end gap--medium">
                <div class="item">
                    <div class="meta"></div>
                    <div class="content">
                        <span class="value value--small">{{ $windMph }}</span>
                        <span class="label">Wind (mph)</span>
                    </div>
                </div>
                <div class="item">
                    <div class="meta"></div>
                    <div class="content">
                        <span class="value value--small">{{ $rh }}</span>
                        <span class="label">Humidity</span>
                    </div>
                </div>
                <div class="item">
                    <div class="meta"></div>
                    <div class="content">
                        <span class="value value--xsmall">{{ $conditions }}</span>
                        <span class="label">Right Now</span>
                    </div>
                </div>
            </div>
        </div>
    </x-trmnl::layout>
    <x-trmnl::title-bar title="Weather Chicago"
                        instance="{{ now()->timezone('America/Chicago')->format('g:i A') }}"/>
</x-trmnl::view>
