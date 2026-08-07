#!/usr/bin/env node

/**
 * Tests for TrmnlService
 * Run with: node server/trmnl-service.test.js
 */

const fs = require('fs');
const path = require('path');
const TrmnlService = require('./trmnl-service');
const { generateDashboard } = require('./generate');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        testsPassed++;
    } else {
        console.error(`  ✗ ${message}`);
        testsFailed++;
    }
}

function freshCacheDir(name) {
    const dir = path.join(__dirname, '..', 'cache', `trmnl_test_${name}`);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    return dir;
}

async function runTests() {
    console.log('\n🧪 Running TrmnlService Tests\n');
    console.log('═══════════════════════════════════════════\n');

    // Test 1: Mock mode returns a placeholder screen, no network
    console.log('Test 1: Mock Mode');
    const mockService = new TrmnlService({ mockData: true, cacheDir: freshCacheDir('mock') });
    const mockScreen = await mockService.getFormattedTrmnl();
    assert(mockScreen !== null, 'Mock mode returns a screen');
    assert(mockScreen.source === 'mock', 'Mock screen source is "mock"');
    assert(fs.existsSync(mockScreen.imagePath), 'Mock screen PNG exists on disk');
    assert(mockScreen.width === 800 && mockScreen.height === 480, 'Mock screen is 800x480');
    console.log();

    // Test 2: Unconfigured (no baseUrl/mac/key) returns null, not fake data
    console.log('Test 2: Unconfigured');
    const unconfiguredService = new TrmnlService({ cacheDir: freshCacheDir('unconfigured') });
    assert(unconfiguredService.isConfigured() === false, 'isConfigured() is false with no baseUrl/mac/key');
    const unconfiguredResult = await unconfiguredService.getFormattedTrmnl();
    assert(unconfiguredResult === null, 'Unconfigured service returns null (caller falls back to default layout)');
    console.log();

    // Test 3: Unreachable base URL with a seeded cache falls back to expired-cache
    console.log('Test 3: Unreachable BYOS With Seeded Cache');
    const cacheDir = freshCacheDir('expired');
    fs.mkdirSync(cacheDir, { recursive: true });
    const staleScreenPath = path.join(cacheDir, 'screen.png');
    fs.writeFileSync(staleScreenPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    fs.writeFileSync(path.join(cacheDir, 'screen.meta.json'), JSON.stringify({ fetchedAt: Date.now() - 999999 }));
    const staleTime = new Date(Date.now() - 999999);
    fs.utimesSync(staleScreenPath, staleTime, staleTime); // backdate mtime so isCacheValid() sees it as expired

    const downService = new TrmnlService({
        baseUrl: 'http://127.0.0.1:1', // nothing listens here
        deviceMac: 'AA:BB:CC:DD:EE:FF',
        apiKey: 'test-key',
        cacheDir,
        cacheTimeout: 60000, // 1 min — the backdated mtime above already exceeds this
        requestTimeout: 500
    });
    const expiredResult = await downService.getFormattedTrmnl();
    assert(expiredResult !== null, 'Down BYOS with a seeded cache still returns a screen');
    assert(expiredResult.source === 'expired-cache', `Falls back to expired-cache (got: ${expiredResult && expiredResult.source})`);
    console.log();

    // Test 4: Non-PNG bytes (e.g. BMP) are rejected as a fetch failure, not a crash
    console.log('Test 4: Garbage/Non-PNG Bytes Rejected');
    const rejectDir = freshCacheDir('reject');
    const rejectService = new TrmnlService({
        baseUrl: 'http://127.0.0.1:1',
        deviceMac: 'AA:BB:CC:DD:EE:FF',
        apiKey: 'test-key',
        cacheDir: rejectDir
    });
    let threw = false;
    try {
        // downloadImage() rejects non-PNG content directly
        await rejectService.downloadImage('data:not-a-real-url');
    } catch (error) {
        threw = true;
    }
    assert(threw, 'downloadImage() rejects when given an unreachable/invalid URL rather than writing garbage');
    assert(!fs.existsSync(rejectService.getScreenPath()), 'No screen.png written on failure');
    console.log();

    // Test 5: Full pipeline — generateDashboard('trmnl', {mockData:true}) produces a 600x800 canvas
    console.log('Test 5: Full Dashboard Pipeline (mock)');
    const { canvas } = await generateDashboard('trmnl', { mockData: true });
    assert(canvas.width === 600 && canvas.height === 800, `Canvas is 600x800 (got ${canvas.width}x${canvas.height})`);
    console.log();

    // Cleanup test cache dirs
    for (const name of ['mock', 'unconfigured', 'expired', 'reject']) {
        const dir = path.join(__dirname, '..', 'cache', `trmnl_test_${name}`);
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    }

    // Summary
    console.log('═══════════════════════════════════════════\n');
    console.log(`Tests passed: ${testsPassed}`);
    console.log(`Tests failed: ${testsFailed}`);
    console.log(`Total: ${testsPassed + testsFailed}\n`);

    if (testsFailed === 0) {
        console.log('✅ All tests passed!\n');
        process.exit(0);
    } else {
        console.error('❌ Some tests failed!\n');
        process.exit(1);
    }
}

runTests().catch(error => {
    console.error('Test suite error:', error);
    process.exit(1);
});
