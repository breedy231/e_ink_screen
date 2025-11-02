# Flexible Dashboard Layout System

## Overview

The Kindle Dashboard now supports a flexible, modular layout system that allows you to create custom dashboard configurations using a grid-based positioning system and reusable components.

## Architecture

### Core Components

1. **GridSystem** - Handles layout positioning with configurable rows, columns, margins, and gaps
2. **ComponentBase** - Base class for all dashboard components with styling and rendering capabilities
3. **DashboardEngine** - Main orchestrator that renders layouts using components and grid system
4. **Layout Configurations** - JSON files defining component placement and styling

### Built-in Components

- **ClockComponent** - Displays current time with configurable format and size
- **DateComponent** - Shows date information with various format options
- **StatsComponent** - System information and custom statistics
- **TitleComponent** - Dashboard headers and titles

## Available Layouts

### Default Layout
- **File**: `layouts/default.json`
- **Description**: Classic dashboard layout with large clock and system info
- **Grid**: 12×8 (rows×cols)
- **Features**: Large clock, full date display, comprehensive system stats

### Compact Layout
- **File**: `layouts/compact.json`
- **Description**: Dense information layout with smaller components
- **Grid**: 16×10 (rows×cols)
- **Features**: Side-by-side clock and date, detailed system info

### Minimal Layout
- **File**: `layouts/minimal.json`
- **Description**: Clean, minimalist design focusing on time
- **Grid**: 8×6 (rows×cols)
- **Features**: Large time display, simple date, no system info

### Split Layout
- **File**: `layouts/split.json`
- **Description**: Two-column layout with distinct sections
- **Grid**: 12×10 (rows×cols)
- **Features**: Bordered components, organized sections

## Usage

### Command Line Interface

```bash
# Generate with default layout
node generate-flexible-dashboard.js

# Generate specific layout
node generate-flexible-dashboard.js compact
node generate-flexible-dashboard.js minimal

# List available layouts
node generate-flexible-dashboard.js --list

# Show layout information
node generate-flexible-dashboard.js --info split

# Generate all layouts for testing
node generate-flexible-dashboard.js --all --test

# Generate with debug grid
node generate-flexible-dashboard.js default --grid
```

### Backward Compatibility

The V2 generator maintains full backward compatibility:

```bash
# Original syntax still works
node generate-dashboard-v2.js --test
node generate-dashboard-v2.js --compact
node generate-dashboard-v2.js --watch

# New layout options
node generate-dashboard-v2.js --layout minimal
node generate-dashboard-v2.js --layout split --test
```

## Creating Custom Layouts

### Layout Configuration Format

```json
{
  "name": "My Custom Layout",
  "description": "Description of the layout",
  "grid": {
    "rows": 12,
    "cols": 8,
    "margin": 15,
    "gap": 8
  },
  "components": [
    {
      "type": "clock",
      "position": { "row": 1, "col": 0, "rowSpan": 3, "colSpan": 8 },
      "config": {
        "fontSize": 84,
        "showSeconds": true,
        "format": "HH:mm"
      }
    }
  ]
}
```

### Grid System

- **Coordinates**: Grid uses 0-based row/column indexing
- **Spanning**: Components can span multiple rows/columns with `rowSpan` and `colSpan`
- **Positioning**: Automatic pixel calculation based on grid configuration
- **Margins**: Configurable outer margins and inter-component gaps

### Component Configuration

Each component supports these common properties:

```json
{
  "backgroundColor": "#FFFFFF",
  "textColor": "#000000",
  "borderColor": "#000000",
  "borderWidth": 2,
  "padding": 10,
  "fontSize": 16,
  "fontFamily": "sans-serif",
  "fontWeight": "normal",
  "textAlign": "left"
}
```

### Component-Specific Options

#### ClockComponent
```json
{
  "type": "clock",
  "config": {
    "format": "HH:mm",          // Time format (date-fns format)
    "showSeconds": true,         // Display seconds below main time
    "secondsSize": 0.4          // Relative size of seconds (0-1)
  }
}
```

#### DateComponent
```json
{
  "type": "date",
  "config": {
    "dayFormat": "EEEE",        // Day of week format
    "dateFormat": "MMMM do, yyyy", // Date format
    "showDayOfYear": true       // Show day/week of year
  }
}
```

#### StatsComponent
```json
{
  "type": "stats",
  "config": {
    "title": "SYSTEM STATUS",
    "titleSize": 1.5,           // Relative title size
    "showGenerated": true,      // Show generation time
    "showTimezone": true,       // Show timezone info
    "showResolution": true,     // Show image resolution
    "customStats": [            // Additional custom statistics
      "Status: Active",
      "Mode: Production"
    ]
  }
}
```

## E-ink Optimization

The system includes several e-ink specific optimizations:

### Rendering Optimizations
- High contrast colors (pure black on white)
- Path-based text rendering for crisp edges
- Optimized PNG compression with no filtering
- Gray antialiasing for smooth text

### Font Guidelines
- Use bold fonts for better e-ink visibility
- Avoid font sizes smaller than 14px
- Prefer sans-serif fonts for readability
- Use consistent font weights within components

### Layout Best Practices
- Maintain adequate spacing between components
- Use borders sparingly (they can look heavy on e-ink)
- Avoid gradients and complex graphics
- Test layouts on actual e-ink hardware when possible

## Integration with Existing Pipeline

The flexible dashboard system integrates seamlessly with the existing Kindle deployment pipeline:

1. **generate-and-test.sh** - Can be updated to use new generator
2. **optimize-for-eink.py** - Continues to work with generated images
3. **Kindle deployment** - No changes needed for deployment scripts

To switch the main pipeline to use flexible layouts, update `generate-and-test.sh`:

```bash
# Replace this line:
node generate-dashboard.js --test

# With this:
node generate-dashboard-v2.js --layout default --test
```

## Development Workflow

1. **Design Layout** - Create JSON configuration file
2. **Test Generation** - Use `--grid` flag to see component placement
3. **Iterate** - Adjust grid positions and component configs
4. **Optimize** - Test on actual e-ink display
5. **Deploy** - Integrate with existing pipeline

## File Structure

```
server/
├── dashboard-engine.js              # Core flexible engine
├── generate-flexible-dashboard.js   # Flexible CLI generator
├── generate-dashboard-v2.js         # Backward-compatible wrapper
└── layouts/
    ├── default.json                 # Default layout
    ├── compact.json                 # Compact layout
    ├── minimal.json                 # Minimal layout
    └── split.json                   # Split layout
```

This modular system provides maximum flexibility while maintaining the simplicity and reliability needed for the Kindle e-ink environment.