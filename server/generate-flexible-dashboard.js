#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const { generateDashboard, getAvailableLayouts, loadLayout } = require('./generate');

/**
 * CLI dashboard generator — thin wrapper around the shared pipeline in
 * generate.js (the same code the HTTP server runs). Renders layouts to
 * PNG files in test-images/ for visual inspection.
 */

const OUTPUT_DIR = path.join(__dirname, '..', 'test-images');

// Mock device stats for --mock runs (production stats arrive as HTTP query
// params from the Kindle; the CLI has no live device to ask)
const MOCK_DEVICE_STATS = {
    battery: { level: '85', voltage: '4.1' },
    temperature: '22',
    wifi: { status: 'connected', network: 'HomeWiFi' },
    system: { uptime_hours: '12.5', memory_usage_percent: '45' },
    dashboard: { last_update: '14:16' }
};

function saveDashboard(canvas, layoutName, options = {}) {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const filename = options.test
        ? `dashboard_${layoutName}_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.png`
        : `dashboard_${layoutName}.png`;
    const outputPath = path.join(OUTPUT_DIR, filename);

    console.log(`💾 Saving dashboard to: ${outputPath}`);

    const buffer = canvas.toBuffer('image/png', {
        compressionLevel: 9,
        filters: canvas.PNG_FILTER_NONE
    });
    fs.writeFileSync(outputPath, buffer);

    const orientation = canvas.width > canvas.height ? 'Landscape' : 'Portrait';
    console.log(`✅ Dashboard saved successfully!`);
    console.log(`📏 Size: ${canvas.width}x${canvas.height}px (${orientation})`);
    console.log(`📦 File size: ${(buffer.length / 1024).toFixed(1)}KB`);

    return outputPath;
}

async function generateOne(layoutName, options = {}) {
    console.log(`🖼️  Generating dashboard with '${layoutName}' layout...`);

    const { canvas, layoutConfig } = await generateDashboard(layoutName, {
        mockData: options.mockData,
        deviceStats: options.mockData ? MOCK_DEVICE_STATS : null,
        showGrid: options.showGrid
    });

    console.log(`📐 Layout: ${layoutConfig.name}`);
    return { canvas, layoutConfig };
}

function showLayoutInfo(layoutName = null) {
    if (layoutName) {
        try {
            const layoutConfig = loadLayout(layoutName);
            console.log(`\n📐 Layout: ${layoutConfig.name}`);
            console.log(`📝 Description: ${layoutConfig.description}`);
            console.log(`🔧 Grid: ${layoutConfig.grid.rows}×${layoutConfig.grid.cols} (margin: ${layoutConfig.grid.margin}px, gap: ${layoutConfig.grid.gap}px)`);
            console.log(`📦 Components: ${layoutConfig.components.length}`);

            layoutConfig.components.forEach((component, index) => {
                const pos = component.position;
                console.log(`  ${index + 1}. ${component.type} - Row ${pos.row}, Col ${pos.col} (${pos.rowSpan || 1}×${pos.colSpan || 1})`);
            });
        } catch (error) {
            console.error(`❌ Error loading layout '${layoutName}': ${error.message}`);
        }
        return;
    }

    const layouts = getAvailableLayouts();
    console.log(`\n📐 Available Layouts (${layouts.length}):`);
    layouts.forEach(name => {
        try {
            const layoutConfig = loadLayout(name);
            console.log(`  • ${name}: ${layoutConfig.name} - ${layoutConfig.description}`);
        } catch (error) {
            console.log(`  • ${name}: [Error loading]`);
        }
    });
}

async function main() {
    const args = process.argv.slice(2);
    const options = {
        mockData: args.includes('--mock'),
        showGrid: args.includes('--grid'),
        test: args.includes('--test')
    };

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Flexible Kindle Dashboard Generator

Usage:
  node generate-flexible-dashboard.js [options] [layout]

Arguments:
  layout              Layout name (default: 'wild-swiss')

Options:
  --list              List available layouts
  --info [layout]     Show layout information
  --all               Generate all layouts
  --grid              Show debug grid
  --test              Add timestamp to filename
  --mock              Use mock data (no network, no device)
  --help, -h          Show this help

Examples:
  node generate-flexible-dashboard.js                    # Generate default layout
  node generate-flexible-dashboard.js compact            # Generate compact layout
  node generate-flexible-dashboard.js wild-swiss --mock  # Mock data, no network
  node generate-flexible-dashboard.js --list             # List available layouts
  node generate-flexible-dashboard.js --info split       # Show split layout info
  node generate-flexible-dashboard.js --all --test       # Generate all layouts
        `);
        return;
    }

    if (args.includes('--list')) {
        showLayoutInfo();
        return;
    }

    if (args.includes('--info')) {
        showLayoutInfo(args[args.indexOf('--info') + 1]);
        return;
    }

    if (args.includes('--all')) {
        const layouts = getAvailableLayouts();
        console.log(`🎨 Generating ${layouts.length} layout variations...`);

        const results = [];
        for (const layoutName of layouts) {
            try {
                console.log(`\n--- Processing ${layoutName} layout ---`);
                const { canvas } = await generateOne(layoutName, options);
                const outputPath = saveDashboard(canvas, layoutName, { test: true });
                results.push({ layout: layoutName, outputPath, success: true });
            } catch (error) {
                console.error(`❌ Failed to generate ${layoutName}: ${error.message}`);
                results.push({ layout: layoutName, error: error.message, success: false });
            }
        }

        console.log('\n📊 Generation Summary:');
        results.forEach(result => {
            if (result.success) {
                console.log(`✅ ${result.layout}: ${result.outputPath}`);
            } else {
                console.log(`❌ ${result.layout}: ${result.error}`);
            }
        });
        return;
    }

    // Generate single layout
    const layoutName = args.find(arg => !arg.startsWith('--')) || 'wild-swiss';

    try {
        const { canvas } = await generateOne(layoutName, options);
        saveDashboard(canvas, layoutName, options);
    } catch (error) {
        console.error(`❌ Generation failed: ${error.message}`);
        process.exit(1);
    }
}

module.exports = { generateOne, saveDashboard, showLayoutInfo };

if (require.main === module) {
    main();
}
