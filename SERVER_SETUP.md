# Kindle Dashboard HTTP Server Setup

## Overview

The HTTP server provides on-demand generation and serving of dashboard images optimized for e-ink displays. It includes caching, error handling, and multiple endpoints for different use cases.

## Quick Start

### Installation

1. Navigate to the server directory:
   ```bash
   cd server/
   ```

2. Install dependencies (if not already done):
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   node server.js
   ```

   The server will start on `http://localhost:3000` by default.

### Basic Usage

- **Dashboard Image**: `GET http://localhost:3000/dashboard`
- **Health Check**: `GET http://localhost:3000/health`
- **API Info**: `GET http://localhost:3000/api`

## Server Configuration

### Command Line Options

```bash
node server.js [options]

Options:
  --port <number>     Server port (default: 3000)
  --host <string>     Server host (default: localhost)
  --no-cache         Disable image caching
  --cache-timeout <ms> Cache timeout in milliseconds (default: 60000)
  --help, -h         Show help
```

### Examples

```bash
# Start on port 8080
node server.js --port 8080

# Listen on all interfaces
node server.js --host 0.0.0.0

# Disable caching for development
node server.js --no-cache

# 30 second cache timeout
node server.js --cache-timeout 30000
```

## API Endpoints

### GET /dashboard

Generates and serves a dashboard PNG image optimized for e-ink displays.

**Parameters:**
- `grid=true` - Include test grid overlay
- `timestamp=true` - Include timestamp (affects caching)

**Response:**
- Content-Type: `image/png`
- Image dimensions: 600x800 pixels (portrait)
- Optimized for e-ink displays

**Examples:**
```bash
# Basic dashboard
curl -o dashboard.png http://localhost:3000/dashboard

# Dashboard with test grid
curl -o dashboard_grid.png "http://localhost:3000/dashboard?grid=true"

# Using wget
wget -O dashboard.png http://localhost:3000/dashboard
```

### GET /health

Server health check and status information.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-09-18T21:39:47.754Z",
  "uptime": 8.546315,
  "version": "1.0.0",
  "cache": {
    "enabled": true,
    "entries": 0,
    "timeout": 60000
  }
}
```

### GET /api

API documentation and endpoint information.

**Response:** JSON object with complete API documentation.

## Caching Strategy

### How It Works

- Images are cached in memory by request URL and parameters
- Cache entries expire after the configured timeout (default: 60 seconds)
- Cache keys include query parameters, so `?grid=true` creates separate cache entries
- Automatic cleanup removes expired entries

### Cache Control

- **Enable/Disable**: Use `--no-cache` to disable caching
- **Timeout**: Use `--cache-timeout <ms>` to set expiration time
- **Headers**: Responses include appropriate `Cache-Control` headers

### Cache Behavior

```bash
# First request - generates new image
curl http://localhost:3000/dashboard
# [2025-09-18T21:39:57.896Z] [INFO] Generating new dashboard image...

# Second request within timeout - serves cached
curl http://localhost:3000/dashboard
# [2025-09-18T21:40:02.371Z] [INFO] Serving cached dashboard for /dashboard
```

## Error Handling

### Server Errors

All errors return JSON responses with error details:

```json
{
  "error": "Failed to generate dashboard",
  "details": "Canvas creation failed",
  "timestamp": "2025-09-18T21:39:47.754Z"
}
```

### HTTP Status Codes

- `200` - Success
- `404` - Not Found (invalid endpoint)
- `405` - Method Not Allowed (non-GET requests)
- `500` - Internal Server Error

### Logging

The server provides detailed logging with timestamps:

```
[2025-09-18T21:39:39.419Z] [INFO] 🚀 Dashboard server started on http://localhost:3000
[2025-09-18T21:39:57.896Z] [INFO] GET /dashboard - curl/8.7.1
[2025-09-18T21:39:57.896Z] [INFO] Generating new dashboard image...
[2025-09-18T21:39:58.037Z] [INFO] Served dashboard image: 49511 bytes
```

## Production Deployment

### Environment Setup

1. **Install Node.js** (version 14+ required)
2. **Install dependencies**: `npm install`
3. **Configure firewall** to allow the chosen port
4. **Set up process management** (PM2, systemd, etc.)

### Process Management with PM2

```bash
# Install PM2 globally
npm install -g pm2

# Start server with PM2
pm2 start server.js --name "kindle-dashboard"

# Start with custom configuration
pm2 start server.js --name "kindle-dashboard" -- --port 8080 --host 0.0.0.0

# Monitor
pm2 status
pm2 logs kindle-dashboard

# Auto-restart on system boot
pm2 startup
pm2 save
```

### Systemd Service

Create `/etc/systemd/system/kindle-dashboard.service`:

```ini
[Unit]
Description=Kindle Dashboard Server
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/server
ExecStart=/usr/bin/node server.js --port 3000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable kindle-dashboard
sudo systemctl start kindle-dashboard
```

## Integration with Kindle

### Fetch Script Example

Create a script on your Kindle to fetch dashboard images:

```bash
#!/bin/bash
# /mnt/us/dashboard/fetch-dashboard.sh

SERVER_URL="http://192.168.1.100:3000"
DASHBOARD_PATH="/mnt/us/dashboard/current.png"
LOG_PATH="/mnt/us/dashboard/fetch.log"

echo "$(date): Fetching dashboard..." >> "$LOG_PATH"

# Download dashboard image
if wget -q -O "$DASHBOARD_PATH" "$SERVER_URL/dashboard"; then
    echo "$(date): Dashboard fetched successfully" >> "$LOG_PATH"

    # Display on e-ink screen
    /usr/sbin/eips -f -g "$DASHBOARD_PATH"
    echo "$(date): Dashboard displayed" >> "$LOG_PATH"
else
    echo "$(date): Failed to fetch dashboard" >> "$LOG_PATH"
    exit 1
fi
```

### Network Configuration

Ensure your Kindle can reach the server:

1. **Same Network**: Server and Kindle on same Wi-Fi network
2. **Port Access**: Server port accessible from Kindle
3. **IP Address**: Use server's local IP address, not localhost

### Testing from Kindle

```bash
# SSH to Kindle and test connectivity
ssh root@kindle

# Test network connectivity
ping -c 1 192.168.1.100

# Test HTTP endpoint
wget -q -O test.png http://192.168.1.100:3000/dashboard
ls -la test.png
```

## Troubleshooting

### Common Issues

**Server won't start:**
- Check if port is already in use: `lsof -i :3000`
- Verify Node.js installation: `node --version`
- Check dependencies: `npm install`

**Images not generating:**
- Check server logs for Canvas/image generation errors
- Verify sufficient memory available
- Test dashboard generator separately: `node generate-dashboard.js --test`

**Caching issues:**
- Disable cache for testing: `--no-cache`
- Check cache timeout settings
- Monitor cache entries via `/health` endpoint

**Network connectivity:**
- Verify server is listening: `netstat -tlnp | grep 3000`
- Test with curl locally: `curl http://localhost:3000/dashboard`
- Check firewall settings

### Performance Optimization

**Memory Usage:**
- Monitor cache size via `/health` endpoint
- Adjust cache timeout based on update frequency
- Consider cache size limits for long-running servers

**Response Time:**
- First request: ~150ms (image generation)
- Cached requests: ~5ms
- Optimize update frequency vs. cache timeout

**Network Bandwidth:**
- PNG file size: ~49KB (typical dashboard)
- Compression enabled by default
- Consider update intervals based on connection speed

## Development

### Project Structure

```
server/
├── server.js              # HTTP server implementation
├── generate-dashboard.js   # Dashboard image generation
├── package.json           # Dependencies and scripts
└── node_modules/          # Dependencies
```

### Testing

```bash
# Test image generation
node generate-dashboard.js --test

# Start development server
node server.js --port 3001 --no-cache

# Test endpoints
curl http://localhost:3001/health
curl -o test.png http://localhost:3001/dashboard
```

### Extending the Server

The server is modular and can be extended with:

- Additional image formats
- Weather data integration
- Calendar events
- Custom dashboard layouts
- Authentication
- Multiple dashboard templates

See `generate-dashboard.js` for image generation customization and `server.js` for endpoint handling.