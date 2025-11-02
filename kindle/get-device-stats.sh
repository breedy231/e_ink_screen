#!/bin/sh

##############################################################################
# Kindle Device Statistics Collection Script
#
# Collects device statistics (battery, WiFi, temperature, update time)
# and outputs them in JSON format for dashboard integration
#
# Usage: ./get-device-stats.sh [--format json|csv|human]
#
# Output formats:
#   json:  JSON object for API consumption
#   csv:   CSV format for logging
#   human: Human-readable format (default)
##############################################################################

set -e

# Default output format
OUTPUT_FORMAT="human"

# Parse command line arguments
while [ $# -gt 0 ]; do
    case $1 in
        --format)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        -h|--help)
            cat << EOF
Kindle Device Statistics Collection Script

Usage: $0 [--format FORMAT]

Options:
    --format FORMAT    Output format: json, csv, or human (default: human)
    -h, --help         Show this help

Examples:
    $0                      # Human-readable output
    $0 --format json        # JSON output for API
    $0 --format csv         # CSV output for logging
EOF
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

##############################################################################
# Device Statistics Functions
##############################################################################

get_battery_level() {
    if [ -x "/usr/bin/gasgauge-info" ]; then
        # Get battery percentage
        gasgauge-info -c 2>/dev/null || echo "unknown"
    elif [ -f "/sys/class/power_supply/mc13892_bat/capacity" ]; then
        # Alternative method using sysfs
        cat /sys/class/power_supply/mc13892_bat/capacity 2>/dev/null || echo "unknown"
    else
        echo "unknown"
    fi
}

get_battery_voltage() {
    if [ -x "/usr/bin/gasgauge-info" ]; then
        # Get voltage in millivolts and convert to volts
        local voltage_mv=$(gasgauge-info -v 2>/dev/null | cut -d' ' -f1 || echo "")
        if [ -n "$voltage_mv" ] && [ "$voltage_mv" != "unknown" ]; then
            # Convert millivolts to volts using integer arithmetic: V = mV / 1000
            local voltage_v_int=$((voltage_mv / 1000))
            local voltage_v_decimal=$(( (voltage_mv % 1000) / 10 ))
            echo "${voltage_v_int}.${voltage_v_decimal}"
        else
            echo "unknown"
        fi
    else
        echo "unknown"
    fi
}

get_device_temperature() {
    if [ -x "/usr/bin/gasgauge-info" ]; then
        # Get temperature in Fahrenheit and convert to Celsius
        local temp_f=$(gasgauge-info -k 2>/dev/null | cut -d' ' -f1 || echo "")
        if [ -n "$temp_f" ] && [ "$temp_f" != "unknown" ]; then
            # Convert Fahrenheit to Celsius using integer arithmetic: C = (F - 32) * 5/9
            local temp_c=$(( (temp_f - 32) * 5 / 9 ))
            echo "$temp_c"
        else
            echo "unknown"
        fi
    elif [ -f "/sys/class/thermal/thermal_zone0/temp" ]; then
        # Convert millidegrees to degrees Celsius
        local temp_millidegrees=$(cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo "0")
        if [ "$temp_millidegrees" != "0" ] && [ "$temp_millidegrees" != "unknown" ]; then
            echo "$((temp_millidegrees / 1000))"
        else
            echo "unknown"
        fi
    else
        echo "unknown"
    fi
}

get_wifi_status() {
    # Check if wireless interface exists and is connected
    if [ -x "/usr/sbin/iwconfig" ] || [ -x "/sbin/iwconfig" ] || [ -x "/usr/bin/iwconfig" ]; then
        local wifi_info=$(iwconfig 2>/dev/null | grep -o 'ESSID:"[^"]*"' | head -1 || echo "")
        if [ -n "$wifi_info" ]; then
            echo "connected"
        else
            echo "disconnected"
        fi
    elif [ -f "/proc/net/wireless" ]; then
        # Alternative check using /proc/net/wireless
        if [ "$(wc -l < /proc/net/wireless 2>/dev/null || echo 0)" -gt 2 ]; then
            echo "connected"
        else
            echo "disconnected"
        fi
    else
        echo "unknown"
    fi
}

get_wifi_network_name() {
    if [ -x "/usr/sbin/iwconfig" ] || [ -x "/sbin/iwconfig" ] || [ -x "/usr/bin/iwconfig" ]; then
        local essid=$(iwconfig 2>/dev/null | grep -o 'ESSID:"[^"]*"' | head -1 | sed 's/ESSID:"\(.*\)"/\1/' || echo "")
        if [ -n "$essid" ] && [ "$essid" != "off/any" ]; then
            echo "$essid"
        else
            echo "none"
        fi
    else
        echo "unknown"
    fi
}

get_uptime() {
    if [ -f "/proc/uptime" ]; then
        local uptime_seconds=$(cat /proc/uptime 2>/dev/null | cut -d' ' -f1 | cut -d'.' -f1 || echo "0")
        if [ "$uptime_seconds" != "0" ]; then
            # Convert to hours using integer arithmetic
            local uptime_hours=$((uptime_seconds / 3600))
            local remaining_minutes=$(( (uptime_seconds % 3600) / 60 ))

            if [ $uptime_hours -gt 0 ]; then
                echo "${uptime_hours}.${remaining_minutes}"
            else
                echo "0.${remaining_minutes}"
            fi
        else
            echo "unknown"
        fi
    else
        echo "unknown"
    fi
}

get_memory_usage() {
    if [ -f "/proc/meminfo" ]; then
        local mem_total=$(grep MemTotal /proc/meminfo | awk '{print $2}' 2>/dev/null || echo "0")
        local mem_free=$(grep MemFree /proc/meminfo | awk '{print $2}' 2>/dev/null || echo "0")

        if [ "$mem_total" -gt 0 ]; then
            local mem_used=$((mem_total - mem_free))
            local mem_percent=$(( (mem_used * 100) / mem_total ))
            echo "$mem_percent"
        else
            echo "unknown"
        fi
    else
        echo "unknown"
    fi
}

get_last_update_time() {
    # Check when dashboard was last updated
    local dashboard_file="/mnt/us/dashboard/current.png"
    if [ -f "$dashboard_file" ]; then
        # Get file modification time
        local mod_time=$(stat -c %Y "$dashboard_file" 2>/dev/null || echo "0")
        if [ "$mod_time" != "0" ]; then
            date -d "@$mod_time" '+%H:%M:%S' 2>/dev/null || echo "unknown"
        else
            echo "unknown"
        fi
    else
        echo "never"
    fi
}

get_current_time() {
    date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "unknown"
}

get_timestamp() {
    date +%s 2>/dev/null || echo "0"
}

##############################################################################
# Output Functions
##############################################################################

# Escape string for JSON (basic implementation)
json_escape() {
    local input="$1"
    # Replace quotes and backslashes
    echo "$input" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

output_json() {
    local battery_level="$1"
    local battery_voltage="$2"
    local temperature="$3"
    local wifi_status="$4"
    local wifi_network="$5"
    local uptime="$6"
    local memory_usage="$7"
    local last_update="$8"
    local current_time="$9"
    local timestamp="${10}"

    cat << EOF
{
  "timestamp": $timestamp,
  "current_time": "$(json_escape "$current_time")",
  "battery": {
    "level": "$(json_escape "$battery_level")",
    "voltage": "$(json_escape "$battery_voltage")"
  },
  "temperature": "$(json_escape "$temperature")",
  "wifi": {
    "status": "$(json_escape "$wifi_status")",
    "network": "$(json_escape "$wifi_network")"
  },
  "system": {
    "uptime_hours": "$(json_escape "$uptime")",
    "memory_usage_percent": "$(json_escape "$memory_usage")"
  },
  "dashboard": {
    "last_update": "$(json_escape "$last_update")"
  }
}
EOF
}

output_csv() {
    local battery_level="$1"
    local battery_voltage="$2"
    local temperature="$3"
    local wifi_status="$4"
    local wifi_network="$5"
    local uptime="$6"
    local memory_usage="$7"
    local last_update="$8"
    local current_time="$9"
    local timestamp="${10}"

    echo "$timestamp,$current_time,$battery_level,$battery_voltage,$temperature,$wifi_status,$wifi_network,$uptime,$memory_usage,$last_update"
}

output_human() {
    local battery_level="$1"
    local battery_voltage="$2"
    local temperature="$3"
    local wifi_status="$4"
    local wifi_network="$5"
    local uptime="$6"
    local memory_usage="$7"
    local last_update="$8"
    local current_time="$9"

    cat << EOF
Kindle Device Statistics
========================
Current Time: $current_time

Battery:
  Level: $battery_level%
  Voltage: $battery_voltage V

Device:
  Temperature: $temperature°C
  Uptime: $uptime hours
  Memory Usage: $memory_usage%

Network:
  WiFi Status: $wifi_status
  WiFi Network: $wifi_network

Dashboard:
  Last Update: $last_update
EOF
}

##############################################################################
# Main Function
##############################################################################

main() {
    # Collect all statistics
    battery_level=$(get_battery_level)
    battery_voltage=$(get_battery_voltage)
    temperature=$(get_device_temperature)
    wifi_status=$(get_wifi_status)
    wifi_network=$(get_wifi_network_name)
    uptime=$(get_uptime)
    memory_usage=$(get_memory_usage)
    last_update=$(get_last_update_time)
    current_time=$(get_current_time)
    timestamp=$(get_timestamp)

    # Output in requested format
    case "$OUTPUT_FORMAT" in
        "json")
            output_json "$battery_level" "$battery_voltage" "$temperature" "$wifi_status" "$wifi_network" "$uptime" "$memory_usage" "$last_update" "$current_time" "$timestamp"
            ;;
        "csv")
            output_csv "$battery_level" "$battery_voltage" "$temperature" "$wifi_status" "$wifi_network" "$uptime" "$memory_usage" "$last_update" "$current_time" "$timestamp"
            ;;
        "human"|*)
            output_human "$battery_level" "$battery_voltage" "$temperature" "$wifi_status" "$wifi_network" "$uptime" "$memory_usage" "$last_update" "$current_time"
            ;;
    esac
}

# Run main function
main