#!/usr/bin/env node

const { exec } = require('child_process');
const path = require('path');

/**
 * Device Statistics Module
 * Fetches device statistics from Kindle or provides mock data for testing
 */

class DeviceStats {
    constructor(options = {}) {
        this.kindleHost = options.kindleHost || 'kindle';
        this.kindleUser = options.kindleUser || 'root';
        this.kindleStatsScript = options.kindleStatsScript || '/mnt/us/dashboard/get-device-stats.sh';
        this.useSSH = options.useSSH !== false;
        this.timeout = options.timeout || 10000; // 10 seconds
        this.mockData = options.mockData || false;
    }

    /**
     * Generate mock device statistics for testing
     */
    getMockStats() {
        const mockStats = {
            timestamp: Math.floor(Date.now() / 1000),
            current_time: new Date().toISOString().replace('T', ' ').substr(0, 19),
            battery: {
                level: "85",
                voltage: "4.1"
            },
            temperature: "22",
            wifi: {
                status: "connected",
                network: "HomeWiFi"
            },
            system: {
                uptime_hours: "12.5",
                memory_usage_percent: "45"
            },
            dashboard: {
                last_update: "14:16:26"
            }
        };

        return Promise.resolve(mockStats);
    }

    /**
     * Fetch device statistics from Kindle via SSH
     */
    fetchKindleStats() {
        return new Promise((resolve, reject) => {
            // For testing, let's use expect to handle password authentication
            const expectScript = `
                spawn ssh -o ConnectTimeout=5 -o PreferredAuthentications=password -o PubkeyAuthentication=no ${this.kindleUser}@${this.kindleHost}
                expect "password:"
                send "Eragon23129\\r"
                expect "# "
                send "${this.kindleStatsScript} --format json\\r"
                expect "# "
                send "exit\\r"
                expect eof
            `;

            const childProcess = exec(`expect -c '${expectScript}'`, {
                timeout: this.timeout,
                encoding: 'utf8'
            }, (error, stdout, stderr) => {
                if (error) {
                    // If SSH fails, return mock data with error indication
                    console.warn(`Failed to fetch device stats via SSH: ${error.message}`);
                    const mockStats = this.createMockStatsSync();
                    mockStats._source = 'mock_ssh_failed';
                    mockStats._error = error.message;
                    resolve(mockStats);
                    return;
                }

                try {
                    // Extract JSON from expect output - find the JSON object
                    const jsonStart = stdout.indexOf('{');
                    const jsonEnd = stdout.lastIndexOf('}') + 1;

                    if (jsonStart !== -1 && jsonEnd > jsonStart) {
                        const jsonText = stdout.substring(jsonStart, jsonEnd);
                        const stats = JSON.parse(jsonText);
                        stats._source = 'kindle_ssh';
                        resolve(stats);
                    } else {
                        throw new Error('No JSON found in output');
                    }
                } catch (parseError) {
                    console.warn(`Failed to parse device stats JSON: ${parseError.message}`);
                    console.warn(`Raw output: ${stdout}`);
                    const mockStats = this.createMockStatsSync();
                    mockStats._source = 'mock_parse_failed';
                    mockStats._error = parseError.message;
                    resolve(mockStats);
                }
            });

            // Handle timeout
            childProcess.on('close', (code) => {
                if (code !== 0) {
                    console.warn(`Device stats script exited with code ${code}`);
                }
            });
        });
    }

    /**
     * Create mock stats synchronously (for error cases)
     */
    createMockStatsSync() {
        return {
            timestamp: Math.floor(Date.now() / 1000),
            current_time: new Date().toISOString().replace('T', ' ').substr(0, 19),
            battery: {
                level: "unknown",
                voltage: "unknown"
            },
            temperature: "unknown",
            wifi: {
                status: "unknown",
                network: "unknown"
            },
            system: {
                uptime_hours: "unknown",
                memory_usage_percent: "unknown"
            },
            dashboard: {
                last_update: "unknown"
            }
        };
    }

    /**
     * Get device statistics (main entry point)
     */
    async getStats() {
        if (this.mockData) {
            return this.getMockStats();
        }

        if (this.useSSH) {
            return this.fetchKindleStats();
        }

        // Try to run locally (if we're on the Kindle)
        return new Promise((resolve, reject) => {
            const localScript = path.join(__dirname, '..', 'kindle', 'get-device-stats.sh');
            exec(`${localScript} --format json`, {
                timeout: this.timeout,
                encoding: 'utf8'
            }, (error, stdout, stderr) => {
                if (error) {
                    console.warn(`Failed to run local device stats: ${error.message}`);
                    return this.getMockStats().then(resolve);
                }

                try {
                    const stats = JSON.parse(stdout.trim());
                    stats._source = 'local';
                    resolve(stats);
                } catch (parseError) {
                    console.warn(`Failed to parse local device stats: ${parseError.message}`);
                    this.getMockStats().then(resolve);
                }
            });
        });
    }

    /**
     * Format device statistics for dashboard display
     */
    formatStatsForDashboard(stats) {
        const formatted = [];

        // Battery information
        if (stats.battery) {
            if (stats.battery.level !== 'unknown') {
                formatted.push(`Battery: ${stats.battery.level}%`);
            }
            if (stats.battery.voltage !== 'unknown') {
                formatted.push(`Voltage: ${stats.battery.voltage}V`);
            }
        }

        // Temperature
        if (stats.temperature && stats.temperature !== 'unknown') {
            formatted.push(`Temperature: ${stats.temperature}°C`);
        }

        // System info
        if (stats.system) {
            if (stats.system.uptime_hours !== 'unknown') {
                formatted.push(`Uptime: ${stats.system.uptime_hours}h`);
            }
            if (stats.system.memory_usage_percent !== 'unknown') {
                formatted.push(`Memory: ${stats.system.memory_usage_percent}%`);
            }
        }

        // WiFi info
        if (stats.wifi) {
            if (stats.wifi.status !== 'unknown') {
                let wifiText = `WiFi: ${stats.wifi.status}`;
                if (stats.wifi.network && stats.wifi.network !== 'unknown' && stats.wifi.network !== 'none') {
                    wifiText += ` (${stats.wifi.network})`;
                }
                formatted.push(wifiText);
            }
        }

        // Last update
        if (stats.dashboard && stats.dashboard.last_update && stats.dashboard.last_update !== 'unknown') {
            formatted.push(`Updated: ${stats.dashboard.last_update}`);
        }

        // Source info (for debugging)
        if (stats._source) {
            formatted.push(`Source: ${stats._source}`);
        }

        return formatted;
    }
}

module.exports = DeviceStats;